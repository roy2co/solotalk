// זרם מצלמה **אחד** לכל זרימת האורח.
//
// ---- למה זה קיים ----
// מסך הספירה מציג תצוגה מקדימה, ומיד אחריו מסך הצילום מקליט. בלי שיתוף,
// כל אחד מהם היה קורא ל-`getUserMedia` בנפרד — כלומר **סגירה ופתיחה של
// המצלמה תוך שבריר שנייה**. זה בדיוק התרחיש שמייצר `NotReadableError`
// («המצלמה תפוסה כרגע») ב-iOS, שהוא הכשל הנפוץ ביותר בעמדה.
//
// עם זרם משותף המצלמה נפתחת פעם אחת בכניסה לספירה, וכשהצילום מתחיל היא
// **כבר חמה** — אין השהיה ואין חלונית הרשאה באמצע.
//
// ⚠️ מי שפותח אינו מי שסוגר. השחרור נעשה רק כשהאורח עוזב את הזרימה
// (`releaseCamera` מ-`close()` של המקליט או מ-`reset()` ב-App).

/** האם המסך במצב פורטרט — קובע את האילוצים שמבקשים מהמצלמה */
function isPortrait(): boolean {
  return (window.innerHeight || 1200) >= (window.innerWidth || 800);
}

let shared: MediaStream | null = null;

/**
 * הבקשה שנמצאת **כרגע באוויר**.
 *
 * ⚠️ בלי זה יש מרוץ אמיתי: שתי קריאות שמגיעות לפני שהראשונה הוכרעה
 * שתיהן רואות `shared === null` ושתיהן קוראות ל-`getUserMedia`. זה קורה
 * בפועל — React מפעיל אפקטים פעמיים ב-StrictMode, ונמדדו 3 פתיחות
 * במקום 2. שתי פתיחות בו-זמנית הן בדיוק מה שמייצר `NotReadableError`
 * באייפד. שמירת ההבטחה גורמת לקריאה השנייה להמתין לראשונה.
 */
let pending: Promise<MediaStream> | null = null;

/** האם הזרם השמור עדיין חי (טראק שנעצר לא ניתן לשימוש חוזר) */
function isLive(s: MediaStream | null): s is MediaStream {
  return !!s && s.getTracks().some((t) => t.readyState === 'live');
}

/**
 * מחזיר את הזרם המשותף. פותח אותו רק אם אין זרם חי.
 *
 * הקריאה הראשונה היא זו שמקפיצה את חלונית ההרשאה — ולכן כדאי שהיא תקרה
 * במסך הספירה ולא במסך הצילום, כשעוד יש זמן להתאושש.
 */
export async function acquireCamera(): Promise<MediaStream> {
  if (isLive(shared)) return shared;
  if (pending) return pending;

  const portrait = isPortrait();
  pending = navigator.mediaDevices
    .getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: portrait ? 1080 : 1920 },
        height: { ideal: portrait ? 1920 : 1080 },
      },
      audio: true,
    })
    .then((s) => {
      shared = s;
      return s;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

/** משחרר את המצלמה. נקרא ביציאה מזרימת האורח בלבד. */
export function releaseCamera(): void {
  shared?.getTracks().forEach((t) => t.stop());
  shared = null;
  // בקשה שעדיין באוויר תיפתר לזרם שכבר לא רלוונטי — מנתקים אותה
  pending = null;
}

/** האם יש כרגע זרם חי — לאבחון ולבדיקות */
export function hasLiveCamera(): boolean {
  return isLive(shared);
}
