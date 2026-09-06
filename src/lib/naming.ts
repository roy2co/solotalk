// שמות קבצים: בענן ובארכיון שהזוג מקבל.
//
// למה קובץ נפרד: אותה החלטה נדרשת בשלושה מקומות — המעלה (`uploader`), הייצוא
// המקומי (`Admin`) ואריזת הענן (`cloudArchive`). כשהלוגיקה ישבה בכל אחד בנפרד
// הם נפרדו זה מזה, ואותו סרטון קיבל שם אחר בכל מסלול.
import { RELATIONSHIP_SLUG, type Relationship } from '../types';

/**
 * הקרבה **המדויקת ביותר** שהאורח בחר.
 *
 * המערך נבנה כ-`[קטגוריית אב, ...תת-קטגוריות]` (ראו `chooseFamilySub` ב-App),
 * ולכן האיבר האחרון הוא תמיד הספציפי ביותר: `['משפחה','סבא וסבתא']` → «סבא וסבתא».
 * אורח שבחר כמה תת-קטגוריות יקבל את האחרונה שסימן.
 */
export function specificRelationship(rels: Relationship[]): Relationship | null {
  return rels.length ? rels[rels.length - 1] : null;
}

/** ה-slug באנגלית לקרבה שנבחרה. `guest` כשלא נבחרה אף קרבה. */
export function relationshipSlug(rels: Relationship[]): string {
  const rel = specificRelationship(rels);
  return (rel && RELATIONSHIP_SLUG[rel]) || 'guest';
}

/** מיפוי הפוך — משמש לשחזור הקרבה מתוך שם קובץ שכבר בענן */
const SLUG_TO_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(RELATIONSHIP_SLUG).map(([label, slug]) => [slug, label]),
);

/** תווים שאסורים בשמות קבצים. «חברים/חברות מהצבא» מכיל לוכסן — בלי זה נוצרת תיקייה. */
export function safeSegment(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `HHMM` לפי השעון המקומי של המכשיר */
export function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * שם האובייקט בענן: `<קרבה>_<שעה>_<שייר>.mp4`
 *
 * למשל `childhood-friends_0940_0ewzzq.mp4` במקום `rec_1787899224397_0ewzzq.mp4`.
 *
 * **השייר האקראי נשאר בכוונה.** `uploadBytes` דורס בשקט אובייקט קיים באותו
 * נתיב: שני אורחים מאותה קרבה שנשמרו באותה דקה (שני אייפדים באותו אירוע) היו
 * מוחקים זה את הסרטון של זה, בלי שום שגיאה. השייר כבר קיים במזהה ההקלטה
 * ומבטיח ייחודיות — זו ההגנה, לא קישוט.
 */
export function cloudObjectName(
  rels: Relationship[],
  timestamp: number,
  recordingId: string,
  ext: string,
): string {
  const tail = recordingId.split('_')[2] || recordingId.replace(/[^a-z0-9]/gi, '');
  return `${relationshipSlug(rels)}_${hhmm(timestamp)}_${tail}.${ext}`;
}

/**
 * מחלץ את הקרבה בעברית משם קובץ שבענן.
 *
 * מחזיר `null` לקבצים בפורמט הישן (`rec_…`) — הם הועלו לפני השינוי ואין בהם
 * את המידע. הם פשוט לא יקבלו את החלק הזה בשם, בלי לשבור כלום.
 */
export function relationshipFromCloudName(fileName: string): string | null {
  const slug = fileName.replace(/\.[^.]+$/, '').split('_')[0];
  return SLUG_TO_LABEL[slug] ?? null;
}
