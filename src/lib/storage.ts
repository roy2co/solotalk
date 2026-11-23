import type { RecordingInfo, SessionMeta, UploadStatus } from '../types';

export type RecordingPatch = {
  uploadStatus?: UploadStatus;
  remotePath?: string;
  remoteUrl?: string;
};

// ממשק אחיד לאחסון הקלטות.
// כרגע מומש מקומית ב-IndexedDB. בעתיד ניתן להוסיף CloudStore
// (Firebase/Supabase) שמממש את אותו ממשק בלי לגעת בשאר האפליקציה.
export interface RecordingStore {
  save(blob: Blob, meta: SessionMeta): Promise<string>;
  list(): Promise<RecordingInfo[]>;
  get(id: string): Promise<Blob | undefined>;
  update(id: string, patch: RecordingPatch): Promise<void>;
  delete(id: string): Promise<void>;
}

const DB_NAME = 'soloTalk';
const DB_VERSION = 4;
const STORE = 'recordings';
const CONFIG_STORE = 'config';
const CONFIG_KEY = 'app';
/**
 * מקטעי הקלטה **בזמן אמת**.
 *
 * ⚠️ זה הפתרון לכשל החמור ביותר שנמצא בבדיקות: ההקלטה נצברה כולה בזיכרון
 * עד לשמירה. הקלטה של 7 דקות = ~390 מ"ב, ואחרי כמה כאלה **הליבה של ספארי
 * נחנקה**: המסך קפא, הכפתורים לא הגיבו, ואפילו ה-timeout שאמור להציל לא
 * ירה - כי `setTimeout` לא רץ כשהליבה חסומה.
 *
 * עכשיו כל מקטע נכתב לדיסק ברגע שהוא מגיע, והזיכרון מחזיק מקטע אחד בלבד.
 * בונוס: אחרי קריסה המקטעים **שרדו על הדיסק** וניתנים לשחזור - קודם
 * קריסה מחקה את ההקלטה כולה.
 */
const CHUNK_STORE = 'chunks';
/**
 * הווידאו עצמו, בנפרד מהמטא-דאטה.
 *
 * ⚠️ **זה הפתרון לכשל שנצפה בשדה:** `update()` קרא את הרשומה **כולה** -
 * כולל blob של 392 מ"ב - שינה שדה סטטוס אחד, וכתב את הכל בחזרה. זה קרה
 * שלוש פעמים לכל הקלטה (`pending`→`uploading`→`uploaded`), כלומר קרוב
 * לג'יגה-בייט של כתיבות מיותרות לכל סרטון ארוך. התוצאה בפועל:
 * `Error preparing Blob/File data to be stored in object store`, וההעלאה
 * סומנה «נכשל» למרות שהרשת הייתה תקינה.
 *
 * מאז ההפרדה, עדכון סטטוס נוגע ברשומה של כמה מאות בתים בלבד.
 * בונוס: `list()` כבר לא מפענח את כל ה-blobs - והוא נקרא כל 20 שניות.
 */
const BLOB_STORE = 'blobs';

interface StoredRecording {
  id: string;
  /**
   * קיים רק ברשומות ישנות שנשמרו לפני ההפרדה ל-`BLOB_STORE`.
   * רשומות חדשות לא נושאות אותו, ו-`get()` יודע לקרוא משני המקומות.
   */
  blob?: Blob;
  meta: SessionMeta;
  size: number;
  mimeType: string;
  uploadStatus?: UploadStatus;
  remotePath?: string;
  remoteUrl?: string;
}

/**
 * מגבלת זמן לכל פעולת אחסון.
 *
 * **למה זה קיים:** באירוע בדיקה אמיתי לחיצה על «סיום» נתקעה על «שומר...»
 * ללא מוצא - כתיבת blob של מאות מ"ב ל-IndexedDB נתקעה, ולא הייתה שום
 * מגבלת זמן שתחזיר שליטה. היציאה הכפויה מהאפליקציה נראתה כמו אובדן כל
 * ההקלטות. כשל מפורש תמיד עדיף על המתנה אינסופית: על כשל ההקלטה נשמרת
 * בזיכרון ומוצע ניסיון חוזר, ועל תקיעה אין כלום.
 *
 * 60 שניות: נדיב מספיק לכתיבת 240 מ"ב על אייפד איטי, וקצר מספיק כדי
 * שהמפעיל לא יחשוב שהמכשיר מת.
 */
const OP_TIMEOUT_MS = 60000;

function withTimeout<T>(p: Promise<T>, label: string, ms = OP_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`storage timeout: ${label}`)), ms),
    ),
  ]);
}

function openDB(): Promise<IDBDatabase> {
  return withTimeout(
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(CONFIG_STORE)) {
          db.createObjectStore(CONFIG_STORE);
        }
        if (!db.objectStoreNames.contains(BLOB_STORE)) {
          db.createObjectStore(BLOB_STORE);
        }
        if (!db.objectStoreNames.contains(CHUNK_STORE)) {
          // מפתח מורכב: מזהה ההקלטה + מספר סידורי, כדי לשמור על הסדר
          db.createObjectStore(CHUNK_STORE, { keyPath: ['rec', 'seq'] });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      // חיבור תלוי מטאב/סשן קודם חוסם שדרוג גרסה **לנצח** בלי המטפל הזה
      req.onblocked = () => reject(new Error('indexedDB blocked by another connection'));
    }),
    'openDB',
    15000,
  );
}

/**
 * מריץ בקשה אחת ומסיים **כשהטרנזקציה נסגרה**, לא כשהבקשה הצליחה.
 *
 * ההבדל קריטי לשמירת הקלטה: `request.onsuccess` נורה לפני ה-commit, ולכן
 * המימוש הקודם יכול היה לדווח «נשמר» על נתונים שעדיין לא הגיעו לדיסק. אם
 * הטאב נהרג באותו רגע (ספארי תחת לחץ זיכרון - בדיוק התרחיש של הקלטה של
 * 240 מ"ב), ההקלטה של האורח הייתה נעלמת אחרי שהמסך כבר אמר שהיא נשמרה.
 */
function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    let result: T;
    req.onsuccess = () => {
      result = req.result;
    };
    req.onerror = () => reject(req.error);
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
    t.onerror = () => reject(t.error);
  });
}

/** פותח, מריץ, **וסוגר תמיד** - גם כשנזרקת שגיאה (אחרת נשארים חיבורים תלויים) */
async function withDB<T>(fn: (db: IDBDatabase) => Promise<T>, label = 'op'): Promise<T> {
  const db = await openDB();
  try {
    return await withTimeout(fn(db), label);
  } finally {
    db.close();
  }
}

/** שמירת הקונפיג ב-IndexedDB (רשומה יחידה במפתח קבוע) */
export async function setStoredConfig(config: unknown): Promise<void> {
  return withDB(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(CONFIG_STORE, 'readwrite');
        const req = t.objectStore(CONFIG_STORE).put(config, CONFIG_KEY);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => resolve();
        t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
        t.onerror = () => reject(t.error);
      }),
  );
}

/** טעינת הקונפיג מ-IndexedDB (undefined אם אין) */
export async function getStoredConfig<T = unknown>(): Promise<T | undefined> {
  return withDB(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(CONFIG_STORE, 'readonly');
        const req = t.objectStore(CONFIG_STORE).get(CONFIG_KEY);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
        t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
      }),
  );
}

export class IndexedDBStore implements RecordingStore {
  async save(blob: Blob, meta: SessionMeta): Promise<string> {
    const id = `rec_${meta.timestamp}_${Math.random().toString(36).slice(2, 8)}`;
    /**
     * ⚠️ **בלי `blob` ברשומה.** הוא חי ב-`BLOB_STORE` בלבד.
     * שמירתו גם כאן הכפילה את השטח בדיסק והחזירה את הכתיבה הכבדה
     * שבגללה בוצעה ההפרדה מלכתחילה.
     */
    const record: StoredRecording = {
      id,
      meta,
      size: blob.size,
      mimeType: blob.type,
      uploadStatus: 'pending',
    };
    /**
     * שתי כתיבות בטרנזקציה אחת: הווידאו ל-`BLOB_STORE` והמטא-דאטה
     * ל-`STORE`. טרנזקציה אחת מבטיחה שלא תיווצר רשומה בלי וידאו.
     */
    await withDB(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const t = db.transaction([STORE, BLOB_STORE], 'readwrite');
          t.objectStore(BLOB_STORE).put(blob, id);
          t.objectStore(STORE).put(record);
          t.oncomplete = () => resolve();
          t.onabort = () => reject(t.error ?? new Error('save aborted'));
          t.onerror = () => reject(t.error);
        }),
      'save',
    );
    return id;
  }

  async list(): Promise<RecordingInfo[]> {
    const all = await withDB(
      (db) => tx<StoredRecording[]>(db, 'readonly', (s) => s.getAll()),
      'list',
    );
    return all
      .map(({ id, meta, size, mimeType, uploadStatus, remotePath, remoteUrl }) => ({
        id,
        meta,
        size,
        mimeType,
        uploadStatus,
        remotePath,
        remoteUrl,
      }))
      .sort((a, b) => b.meta.timestamp - a.meta.timestamp);
  }

  async update(id: string, patch: RecordingPatch): Promise<void> {
    return withDB(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const t = db.transaction(STORE, 'readwrite');
          const store = t.objectStore(STORE);
          const g = store.get(id);
          g.onsuccess = () => {
            const rec = g.result as StoredRecording | undefined;
            if (!rec) return; // אין רשומה - הטרנזקציה תיסגר וה-oncomplete יפתור
            Object.assign(rec, patch);
            /**
             * ⚠️ **מסירים את ה-blob לפני הכתיבה חזרה.**
             *
             * ברשומות ישנות הוא עדיין יושב בתוך הרשומה, ובלי השורה הזו
             * כל עדכון סטטוס היה כותב מאות מ"ב מחדש - וזה בדיוק מה שזרק
             * `Error preparing Blob/File data`. הווידאו חי ב-`BLOB_STORE`.
             */
            delete rec.blob;
            store.put(rec).onerror = function () {
              reject(this.error);
            };
          };
          g.onerror = () => reject(g.error);
          t.oncomplete = () => resolve();
          t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
          t.onerror = () => reject(t.error);
        }),
    );
  }

  async get(id: string): Promise<Blob | undefined> {
    return withDB(
      (db) =>
        new Promise<Blob | undefined>((resolve, reject) => {
          const t = db.transaction([STORE, BLOB_STORE], 'readonly');
          const fromBlobStore = t.objectStore(BLOB_STORE).get(id);
          // תאימות לאחור: רשומות שנשמרו לפני ההפרדה נושאות את ה-blob בתוכן
          const fromRecord = t.objectStore(STORE).get(id);
          t.oncomplete = () =>
            resolve(
              (fromBlobStore.result as Blob | undefined) ??
                (fromRecord.result as StoredRecording | undefined)?.blob,
            );
          t.onabort = () => reject(t.error ?? new Error('get aborted'));
          t.onerror = () => reject(t.error);
        }),
      'get',
    );
  }

  async delete(id: string): Promise<void> {
    await withDB(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const t = db.transaction([STORE, BLOB_STORE], 'readwrite');
          t.objectStore(STORE).delete(id);
          t.objectStore(BLOB_STORE).delete(id);
          t.oncomplete = () => resolve();
          t.onabort = () => reject(t.error ?? new Error('delete aborted'));
          t.onerror = () => reject(t.error);
        }),
      'delete',
    );
  }
}

/**
 * ---- מקטעי הקלטה ----
 *
 * נכתבים תוך כדי ההקלטה כדי שהזיכרון לא יתפח. ראו ההסבר ליד `CHUNK_STORE`.
 */

/**
 * כל המקטעים של הקלטה אחת.
 *
 * `[rec]` עד `[rec, []]` ולא `-Infinity`/`Infinity`: מערך ממוין **אחרי**
 * כל מספר בסדר המפתחות של IndexedDB, ולכן זה חוסם את כל הטווח בלי
 * להסתמך על התנהגות ערכי קצה במסלול הכי קריטי במערכת.
 */
function chunkRange(rec: string): IDBKeyRange {
  return IDBKeyRange.bound([rec], [rec, []]);
}

/** כותב מקטע בודד. נקרא פעם בשנייה בזמן הקלטה. */
export async function appendChunk(rec: string, seq: number, blob: Blob): Promise<void> {
  return withDB(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(CHUNK_STORE, 'readwrite');
        t.objectStore(CHUNK_STORE).put({ rec, seq, blob });
        t.oncomplete = () => resolve();
        t.onabort = () => reject(t.error ?? new Error('chunk aborted'));
        t.onerror = () => reject(t.error);
      }),
    'appendChunk',
  );
}

/**
 * קורא את כל המקטעים של הקלטה, לפי הסדר.
 *
 * ה-blobs שחוזרים מגובים בדיסק, ולכן הרכבתם ל-Blob אחד **לא מעתיקה
 * מאות מ"ב לזיכרון** - היא רק מצביעה עליהם.
 */
export async function readChunks(rec: string): Promise<Blob[]> {
  const rows = await withDB(
    (db) =>
      new Promise<{ seq: number; blob: Blob }[]>((resolve, reject) => {
        const t = db.transaction(CHUNK_STORE, 'readonly');
        const range = chunkRange(rec);
        const req = t.objectStore(CHUNK_STORE).getAll(range);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => resolve((req.result ?? []) as { seq: number; blob: Blob }[]);
        t.onabort = () => reject(t.error ?? new Error('read chunks aborted'));
      }),
    'readChunks',
  );
  return rows.sort((a, b) => a.seq - b.seq).map((r) => r.blob);
}

/** מוחק את מקטעי ההקלטה אחרי שהיא הורכבה ונשמרה */
export async function clearChunks(rec: string): Promise<void> {
  return withDB(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(CHUNK_STORE, 'readwrite');
        t.objectStore(CHUNK_STORE).delete(chunkRange(rec));
        t.oncomplete = () => resolve();
        t.onabort = () => reject(t.error ?? new Error('clear chunks aborted'));
        t.onerror = () => reject(t.error);
      }),
    'clearChunks',
  );
}

/**
 * מוחק מקטעים יתומים שנשארו מהקלטות שלא הושלמו.
 *
 * ⚠️ **נקרא בעליית האפליקציה.** בלי זה כל הקלטה שנקטעה - אורח שביטל,
 * מצלמה שנכשלה, טאב שקרס - השאירה על הדיסק מקטעים בגודל ההקלטה המלאה.
 * אירוע של 25 הקלטות יכול היה להשאיר כמה ג'יגה של זבל ולמלא את האייפד
 * באמצע ערב.
 *
 * בטוח לקרוא בעלייה: הקלטה חיה עוד לא התחילה בשלב הזה.
 */
export async function purgeOrphanChunks(): Promise<number> {
  try {
    const ids = await orphanChunkIds();
    for (const id of ids) await clearChunks(id);
    if (ids.length) console.info(`[storage] נוקו מקטעים יתומים מ-${ids.length} הקלטות`);
    return ids.length;
  } catch (e) {
    console.warn('[storage] ניקוי מקטעים יתומים נכשל', e);
    return 0;
  }
}

/** מזהי הקלטות שנשארו להם מקטעים על הדיסק - כלומר הקלטות שנקטעו */
export async function orphanChunkIds(): Promise<string[]> {
  const keys = await withDB(
    (db) =>
      new Promise<IDBValidKey[]>((resolve, reject) => {
        const t = db.transaction(CHUNK_STORE, 'readonly');
        const req = t.objectStore(CHUNK_STORE).getAllKeys();
        req.onerror = () => reject(req.error);
        t.oncomplete = () => resolve(req.result ?? []);
        t.onabort = () => reject(t.error ?? new Error('keys aborted'));
      }),
    'orphanChunks',
  );
  return [...new Set(keys.map((k) => (k as [string, number])[0]))];
}

// מופע יחיד לשימוש בכל האפליקציה
export const recordingStore: RecordingStore = new IndexedDBStore();
