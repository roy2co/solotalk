// מעלה-רקע מתמיד: מעלה כל הקלטה ל-Firebase Storage, מעדכן סטטוס,
// ומתחדש אוטומטית בחזרת רשת / חזרה לאפליקציה. שכבת בטיחות 1.
//
// עמיד לכשלים: לכל העלאה יש watchdog שמבטל אותה אם היא נתקעת (אופליין
// לרוב לא זורק שגיאה אלא פשוט תוקע) - כך שום דבר לא נשאר "מעלה" לנצח.
import { ref, uploadBytes, getDownloadURL, getMetadata } from 'firebase/storage';
import { ensureAuth, getCloudStorage, isCloudConfigured } from './firebase';
import { recordingStore } from './storage';
import { cloudObjectName } from './naming';

let running = false;

/**
 * המעלה מושהה בזמן הקלטה פעילה.
 *
 * ⚠️ **זה לא אופטימיזציה - זו הגנה על ההקלטה עצמה.**
 *
 * `processQueue` רץ כל 20 שניות ללא תנאי, וכל סבב קורא `recordingStore.get()`
 * שמושך blob של 150-280 מ"ב מ-IndexedDB. זה קרה **בזמן שהמצלמה מקליטה**,
 * והתחרות על התהליכון הראשי ועל הזיכרון פגעה במקודד.
 *
 * התוצאה שנמדדה בקובץ אמיתי: דגימה אחת קיבלה משך `0xFFFFFFFF`, ולכן נגן
 * שסוכם את המקטעים הציג **1988 שעות** במקום 4:58.
 *
 * **החמרה באופליין:** בלי רשת התור לעולם לא מתרוקן, ולכן אותן הקלטות
 * גדולות נקראות מחדש כל 20 שניות לאורך כל הערב - בדיוק התרחיש שבו זה נתפס.
 */
let recordingActive = false;

/**
 * אותו רציונל בדיוק, בזמן **אריזת ארכיון**: `buildArchives` קורא את כל
 * ההקלטות מ-IndexedDB (אירוע מלא = כ-1.7 ג"ב) ומחשב CRC על כולן. מעלה
 * שרץ במקביל וקורא את אותם blobs מאט את שניהם ומעמיס את הזיכרון.
 */
let exportActive = false;

/** נקרא בדשבורד: `true` בתחילת אריזה, `false` בסיומה (גם בכשל). */
export function setExportActive(active: boolean): void {
  exportActive = active;
  if (!active) void processQueue();
}

/** נקרא ממסך ההקלטה: `true` בפתיחת המצלמה, `false` ביציאה מהמסך. */
export function setRecordingActive(active: boolean): void {
  recordingActive = active;
  // בסיום הקלטה מריצים מיד - ההקלטה החדשה ממתינה לגיבוי
  if (!active) void processQueue();
}
let lastError = '';
const listeners = new Set<() => void>();

/** השגיאה האחרונה מהעלאה (לתצוגה בדשבורד - עוזר לאבחון) */
export function getLastUploadError(): string {
  return lastError;
}

/** מאזין לשינויי סטטוס גיבוי (לרענון חי בדשבורד) */
export function onUploadChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function notify() {
  listeners.forEach((cb) => cb());
}

function eventSlug(name: string): string {
  return (name || 'event').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40);
}

/** דוחה promise אם עברה מגבלת זמן - מונע תקיעה אינסופית (למשל אימות אופליין) */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout: ${label}`)), ms),
    ),
  ]);
}

/**
 * העלאה אחת עם uploadBytes (PUT יחיד) + timeout.
 * שני תיקונים קריטיים ל-iOS Safari (שם uploadBytesResumable נתקע "no progress"):
 *  1) ממשים את ה-blob לזיכרון (arrayBuffer→Blob חדש) - Safari נתקע בהעלאת
 *     Blob שמגובה ישירות ב-IndexedDB.
 *  2) uploadBytes במקום uploadBytesResumable - אמין הרבה יותר ב-iOS לגדלים
 *     האלה, בלי פרוטוקול ה-resumable שנתקע.
 */
async function uploadOnce(path: string, blob: Blob): Promise<string> {
  const storage = getCloudStorage();
  if (!storage) throw new Error('no storage');

  /**
   * חישוב מחדש לזיכרון פותר תקיעות iOS על blobs קטנים מ-IndexedDB - אבל
   * על קובץ גדול הוא **פצצת זיכרון**: הקלטה של 392 מ"ב נטענה כולה לזיכרון
   * של טאב שכבר היה בלחץ. מעל הסף מעלים את ה-blob כמו שהוא.
   */
  const REMATERIALIZE_MAX = 50 * 1024 * 1024;
  let fresh = blob;
  if (blob.size <= REMATERIALIZE_MAX) {
    const buf = await blob.arrayBuffer();
    fresh = new Blob([buf], { type: blob.type || 'video/mp4' });
  }

  const storageRef = ref(storage, path);
  /**
   * ⚠️ **בלי תקרה קשיחה.**
   *
   * קודם היה כאן `Math.min(180000, ...)` - שלוש דקות לכל היותר. הקלטה של
   * 392 מ"ב דורשת 17.4 Mbps מתמשך כדי לעמוד בזה, ולכן היא **נכשלה תמיד**,
   * ובדשבורד זה נראה כמו «מעלה...» שנתקע לנצח.
   *
   * המדיניות עכשיו: שנייה לכל 125 ק"ב (כלומר הנחה שמרנית של ~1 Mbps),
   * מינימום 2 דקות ומקסימום 30. עדיף להמתין ארוך מלהיכשל על רשת איטית -
   * הקלטה שלא עלתה קיימת רק על האייפד.
   */
  const timeoutMs = Math.min(
    30 * 60 * 1000,
    Math.max(120000, Math.round(fresh.size / 125)),
  );
  await withTimeout(
    uploadBytes(storageRef, fresh, { contentType: fresh.type }),
    timeoutMs,
    'upload',
  );
  return getDownloadURL(storageRef);
}

/**
 * האם האובייקט **כבר קיים** בענן בנתיב הזה.
 *
 * למה זה נדרש: כללי ה-Storage חוסמים כתיבה על נתיב תפוס (`resource == null`),
 * וזו הגנה מכוונת מפני השחתת סרטונים. אבל היא יוצרת מלכודת - אם ההעלאה
 * **הצליחה** ורק `getDownloadURL` נכשל (גמגום רשת), הסטטוס נשאר `failed`,
 * והניסיון החוזר פוגע בנתיב שכבר תפוס ומקבל 403 **לנצח**.
 *
 * התוצאה הייתה «✗ נכשל» על סרטון ששלם ונמצא בענן - הודעה שקרית בדיוק
 * ברגע שבו המפעיל מחליט אם אפשר לפרק את העמדה. הבדיקה הזו מפרידה בין
 * «אין הרשאה» אמיתי לבין «כבר הועלה».
 */
async function alreadyInCloud(path: string): Promise<string | null> {
  try {
    const storage = getCloudStorage();
    if (!storage) return null;
    const r = ref(storage, path);
    await withTimeout(getMetadata(r), 15000, 'metadata');
    return await withTimeout(getDownloadURL(r), 15000, 'url');
  } catch {
    // לא קיים, או שגם הקריאה נחסמה - בשני המקרים אין לנו ראיה שהוא בענן
    return null;
  }
}

/** מעבד את התור: מעלה כל הקלטה שעדיין לא בענן, אחת-אחת. */
export async function processQueue(): Promise<void> {
  if (running || recordingActive || exportActive || !isCloudConfigured()) return;
  running = true;
  notify();
  try {
    // שחרור סטטוסים תקועים מסשן/ניסיון קודם ("מעלה" שנתקע) → חזרה ל"ממתין"
    const initial = await recordingStore.list();
    for (const r of initial) {
      if (r.uploadStatus === 'uploading') {
        // eslint-disable-next-line no-await-in-loop
        await recordingStore.update(r.id, { uploadStatus: 'pending' });
      }
    }
    notify();

    // אימות (אם אין רשת - נכשל תוך 15 שנ' במקום להיתקע)
    await withTimeout(ensureAuth(), 15000, 'auth');

    /**
     * הקלטות שנכשלו **בסבב הזה** - מדלגים עליהן וממשיכים הלאה.
     *
     * הבאג שזה מתקן: קודם כשל בהעלאה עשה `break`, והריצה הבאה בחרה שוב
     * בדיוק את אותה הקלטה. כלומר סרטון אחד שנכשל תמיד (קובץ פגום, גודל
     * חריג) **חסם את הגיבוי של כל שאר הסרטונים עד סוף הערב** - בלי שאף
     * אחד ידע, כי הדשבורד רק הראה מספר שלא זז.
     *
     * הן לא ננטשות: הסטטוס נשאר `failed` והסבב הבא ינסה אותן שוב.
     */
    const skipped = new Set<string>();
    /** כשלים רצופים - סימן לתקלה כללית (רשת נפלה) ולא לקובץ בודד */
    let consecutiveFailures = 0;

    for (;;) {
      const list = await recordingStore.list();
      const next = list
        // הישנות קודם: הן ממתינות הכי הרבה זמן, והן אלה שהמפעיל עלול
        // למחוק ראשונות בסוף הערב. `list()` מחזיר חדש-קודם לצורך התצוגה.
        .slice()
        .sort((a, b) => a.meta.timestamp - b.meta.timestamp)
        .find(
          (r) =>
            !skipped.has(r.id) &&
            (r.uploadStatus === undefined ||
              r.uploadStatus === 'pending' ||
              r.uploadStatus === 'failed'),
        );
      if (!next) break;

      const blob = await recordingStore.get(next.id);
      if (!blob) {
        // אין blob (נמחק) - מסמנים כדי לא להיתקע
        await recordingStore.update(next.id, { uploadStatus: 'uploaded' });
        continue;
      }

      await recordingStore.update(next.id, { uploadStatus: 'uploading' });
      notify();
      const ext = blob.type.includes('webm') ? 'webm' : 'mp4';
      const folder = next.meta.eventId || eventSlug(next.meta.eventName);
      /**
       * `recordings/<זוג>_<תאריך>/<הקלטה>` - **בלי רמת מכשיר**.
       *
       * רמת המכשיר פיצלה אירוע אחד לכמה תיקיות: אירוע שצולם בשני אייפדים
       * נחתך לשניים, ובאג שייצר `deviceId` חדש בכל העלאה פיצל אפילו אייפד
       * יחיד לתיקייה נפרדת לכל סרטון. שטוח לפי אירוע = כל הסרטונים של
       * הזוג נמצאים במקום אחד, בענן ובארכיון כאחד.
       *
       * **שם הקובץ** נגזר מהקרבה והעומק שהאורח בחר, לא ממזהה ההקלטה:
       * `rec_1787899224397_0ewzzq.mp4` → `childhood-friends_few_0940_0ewzzq.mp4`.
       * חל על העלאות חדשות בלבד; מה שכבר בענן שומר על שמו.
       *
       * מוצהר **מחוץ** ל-`try` בכוונה: ה-`catch` זקוק לו כדי לבדוק אם
       * הקובץ כבר הגיע לענן (ראו `alreadyInCloud`).
       */
      const path = `recordings/${folder}/${cloudObjectName(
        next.meta.relationship,
        next.meta.depth,
        next.meta.timestamp,
        next.id,
        ext,
      )}`;

      try {
        const url = await uploadOnce(path, blob);
        lastError = '';
        consecutiveFailures = 0;
        await recordingStore.update(next.id, {
          uploadStatus: 'uploaded',
          remotePath: path,
          remoteUrl: url,
        });
        notify();
      } catch (e) {
        const err = e as { code?: string; message?: string };
        lastError = err?.code || err?.message || String(e);

        /**
         * 403 על נתיב שכבר תפוס = ההעלאה הקודמת **הצליחה**.
         * מסמנים כמגובה במקום להיתקע על «נכשל» לנצח. ראו `alreadyInCloud`.
         */
        if (String(lastError).includes('unauthorized')) {
          const existingUrl = await alreadyInCloud(path);
          if (existingUrl) {
            lastError = '';
            consecutiveFailures = 0;
            await recordingStore.update(next.id, {
              uploadStatus: 'uploaded',
              remotePath: path,
              remoteUrl: existingUrl,
            });
            notify();
            continue;
          }
        }

        console.error('upload failed', next.id, lastError, e);
        await recordingStore.update(next.id, { uploadStatus: 'failed' });
        notify();
        // מדלגים על ההקלטה הזו וממשיכים לבאה, במקום לעצור את כל התור.
        skipped.add(next.id);
        consecutiveFailures++;
        // כמה כשלים ברצף = כנראה הרשת ולא הקובץ. אין טעם לשרוף
        // timeout על כל הקלטה בתור; ננסה שוב בטריגר הבא.
        if (consecutiveFailures >= 3) break;
      }
    }
  } catch (e) {
    const err = e as { code?: string; message?: string };
    lastError = err?.code || err?.message || String(e);
    console.error('uploader error', lastError, e);
    notify();
  } finally {
    running = false;
    notify();
  }
}

/** קריאה אחרי כל הקלטה חדשה */
export function enqueue(): void {
  void processQueue();
}

/** מפעיל התחדשות אוטומטית: בחזרת רשת, בחזרה לאפליקציה, ומדי פרק זמן */
export function startUploaderAutoResume(): void {
  if (!isCloudConfigured()) return;
  window.addEventListener('online', () => void processQueue());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void processQueue();
  });
  window.setInterval(() => void processQueue(), 20000);
  void processQueue();
}
