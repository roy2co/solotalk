// קריאה מ-Firebase Storage: כל האירועים מכל המכשירים, מקובצים לפי מכשיר.
//
// למה זה קיים: הדשבורד קרא רק מ-IndexedDB המקומי, ולכן כל מכשיר הציג רק את
// עצמו. הסרטונים עלו לענן ואף אחד לא קרא אותם בחזרה.
import {
  ref,
  listAll,
  getMetadata,
  getDownloadURL,
  getBlob,
  deleteObject,
  type StorageReference,
} from 'firebase/storage';
import { getCloudStorage, ensureAuth } from './firebase';
import { relationshipFromCloudName, depthFromCloudName, safeSegment } from './naming';
import { DEPTH_LABELS } from '../types';

/** שם קובץ הסמן שמחזיק את השם הקריא של המכשיר */
const DEVICE_MARKER = '_device.json';

/**
 * תחילית המזהה. **זו ההבחנה** בין המבנה החדש (`recordings/dev_x/<אירוע>/`)
 * לבין הסרטונים שכבר הועלו לפני החלוקה (`recordings/<אירוע>/`).
 */
const DEVICE_PREFIX = 'dev_';

export interface CloudFile {
  ref: StorageReference;
  /** שם קריא לזוג. בענן הקובץ הוא `<recordingId>.mp4` בלבד. */
  name: string;
  size: number;
  createdAt: number;
}

export interface CloudEvent {
  /** מפתח הקיבוץ: שם הזוג + תאריך, אחרי נרמול */
  id: string;
  /** שם הזוג, מחולץ מהמזהה */
  coupleName: string;
  /** תאריך האירוע, מחולץ מהמזהה */
  date: string;
  files: CloudFile[];
  totalBytes: number;
}


export class CloudArchiveError extends Error {
  /** הקוד המקורי מ-Firebase, לאבחון */
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/**
 * מגבלת זמן לכל פעולת ענן.
 *
 * **חובה, לא נוחות:** בלי רשת Firebase לרוב **לא זורק שגיאה אלא פשוט תוקע**,
 * והפאנל היה נשאר על «טוען מהענן…» לנצח בלי לומר כלום. זה בדיוק אותו כשל
 * שה-uploader כבר מתגונן מפניו.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      // בכוונה בלי «יש לוודא חיבור לאינטרנט»: timeout לא מוכיח בעיית רשת,
      // וההודעה הזו שלחה לבדוק את הראוטר בזמן ש-Firebase החזיר «אין הרשאה».
      setTimeout(() => reject(new CloudArchiveError(`הפעולה לא הסתיימה בזמן (${label}). נסו «רענן»; אם זה חוזר, בדקו את הרשת ואת הרשאות ה-Storage בקונסול.`, 'timeout')), ms),
    ),
  ]);
}

/** הופך שגיאת Firebase להודעה שאומרת **מה להגדיר**, לא רק «נכשל» */
function describe(e: unknown): CloudArchiveError {
  const err = e as { code?: string; message?: string };
  const code = err?.code ?? '';
  if (code.includes('unauthorized') || code.includes('permission')) {
    return new CloudArchiveError(
      'אין הרשאת קריאה ל-Firebase Storage. בקונסול → Storage → Rules, ' +
        'צריך לאפשר read למשתמש מאומת על recordings/.',
      code,
    );
  }
  if (code.includes('unauthenticated')) {
    return new CloudArchiveError(
      'ההתחברות ל-Firebase נכשלה. יש לוודא ש-Anonymous Authentication מופעל.',
      code,
    );
  }
  return new CloudArchiveError(err?.message || 'שגיאה בקריאה מהענן', code);
}

/**
 * מחלץ שם זוג ותאריך ממזהה אירוע בפורמט `slug_YYYY-MM-DD_HHMM_rand`.
 * עמיד למזהים שלא תואמים - מחזיר את המזהה כמו שהוא.
 */
/**
 * מפרק מזהה אירוע לשם ותאריך.
 *
 * תומך בשלושת הפורמטים שקיימים בענן בפועל:
 *   `שם_D_M_YYYY`                    ← הנוכחי (`billi_jon_16_8_2026`)
 *   `שם_YYYY-MM-DD`                  ← קודם
 *   `שם_YYYY-MM-DD_HHMM[_אקראי]`     ← הישן ביותר
 *
 * בלי זה אירועים הוצגו עם המזהה הגולמי כשם ובלי תאריך.
 */
/** אפס מוביל, כדי שהתאריך יהיה זהה לזה שבייצוא מהמכשיר */
function pad2(n: string | number): string {
  return String(Number(n)).padStart(2, '0');
}

function parseEventId(id: string): { coupleName: string; date: string } {
  // הפורמט הנוכחי: שם_D_M_YYYY
  let m = id.match(/^(.*)_(\d{1,2})_(\d{1,2})_(\d{4})$/);
  if (m) {
    const [, slug, d, mo, y] = m;
    return { coupleName: slug.replace(/_/g, ' '), date: `${pad2(d)}.${pad2(mo)}.${y}` };
  }
  // פורמטים קודמים שעדיין קיימים בענן: שם_YYYY-MM-DD[_HHMM[_אקראי]]
  m = id.match(/^(.*)_(\d{4})-(\d{2})-(\d{2})(?:_\d{3,4}(?:_[a-z0-9]+)?)?$/i);
  if (m) {
    const [, slug, y, mo, d] = m;
    return { coupleName: slug.replace(/_/g, ' '), date: `${pad2(d)}.${pad2(mo)}.${y}` };
  }
  return { coupleName: id.replace(/_/g, ' '), date: '' };
}

/**
 * שם קריא לקובץ בתוך ה-ZIP שהזוג מקבל.
 *
 * `<שם הזוג> - <תאריך> - <מספר> - <קרבה>.mp4`, זהה בצורתו לייצוא מהמכשיר -
 * כך שאותו סרטון נקרא אותו דבר בשני מסלולי המסירה.
 *
 * **הקרבה והעומק מגיעים משם הקובץ בענן**, שמאז השינוי מתחיל ב-slug של הקרבה
 * (ומאז שינוי מאוחר יותר - גם slug של העומק). קבצים שהועלו קודם (`rec_…`
 * הישן, או פורמט הקרבה-בלבד) לא מכילים את המידע ופשוט לא יקבלו את החלק הזה.
 *
 * **המספר הסידורי הוא מה שמבטיח ייחודיות** בתוך ה-ZIP. קודם היה כאן חותמת
 * זמן, ושני אורחים שסיימו באותה שנייה קיבלו שם זהה - כלומר אחד דרס את השני
 * בתוך הארכיון. המספר נגזר מהמיון הכרונולוגי ולכן לא יכול להתנגש.
 */
function readableName(
  coupleName: string,
  date: string,
  index: number,
  file: CloudFile,
): string {
  const ext = file.ref.name.split('.').pop() || 'mp4';
  const base = safeSegment(coupleName).slice(0, 40) || 'soloTalk';
  const d = new Date(file.createdAt);
  const p = (n: number) => String(n).padStart(2, '0');
  const day =
    date || `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
  const rel = relationshipFromCloudName(file.ref.name);
  const relPart = rel ? ` - ${safeSegment(rel)}` : '';
  const depth = depthFromCloudName(file.ref.name);
  const depthPart = depth ? ` - ${DEPTH_LABELS[depth]}` : '';
  return `${base} - ${day} - ${p(index + 1)}${relPart}${depthPart}.${ext}`;
}

/** רשומה שטוחה מהענן, לפני קיבוץ */
export interface RawEntry {
  /** הנתיב המלא, למשל `recordings/dev_a1/דני_ושירה_2026-08-16_1920/rec_1.mp4` */
  path: string;
  size: number;
  createdAt: number;
  ref: StorageReference;
}

/**
 * בונה את רשימת האירועים מרשימה שטוחה. **פונקציה טהורה** - כל הלוגיקה
 * ניתנת לבדיקה בלי Firebase.
 *
 * **הקיבוץ הוא לפי אירוע (זוג + תאריך), לא לפי מכשיר.** זה מה שהמסך הזה
 * נועד לענות עליו: «לראות את כל האירועים עם כל הסרטונים», מכל מכשיר.
 *
 * קיבוץ לפי מכשיר נשבר בשלוש דרכים שכולן קרו בפועל:
 *   1. אירוע שצולם בשני אייפדים הופיע כשני אירועים חצויים.
 *   2. תיקיות מלפני החלוקה למכשירים נותרו מנותקות מהאירוע שלהן.
 *   3. באג שייצר `deviceId` חדש בכל העלאה פיצל אייפד אחד לשישה «מכשירים»
 *      עם סרטון בודד בכל אחד.
 *
 * קיבוץ לפי זוג+תאריך מאחד את שלושתם - **גם רטרואקטיבית** על מה שכבר בענן.
 * המכשירים לא נעלמים: הם מוצגים כפרט משני על האירוע.
 */
export function buildEventList(entries: RawEntry[]): CloudEvent[] {
  const groups = new Map<
    string,
    { coupleName: string; date: string; files: CloudFile[] }
  >();

  for (const e of entries) {
    const parts = e.path.split('/').filter(Boolean);
    if (parts[0] !== 'recordings') continue;
    // `recordings/dev_x/<אירוע>/<קובץ>` מול `recordings/<אירוע>/<קובץ>` הישן
    // תיקיות ישנות עדיין כוללות רמת מכשיר; מדלגים עליה כדי שהסרטונים
    // שלהן יתאחדו עם אותו אירוע במבנה השטוח החדש
    const isDevice = parts[1]?.startsWith(DEVICE_PREFIX);
    const eventId = isDevice ? parts[2] : parts[1];
    const fileName = parts[parts.length - 1];
    // הסמן אינו סרטון. בלי הסינון הוא היה נספר וגם נכנס ל-ZIP.
    if (!eventId || fileName === DEVICE_MARKER) continue;

    const { coupleName, date } = parseEventId(eventId);
    // מפתח הקיבוץ מנורמל, כדי ש«רועי ומיה» ו«רועי  ומיה» לא יתפצלו
    const key = `${coupleName.trim().replace(/\s+/g, ' ').toLowerCase()}|${date}`;

    if (!groups.has(key)) {
      groups.set(key, { coupleName, date, files: [] });
    }
    const g = groups.get(key)!;
    g.files.push({
      ref: e.ref,
      // ממולא אחרי המיון - המספר הסידורי דורש את הסדר הכרונולוגי הסופי
      name: '',
      size: e.size,
      createdAt: e.createdAt,
    });
  }

  const events: CloudEvent[] = [];
  for (const [key, g] of groups) {
    g.files.sort((a, b) => a.createdAt - b.createdAt);
    g.files.forEach((f, i) => {
      f.name = readableName(g.coupleName, g.date, i, f);
    });
    events.push({
      id: key,
      coupleName: g.coupleName,
      date: g.date,
      files: g.files,
      totalBytes: g.files.reduce((s, f) => s + f.size, 0),
    });
  }

  // החדש למעלה - אחרי אירוע רוצים למצוא אותו מיד
  events.sort((a, b) => (b.files[0]?.createdAt ?? 0) - (a.files[0]?.createdAt ?? 0));
  return events;
}



/** מוריד את הבתים לצורך אריזת ZIP. **דורש CORS על ה-bucket.** */
export async function downloadCloudFile(file: CloudFile): Promise<Blob> {
  try {
    return await withTimeout(getBlob(file.ref), 120000, 'הורדת קובץ');
  } catch (e) {
    const err = e as { code?: string };
    // getBlob הוא XHR חוצה-מקור, ו-GCS לא שולח CORS כברירת מחדל.
    // בלי ההגדרה הזו הכשל נראה כמו תקלת רשת סתמית - עדיף לומר מה חסר.
    throw new CloudArchiveError(
      'לא ניתן להוריד את הקבצים לאריזה. נדרשת הגדרת CORS על ה-bucket ' +
        'ב-Firebase (אפשר מ-Cloud Shell בקונסול). צפייה והורדה בודדת עובדות בלי זה.',
      err?.code,
    );
  }
}

/** קישור ישיר לצפייה/הורדה בודדת - לא דורש CORS */
export function cloudFileUrl(file: CloudFile): Promise<string> {
  return getDownloadURL(file.ref);
}

/** מוחק אירוע שלם מהענן. בלתי הפיך. */
export async function deleteCloudEvent(event: CloudEvent): Promise<void> {
  await ensureAuth();
  for (const f of event.files) await deleteObject(f.ref);
}

/** סורק רקורסיבית תחת `recordings/` ומחזיר רשימה שטוחה */
/**
 * מריץ עבודות במקביל, עם תקרה.
 *
 * בלי תקרה, מאות בקשות בו-זמנית מציפות את התור של הדפדפן ומאטות את הכל;
 * עם תקרה סבירה מנצלים את זמן ההמתנה של הרשת בלי להעמיס.
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * סורק את כל עץ הקבצים בענן.
 *
 * **הכל במקביל, בכוונה.** הגרסה הראשונה קראה ל-`getMetadata` קובץ אחרי קובץ:
 * נמדד 214ms לקריאה, ועל 101 קבצים זה ~22 שניות - כלומר הפאנל נתקע על
 * «טוען מהענן…» עד ש-timeout קפץ, וזה נראה כאילו אין בכלל סרטונים בענן.
 * סריקת אותו עץ במקביל לוקחת פחות משנייה.
 */
async function listRecursive(dir: StorageReference): Promise<RawEntry[]> {
  // שלב 1: לאסוף את כל ההפניות. הרשימות עצמן מקבילות ומהירות (נמדד ~750ms
  // על 54 תיקיות), ואין להן תלות זו בזו.
  const refs: StorageReference[] = [];
  const collect = async (d: StorageReference): Promise<void> => {
    const { prefixes, items } = await listAll(d);
    refs.push(...items);
    await Promise.all(prefixes.map(collect));
  };
  await collect(dir);

  // שלב 2: מטא-דאטה בתקרה **גלובלית**.
  //
  // למה שני שלבים ולא שזירה: כששזרנו, כל תיקייה פתחה בקשות משלה ובפועל
  // ~100 בקשות נזרקו יחד. הדפדפן מגביל חיבורים בו-זמניים לאותו שרת, ולכן
  // הן רק נערמו בתור - נמדד 5 שניות מול 2.7 שניות בשני שלבים.
  return mapLimit(refs, 12, async (item) => {
    const meta = await getMetadata(item);
    return {
      path: item.fullPath,
      size: meta.size ?? 0,
      createdAt: Date.parse(meta.timeCreated) || 0,
      ref: item,
    } satisfies RawEntry;
  });
}


/**
 * קורא את כל האירועים מהענן, מקובצים לפי זוג + תאריך.
 *
 * סורק גם את המבנה הישן שכלל רמת מכשיר (`recordings/dev_xxx/<אירוע>/`) וגם
 * את השטוח (`recordings/<אירוע>/`), ומאחד אותם לאירוע אחד כשהם של אותו זוג
 * באותו תאריך.
 *
 * הערה למי שעורך: **אין לכתוב את הרצף כוכבית-לוכסן בתוך הערת בלוק** - הוא
 * סוגר אותה באמצע, ואז שאר ההערה נקרא כקוד. זה בדיוק מה שקרה כאן.
 */
export async function listCloudEvents(): Promise<CloudEvent[]> {
  const storage = getCloudStorage();
  if (!storage) throw new CloudArchiveError('גיבוי הענן לא מוגדר במכשיר הזה');
  try {
    await withTimeout(ensureAuth(), 15000, 'התחברות');
    // 25 שנ' - מספיק בהרבה לקריאת רשימה, וקצר מספיק כדי שמי שממתין מול
    // הספינר יקבל תשובה במקום להסיק שהאפליקציה נשברה.
    const entries = await withTimeout(
      listRecursive(ref(storage, 'recordings')),
      25000,
      'קריאת רשימת הקבצים',
    );
    return buildEventList(entries);
  } catch (e) {
    if (e instanceof CloudArchiveError) throw e;
    throw describe(e);
  }
}
