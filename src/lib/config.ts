import type { AppConfig, Question, Relationship } from '../types';
import {
  ALL_RELATIONSHIPS,
  DEFAULT_BRIT_DEPTH_SETTINGS,
  DEFAULT_DEPTH_SETTINGS,
  LEGACY_RELATIONSHIP_MAP,
} from '../types';
import {
  BRIT_BANK_VERSION,
  DEFAULT_BRIT,
  DEFAULT_BRIT_BLESSING,
  DEFAULT_BRIT_INTRO,
  DEFAULT_BRIT_INVITE,
  DEFAULT_BRIT_OPEN,
  LEGACY_BRIT_BLESSING,
} from './britQuestions';
import {
  DEFAULT_GENERIC,
  DEFAULT_HARDCORE,
  QUESTION_BANK_VERSION,
} from './questions';
import { getStoredConfig, setStoredConfig } from './storage';

const STORAGE_KEY = 'soloTalk.config.v1';

/**
 * ברירת המחדל הישנה של שם האירוע. הייתה **זהה למחרוזת הדוגמה** בשדה, ולכן
 * שדה מלא נראה בדיוק כמו שדה ריק - והכפתור «התחל אירוע חדש» היה פעיל מיד.
 * נשמרת כאן רק כדי שהמיגרציה ב-`mergeConfig` תזהה ותנקה אותה.
 */
const LEGACY_DEMO_EVENT_NAME = 'רון & מיה';

/**
 * ברירת המחדל של טקסט הפתיחה כפי שנשמרה במכשירים לפני שהמקפים הארוכים
 * הוחלפו בקצרים. `\u2014` ולא התו עצמו, כדי שהחלפה גורפת של מקפים בקוד
 * לא תשבור את הזיהוי.
 */
const LEGACY_WELCOME_TEXT =
  'ברוכים הבאים לעמדת הברכות שלנו 💛\nהשאירו לנו ברכה או וידאו קצר \u2014 נשמור אותו לזיכרון.';

export const DEFAULT_CONFIG: AppConfig = {
  eventType: 'wedding',
  babyName: '',
  britDesign: 'pram',
  britHasSiblings: true,
  britInviteText: DEFAULT_BRIT_INVITE,
  britOpenText: DEFAULT_BRIT_OPEN,
  britQuestions: DEFAULT_BRIT,
  britBankVersion: BRIT_BANK_VERSION,
  britIntroPrompt: DEFAULT_BRIT_INTRO,
  britBlessingPrompt: DEFAULT_BRIT_BLESSING,
  britDepthSettings: { ...DEFAULT_BRIT_DEPTH_SETTINGS },
  depthSettings: { ...DEFAULT_DEPTH_SETTINGS },
  // ריק בכוונה: השדה חובה, והכפתור מושבת עד שממלאים אותו. שם דמה כברירת
  // מחדל היה נכנס למזהה האירוע, לתיקיית הענן, לשמות הקבצים ולמסך האורחים.
  eventName: '',
  welcomeText:
    'ברוכים הבאים לעמדת הברכות שלנו 💛\nהשאירו לנו ברכה או וידאו קצר - נשמור אותו לזיכרון.',
  eventDate: '',
  blessingPrompt: 'אמרו כמה מילים מהלב 💛',
  useGenericQuestions: true,
  useCustomQuestions: false,
  // כבוי בכוונה - יש שם פריטים שעלולים לפגוע. הפעלה = החלטה מודעת.
  useHardcoreQuestions: false,
  genericQuestions: DEFAULT_GENERIC,
  customQuestions: [],
  hardcoreQuestions: DEFAULT_HARDCORE,
  questionBankVersion: QUESTION_BANK_VERSION,
  autoResetSeconds: 8,
  adminPin: '1234',
  eventsPin: '0000',
  managerPin: '0000',
  deviceName: '',
  activeEvent: null,
  pastEvents: [],
  orientation: 'auto',
  // כבויות בכוונה: שתיהן נצרבות לקובץ ובלתי הפיכות. הפעלה = החלטה מודעת
  // אחרי שרואים את התצוגה המקדימה בדשבורד.
  videoFrame: 'none',
  videoStamp: 'off',
  theme: 'gold',
  displayMode: 'dark',
  skipStats: {},
};

// חייב לכלול גם את תת-קטגוריות המשפחה - אחרת תיוגי «הורים»/«אחים ואחיות»
// היו נמחקים בטעינה, ושאלות ההורים היו הופכות לאוניברסליות ומוצגות לכולם.
const VALID_RELATIONSHIPS = new Set<string>(ALL_RELATIONSHIPS);

/**
 * ממיר תיוגי קרבה ישנים לשמות הקטגוריות הנוכחיים.
 * תיוג שלא ניתן למפות מוסר - עדיף שהשאלה תהיה "מתאימה לכולם"
 * מאשר שתישאר עם תיוג מת שלא יתאים לאף בחירה של אורח.
 */
function migrateQuestions(questions: Question[]): Question[] {
  return questions.map((q) => {
    const rels = Array.isArray(q.relationships) ? q.relationships : [];
    const mapped = rels
      .map((r) => LEGACY_RELATIONSHIP_MAP[r as string] ?? r)
      .filter((r): r is Relationship => VALID_RELATIONSHIPS.has(r as string));
    return { ...q, relationships: Array.from(new Set(mapped)) };
  });
}

/** ממזג קונפיג חלקי לברירות המחדל, כולל מיגרציה מהמבנה הישן */
function mergeConfig(parsed: Partial<AppConfig> & { questions?: unknown }): AppConfig {
  const merged: AppConfig = { ...DEFAULT_CONFIG, ...parsed };
  // מיגרציה: מבנה ישן היה questions:QuestionBank ללא genericQuestions
  if (!Array.isArray(parsed.genericQuestions)) {
    merged.genericQuestions = DEFAULT_CONFIG.genericQuestions;
  }
  if (!Array.isArray(parsed.customQuestions)) {
    merged.customQuestions = [];
  }
  // קונפיג שנשמר לפני מאגר ההארדקור - מאכלסים בברירת המחדל (עדיין כבוי)
  if (!Array.isArray(parsed.hardcoreQuestions)) {
    merged.hardcoreQuestions = DEFAULT_CONFIG.hardcoreQuestions;
  }

  // ---- שדרוג מאגר ברירת המחדל ----
  // בלי זה המאגר השמור במכשיר מנצח לנצח, וכל שיפור למאגר לא היה מגיע
  // לאייפד שכבר הריץ את האפליקציה. מחליפים רק את המאגרים **שלנו**;
  // `customQuestions` הוא של המשתמש ולעולם לא נדרס.
  if ((parsed.questionBankVersion ?? 0) < QUESTION_BANK_VERSION) {
    merged.genericQuestions = DEFAULT_GENERIC;
    merged.hardcoreQuestions = DEFAULT_HARDCORE;
    merged.questionBankVersion = QUESTION_BANK_VERSION;
  }
  // אותו מנגנון למאגר הברית. קונפיג שנשמר לפני שהמסלול נוסף אין בו מאגר
  // בכלל (`britBankVersion` חסר = 0), ולכן הוא מקבל את ברירת המחדל כאן.
  if (
    !Array.isArray(parsed.britQuestions) ||
    (parsed.britBankVersion ?? 0) < BRIT_BANK_VERSION
  ) {
    merged.britQuestions = DEFAULT_BRIT;
    merged.britBankVersion = BRIT_BANK_VERSION;
  }
  // ---- נוסחי ברירת מחדל שהוחלפו ----
  // הערך השמור במכשיר מנצח את ברירת המחדל החדשה, ולכן נוסח ישן נשאר לנצח
  // אלא אם מחליפים אותו כאן. **רק** כשהוא זהה בדיוק לנוסח הישן שלנו -
  // טקסט שהמפעיל כתב בעצמו לא נוגע.
  if (parsed.britBlessingPrompt === LEGACY_BRIT_BLESSING) {
    merged.britBlessingPrompt = DEFAULT_BRIT_BLESSING;
  }
  if (parsed.welcomeText === LEGACY_WELCOME_TEXT) {
    merged.welcomeText = DEFAULT_CONFIG.welcomeText;
  }
  // ---- מזהה מכשיר ----
  // נוצר פעם אחת ולא משתנה לעולם. הוא הנתיב בענן, ולכן אם הוא היה משתנה -
  // אותו מכשיר היה מתפצל לשתי תיקיות. השם הקריא נשמר בנפרד ב-`_device.json`.
  if (!merged.deviceId) {
    merged.deviceId = `dev_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
  }

  // ---- ניקוי שם האירוע הדמה ----
  // הקונפיג במכשיר כבר שמור עם השם הישן, ושינוי ברירת המחדל לבדו לא נוגע בו
  // (הערך השמור מנצח את הפריסה למעלה). מנקים אותו פעם אחת - **רק** אם הוא
  // בדיוק המחרוזת הישנה ורק כשאין אירוע פעיל, כדי לא לדרוס שם שהוזן בכוונה
  // ולא לשנות שם של אירוע שרץ באמצע ערב.
  if (parsed.eventName === LEGACY_DEMO_EVENT_NAME && !parsed.activeEvent) {
    merged.eventName = '';
  }
  // מיגרציה: שמות קטגוריות הקרבה השתנו - ממפים תיוגים שמורים לשמות החדשים
  merged.genericQuestions = migrateQuestions(merged.genericQuestions);
  merged.customQuestions = migrateQuestions(merged.customQuestions);
  merged.hardcoreQuestions = migrateQuestions(merged.hardcoreQuestions ?? []);
  merged.britQuestions = migrateQuestions(merged.britQuestions ?? []);
  // מוודאים שאין שדה ישן שנשאר
  delete (merged as { questions?: unknown }).questions;
  return merged;
}

export interface LoadedConfig {
  config: AppConfig;
  /**
   * `false` = **הקריאה מהאחסון נכשלה**, ו-`config` הוא ברירת מחדל בלבד.
   *
   * חובה לבדוק את זה לפני שכותבים בחזרה. ראו את האזהרה ב-`loadConfig`.
   */
  storageOk: boolean;
}

/**
 * טוען את הקונפיג מ-IndexedDB (אחסון אמין, מכסה גדולה).
 * אם ריק - מיגרציה חד-פעמית מ-localStorage הישן; אחרת ברירת מחדל.
 *
 * ⚠️ **למה יש כאן `storageOk` ולא סתם החזרת ברירת מחדל.**
 *
 * קודם כל שגיאה נבלעה והוחזר `DEFAULT_CONFIG`. מכיוון ש-`App` שומר את
 * הקונפיג בכל שינוי (כולל הטעינה הראשונה), תקלה **רגעית** אחת בקריאה
 * גרמה לשרשרת: ברירת מחדל → שמירה → **הקונפיג האמיתי נדרס**.
 * נמדד בפועל: שם הזוג, האירוע הפעיל, קוד הניהול (חזר ל-1234), השאלות
 * המותאמות והיסטוריית האירועים - כולם נמחקו. באמצע אירוע זה מפיל את
 * העמדה למסך «סגור».
 *
 * ספארי ב-iOS זורק שגיאות IndexedDB רגעיות תחת לחץ אחסון ואחרי חזרה
 * מרקע, ולכן זה לא תרחיש תיאורטי. **אסור להחזיר כאן ברירת מחדל בשקט.**
 */
export async function loadConfig(): Promise<LoadedConfig> {
  try {
    const fromDb = await getStoredConfig<Partial<AppConfig>>();
    if (fromDb) {
      const merged = mergeConfig(fromDb);
      /**
       * **חובה לשמור מיד כשנוצר מזהה מכשיר.**
       *
       * הבאג שזה מתקן: `mergeConfig` מייצר `deviceId` אקראי כשאין כזה, אבל
       * הוא לא נשמר - ו-`uploader` קורא ל-`loadConfig()` **בכל העלאה**.
       * כלומר כל סרטון קיבל מזהה מכשיר חדש ונחת בתיקיית ענן משלו, והארכיון
       * הציג אייפד אחד כשישה מכשירים שונים עם סרטון בודד בכל אחד.
       */
      if (!fromDb.deviceId && merged.deviceId) {
        await setStoredConfig(merged);
      }
      return { config: merged, storageOk: true };
    }

    // מיגרציה חד-פעמית מהמבנה הישן ב-localStorage
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const migrated = mergeConfig(JSON.parse(raw));
      await setStoredConfig(migrated);
      return { config: migrated, storageOk: true };
    }
    // אין קונפיג שמור - מכשיר חדש. זה מצב תקין, ומותר לכתוב עליו.
    return { config: { ...DEFAULT_CONFIG }, storageOk: true };
  } catch (e) {
    console.error('[config] קריאת הקונפיג נכשלה - לא כותבים בחזרה', e);
    return { config: { ...DEFAULT_CONFIG }, storageOk: false };
  }
}

/** שומר את הקונפיג ב-IndexedDB */
export async function saveConfig(config: AppConfig): Promise<void> {
  await setStoredConfig(config);
}

/** מייצא את הקונפיג כמחרוזת JSON יפה (לייצוא לקובץ) */
export function exportConfig(config: AppConfig): string {
  return JSON.stringify(config, null, 2);
}

/** מייבא קונפיג ממחרוזת JSON, עם מיזוג לברירות המחדל */
export function importConfig(json: string): AppConfig {
  return mergeConfig(JSON.parse(json));
}
