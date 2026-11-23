// טיפוסים משותפים לכל האפליקציה

/**
 * ---- סוג האירוע ----
 *
 * `wedding` הוא המצב המקורי. `brit` / `brita` חולקים את אותו מסלול
 * («קפסולת זמן» - האורחים מדברים **אל התינוק/ת**, שיצפו בזה כשיגדלו),
 * וההבדל ביניהם הוא רק לשון הפנייה בשאלות. ראו `lib/eventType.ts`.
 *
 * קונפיג או אירוע בלי השדה = `wedding`, כך שכל מה שנשמר לפני התוספת
 * ממשיך להתנהג בדיוק כמו קודם.
 */
export const EVENT_TYPE_OPTIONS = [
  { value: 'wedding', label: '💍 חתונה', hint: 'ברכות ושאלות על הזוג' },
  { value: 'brit', label: '👶 ברית', hint: 'מסרים לעתיד - לבן' },
  { value: 'brita', label: '🎀 בריתה', hint: 'מסרים לעתיד - לבת' },
] as const;
export type EventType = (typeof EVENT_TYPE_OPTIONS)[number]['value'];

/**
 * עיצוב מסכי האורח במסלול ברית/בריתה - כולם «צבעי מים» על רקע בהיר.
 *
 * שני הראשונים יוניסקס (קרם וחום עץ). ארבעת האחרים צבעוניים, והצבע
 * מתחלף לבד: כחול בברית, ורוד בבריתה. **מסך הצילום נשאר כהה בכולם**,
 * והשאלה שנצרבת בסרטון אינה מושפעת מהבחירה.
 *
 * היה כאן גם `classic` (שחור־זהב כמו בחתונות). הוא הוסר - ערך כזה ששמור
 * במכשיר מתורגם ל-`pram` ב-`britDesignOf`.
 */
export const BRIT_DESIGN_OPTIONS = [
  { value: 'pram', label: 'עגלה ובלונים', hint: 'יוניסקס' },
  { value: 'garland', label: 'חבל כביסה וקוביות', hint: 'יוניסקס' },
  { value: 'balloon', label: 'כדור פורח', hint: 'כחול / ורוד' },
  { value: 'bow', label: 'פפיון', hint: 'כחול / ורוד' },
  { value: 'gingham', label: 'משבצות', hint: 'כחול / ורוד' },
  { value: 'clouds', label: 'עננים ונצנוצים', hint: 'כחול / ורוד' },
] as const;
export type BritDesign = (typeof BRIT_DESIGN_OPTIONS)[number]['value'];

/** ערכות צבע פרימיום בסגנון Liquid Glass */
export const THEME_OPTIONS = ['gold', 'rose', 'champagne', 'emerald', 'sapphire', 'ruby'] as const;
export type ThemeName = (typeof THEME_OPTIONS)[number];

/**
 * בהירות התצוגה - **ציר נפרד** מערכת הצבע, לא ערכה שביעית.
 * `theme` קובע את צבע ההדגשה, `displayMode` את הרקע. 6 × 2 = 12 שילובים.
 *
 * **מסך הצילום נשאר כהה בשני המצבים** - הצילום עצמו הוא הרקע שם.
 */
export const DISPLAY_MODES = [
  { value: 'dark', label: '🌙 כהה', hint: 'שחור וזהב - ברירת המחדל' },
  { value: 'light', label: '☀️ בהיר', hint: 'שנהב חם, מתאים לאולמות מוארים' },
] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number]['value'];

/**
 * ---- עיצוב הסרטון ----
 *
 * ⚠️ **שתי ההגדרות האלה נצרבות לקובץ הווידאו ובלתי הפיכות.** הקנבס שמוצג
 * לאורח הוא בדיוק הקנבס שמוקלט (`captureStream`), ולכן מה שמצויר עליו נכנס
 * למזכרת של הזוג לתמיד. סרטון שכבר צולם לא ישתנה כשמשנים כאן.
 *
 * לכן ברירת המחדל של שתיהן היא **כבוי**, ובדשבורד יש תצוגה מקדימה חיה.
 */
export const VIDEO_FRAME_OPTIONS = [
  { value: 'none', label: 'ללא', hint: 'הפריים נשאר נקי לגמרי', swatch: '' },
  { value: 'gold', label: 'זהב', hint: 'קו זהב דק + הצללה רכה', swatch: '#C9A84C' },
  { value: 'white', label: 'לבן', hint: 'עדין, מתאים לאולם מואר', swatch: '#FFFFFF' },
  { value: 'black', label: 'שחור', hint: 'רק הצללה, בלי קו', swatch: '#111111' },
  { value: 'theme', label: 'לפי הערכה', hint: 'נצבע בצבע ערכת הצבע הפעילה', swatch: 'var(--ac)' },
] as const;
export type VideoFrameStyle = (typeof VIDEO_FRAME_OPTIONS)[number]['value'];

/**
 * מיקום החותמת (שם הזוג + תאריך) בסרטון.
 *
 * **הבחירה אופקית בלבד** - הגובה קבוע מעל שורת הכפתורים. שלוש הפינות
 * התחתונות תפוסות על המסך («סיום» שמאל, «לשאלה הבאה» מרכז, «להחליף שאלה»
 * ימין), ולכן חותמת בפינה תחתונה ממש הייתה נחבאת מתחת לכפתור.
 */
export const VIDEO_STAMP_OPTIONS = [
  { value: 'off', label: 'לא מוצג', hint: 'ברירת המחדל' },
  { value: 'right', label: 'ימין', hint: 'מעל «להחליף שאלה»' },
  { value: 'center', label: 'מרכז', hint: 'מעל «לשאלה הבאה»' },
  { value: 'left', label: 'שמאל', hint: 'מעל «סיום הקלטה»' },
] as const;
export type VideoStampPos = (typeof VIDEO_STAMP_OPTIONS)[number]['value'];

/**
 * המסך הראשי - שלוש בחירות בלבד.
 *
 * קודם היו כאן שמונה כרטיסים, והאורח נדרש לסרוק את כולם מול המצלמה. שלוש
 * אפשרויות נקראות במבט אחד, והדיוק עובר לתת-מסך שבו הוא כבר יודע מה הוא מחפש.
 */
export const RELATIONSHIP_OPTIONS = ['חברים', 'משפחה', 'אחר'] as const;

/**
 * תת-הקטגוריות של «חברים». נבחרות במסך נפרד ו**מתווספות**
 * ל-`session.relationship`, ולכן מנגנון הסינון הקיים עובד בלי שינוי.
 */
export const FRIENDS_SUBCATEGORIES = [
  'מלווים של הזוג',
  'חברי ילדות',
  'חברים/חברות מהצבא',
  'חברים/חברות מהעבודה',
] as const;

/** הקטגוריה שפותחת את תת-מסך החברים */
export const FRIENDS_PARENT_CATEGORY = 'חברים';

/**
 * תת-הקטגוריות של «משפחה».
 *
 * למה נדרש: שאלות ההורים מנוסחות «הילד/ה שלך» ונשברות לאח או לבן דוד.
 * «חתן וכלה» יושבת כאן ולא במסך הראשי - היא לא קרבה נפוצה שאורח מחפש,
 * והיא הקטגוריה היחידה שבה נקודת המבט מתהפכת (הזוג מקליט את עצמו).
 */
export const FAMILY_SUBCATEGORIES = [
  'הורים',
  'אחים ואחיות',
  'סבא וסבתא',
  'דודים ובני דודים',
  'גיסים/גיסות',
  'חתן וכלה',
] as const;

/** הקטגוריה שפותחת את תת-מסך המשפחה */
export const FAMILY_PARENT_CATEGORY = 'משפחה';

/**
 * «אחר» בתוך תת-מסך = «אין לי קטגוריה מדויקת».
 *
 * בכוונה **לא** ערך קרבה נוסף: שלושה ערכי «אחר» שונים (ראשי / חברים /
 * משפחה) היו דורשים תיוג נפרד לכל אחד במאגר, ומי שהיה מתייג שאלה ל«אחר»
 * לא היה יודע לאיזה מהם. במקום זה הבחירה פשוט משאירה את קטגוריית האב.
 */
export const SUB_OTHER = 'אחר';

/**
 * הקרבות במסלול ברית/בריתה - **מסך אחד**, בלי תת-מסכים.
 *
 * בכוונה ערכי `Relationship` **קיימים** ולא חדשים: שמות הקבצים, ה-slug
 * בענן וכלי בניית הסרט כבר מכירים אותם, ולכן המסלול החדש לא דורש שום
 * שינוי בהם. מה שמשתנה הוא רק התווית שהאורח רואה (`BRIT_RELATIONSHIP_LABELS`).
 */
export const BRIT_RELATIONSHIPS = [
  'סבא וסבתא',
  'דודים ובני דודים',
  'אחים ואחיות',
  'חברים',
  'משפחה',
  'אחר',
] as const satisfies readonly Relationship[];

/** התווית שמוצגת לאורח במסלול ברית. קרבה שלא מופיעה כאן מוצגת בשמה. */
export const BRIT_RELATIONSHIP_LABELS: Record<string, string> = {
  'דודים ובני דודים': 'דודים ודודנים',
  'חברים': 'חברים של ההורים',
  'משפחה': 'משפחה',
};

export const ALL_RELATIONSHIPS = [
  ...RELATIONSHIP_OPTIONS,
  ...FRIENDS_SUBCATEGORIES,
  ...FAMILY_SUBCATEGORIES,
] as const;

export type Relationship = (typeof ALL_RELATIONSHIPS)[number];

/**
 * מיפוי משמות קטגוריה ישנים לחדשים.
 * שאלות שנשמרו בדשבורד מתויגות לפי הערך המדויק, ולכן בלי המיפוי הזה
 * תיוגים ישנים היו מתייתמים והשאלות לא היו מוצגות לאף אורח.
 */
export const LEGACY_RELATIONSHIP_MAP: Record<string, Relationship> = {
  'חברים הכי טובים': 'חברים',
  'משפחה קרובה / גרעינית': 'משפחה',
  // «משפחה קרובה» בוטלה לטובת תת-הקטגוריות; ממופה לאב כדי לא לאבד תיוגים
  'משפחה קרובה': 'משפחה',
  'חברים מהעבודה': 'חברים/חברות מהעבודה',
};

/**
 * תווית ASCII לכל קרבה, לשימוש **בשם הקובץ בענן**.
 *
 * למה אנגלית ולא עברית: שם שמערבב עברית וספרות מתהפך בתצוגה (bidi) בקונסולת
 * Firebase - בדיוק הבלבול שגרם לחשוב ששלוש תיקיות שונות הן אותה תיקייה.
 * ASCII נקרא נכון בקונסולה, ב-ZIP, במק ובווינדוס. השם שהזוג מקבל נשאר עברי.
 *
 * `Record<Relationship, string>` בכוונה ולא `Partial`: הוספת קטגוריה בלי slug
 * **תשבור את הבילד** במקום להעלות בשקט קובץ בשם `undefined`.
 */
export const RELATIONSHIP_SLUG: Record<Relationship, string> = {
  'חברים': 'friends',
  'משפחה': 'family',
  'אחר': 'other',
  'מלווים של הזוג': 'inner-circle',
  'חברי ילדות': 'childhood-friends',
  'חברים/חברות מהצבא': 'army-friends',
  'חברים/חברות מהעבודה': 'work-friends',
  'הורים': 'parents',
  'אחים ואחיות': 'siblings',
  'סבא וסבתא': 'grandparents',
  'דודים ובני דודים': 'uncles-cousins',
  'גיסים/גיסות': 'in-laws',
  'חתן וכלה': 'couple',
};

/** רמת העומק - כמה שאלות (או רק ברכה) */
export type Depth = 'blessing' | 'few' | 'many';

/**
 * ⚠️ המפתחות `blessing | few | many` **אינם משתנים**, רק המשמעות.
 * הקלטות ותיוגי שאלות קיימים נשענים עליהם, ושינוי שם היה מייתם אותם.
 * `many` הוא מעכשיו «פריסטייל» - מוגבל בזמן ולא במספר שאלות.
 */
export const DEPTH_LABELS: Record<Depth, string> = {
  blessing: 'רק לברך',
  few: 'כמה שאלות',
  many: 'פריסטייל',
};

/**
 * כמה שאלות בכל עומק - **ניתן לעריכה בדשבורד**.
 *
 * באירוע הראשון נמדד שחציון ההקלטות היה 44 שניות ו-52% היו מתחת ל-45
 * שניות: האורחים עצרו הרבה לפני 8 שאלות. לכן הכמות ירדה ל-5, והפכה
 * לניתנת לכוונון בין אירועים בלי גרסה חדשה.
 */
export interface DepthSettings {
  /** מספר השאלות ב«כמה שאלות» */
  fewCount: number;
  /** תקרת דקות לפריסטייל - שם הזמן מגביל, לא מספר השאלות */
  freestyleMinutes: number;
}

export const DEFAULT_DEPTH_SETTINGS: DepthSettings = {
  fewCount: 5,
  freestyleMinutes: 4,
};

/**
 * ברית קצרה מחתונה והאורחים ממהרים יותר, ולכן פחות שאלות. 4 = אחת מכל
 * נושא במאגר (עתיד · איחול · טיפ להורים · טיפ לחיים), בנוסף לפתיחה ולסיום.
 */
export const DEFAULT_BRIT_DEPTH_SETTINGS: DepthSettings = {
  fewCount: 4,
  freestyleMinutes: 4,
};

/** שאלה בודדת - מתויגת לפי סוגי הקרבה שהיא מתאימה להם */
export interface Question {
  id: string;
  text: string;
  relationships: Relationship[]; // [] = מתאים לכולם
}

/** כיוון העמדה שנבחר בדשבורד */
export type StationOrientation = 'auto' | 'portrait' | 'landscape';

export const ORIENTATION_OPTIONS: {
  value: StationOrientation;
  label: string;
  hint: string;
}[] = [
  { value: 'auto', label: 'אוטומטי', hint: 'מסתגל לסיבוב המכשיר' },
  { value: 'portrait', label: 'לאורך', hint: 'מצלמה בצלע הקצרה - למשל iPad Air M1' },
  { value: 'landscape', label: 'לרוחב', hint: 'מצלמה בצלע הארוכה - אייפדים חדשים' },
];

/** אירוע פעיל - נוצר ב"התחל אירוע חדש", נעול לאורך האירוע (חסין חצות/כפילויות) */
export interface ActiveEvent {
  id: string; // מזהה ייחודי: שמות_תאריך_שעה_אקראי
  name: string; // שמות החוגגים
  date: string; // תאריך האירוע (טקסט חופשי לתצוגה)
  startedAt: number; // חותמת זמן ההתחלה
  /** ננעל בפתיחת האירוע, כדי שחזרה לאירוע ישן תשחזר גם את המסלול שלו */
  type?: EventType;
}

/** הגדרות האירוע - נשמרות ב-localStorage, נערכות בדשבורד הניהול */
export interface AppConfig {
  /** סוג האירוע שייפתח ב«התחל אירוע חדש». ברירת מחדל `wedding`. */
  eventType?: EventType;
  /**
   * שם התינוק/ת - **אופציונלי ונפרד משם האירוע**. בברית השם מוכרז רק
   * בטקס, והעמדה כבר פתוחה לפניו; לכן האירוע נפתח על שם המשפחה (שהוא גם
   * תיקיית הענן, ואסור שישתנה), והשם מתווסף כאן אחרי ההכרזה.
   */
  babyName?: string;
  /** עיצוב מסכי האורח במסלול ברית/בריתה. ראו `BRIT_DESIGN_OPTIONS`. */
  britDesign?: BritDesign;
  /**
   * האם להציג «אחים ואחיות» במסך «מי אתם בשבילי». כבוי כשזה ילד ראשון -
   * ואז «אחר» מתרחב לרוחב מלא במקום להשאיר חור ברשת.
   */
  britHasSiblings?: boolean;
  /** הכותרת במסך הפתיחה של ברית. ריק = לא מוצג. תומך ב-`{זכר|נקבה}`. */
  britInviteText?: string;
  /**
   * השורה הקטנה מתחת לכותרת. ריק = לא מוצג. תומך ב-`{זכר|נקבה}` וב-`{שנה}`
   * (שנת בר/בת המצווה, מחושבת מתאריך האירוע).
   */
  britOpenText?: string;
  /** מאגר השאלות של מסלול ברית/בריתה. נפרד לגמרי ממאגרי החתונה. */
  britQuestions?: Question[];
  /** ראו `questionBankVersion` - אותו מנגנון, למאגר הברית */
  britBankVersion?: number;
  /** השאלה הפותחת במסלול ברית: «מי אתם בשבילי» - תמיד ראשונה */
  britIntroPrompt?: string;
  /** השאלה הסוגרת במסלול ברית - המקבילה ל-`blessingPrompt` */
  britBlessingPrompt?: string;
  /** כמות שאלות ותקרת זמן במסלול ברית. ראו `DEFAULT_BRIT_DEPTH_SETTINGS`. */
  britDepthSettings?: DepthSettings;
  /** כמות שאלות ותקרת זמן לכל עומק. ראו `DEFAULT_DEPTH_SETTINGS`. */
  depthSettings?: DepthSettings;
  eventName: string;
  welcomeText: string;
  eventDate?: string;
  couplePhotoDataUrl?: string;
  logoDataUrl?: string;
  blessingPrompt: string;
  useGenericQuestions: boolean;
  useCustomQuestions: boolean;
  /**
   * שאלות ומשימות חריפות. **כבוי כברירת מחדל** - יש שם פריטים שעלולים
   * לפגוע באורח או בזוג, ולכן ההפעלה חייבת להיות החלטה מודעת של המפעיל.
   */
  useHardcoreQuestions?: boolean;
  genericQuestions: Question[];
  customQuestions: Question[];
  hardcoreQuestions?: Question[];
  /**
   * גרסת מאגר ברירת המחדל ששמורה במכשיר. כשהיא מפגרת אחרי
   * `QUESTION_BANK_VERSION`, המאגרים הגנריים מוחלפים בחדשים.
   * `customQuestions` **לא** מושפע - הוא של המשתמש.
   */
  questionBankVersion?: number;
  autoResetSeconds: number;
  adminPin?: string;
  /** קוד נפרד לארכיון האירועים - כדי שאפשר יהיה לשנותו בלי לגעת ב-adminPin */
  eventsPin?: string;
  /**
   * קוד לארכיון המנהל (כל המכשירים). נפרד בכוונה: מהפאנל הזה אפשר למחוק
   * סרטונים מהענן לצמיתות, ולכן אסור שהוא ייפתח בקוד שהעובד מקבל.
   */
  managerPin?: string;
  /**
   * מזהה המכשיר בענן. נוצר **פעם אחת** ולא משתנה לעולם, ולכן שינוי שם
   * המכשיר לא מפצל את התיקייה שלו בענן לשתיים.
   */
  deviceId?: string;
  /**
   * השם הקריא של המכשיר («iPad של roy»). נשמר בענן ב-`_device.json` בנפרד
   * מהמזהה, כך שאפשר לשנות אותו בכל רגע והתווית מתעדכנת בכל מקום.
   */
  deviceName?: string;
  activeEvent?: ActiveEvent | null;
  /**
   * אירועים שהסתיימו - נשמרים כדי שאפשר יהיה לחזור אליהם.
   * חזרה לאירוע משחזרת את אותו `id`, ולכן הקלטות חדשות נכנסות לאותה תיקיית ענן.
   */
  pastEvents?: ActiveEvent[];
  /**
   * כיוון העמדה. `auto` = מסתגל למה שהמכשיר נותן.
   * הבחירה נקבעת לפי **מיקום המצלמה** במכשיר: אייפד Air M1 (מצלמה בצלע הקצרה)
   * → `portrait`; אייפדים חדשים/13" (מצלמה בצלע הארוכה) → `landscape`.
   * iOS לא מאפשר לכפות סיבוב מקוד, ולכן אי-התאמה רק מציגה בקשה לסובב.
   */
  orientation?: StationOrientation;
  /** מסגרת נצרבת בסרטון. ראו האזהרה ליד `VIDEO_FRAME_OPTIONS` */
  videoFrame?: VideoFrameStyle;
  /** חותמת שם+תאריך נצרבת בסרטון. ראו האזהרה ליד `VIDEO_FRAME_OPTIONS` */
  videoStamp?: VideoStampPos;
  theme?: ThemeName;
  /** בהירות התצוגה. ברירת מחדל `'dark'` - כך קונפיג ישן נראה בדיוק כמו קודם. */
  displayMode?: DisplayMode;
  /**
   * כמה פעמים אורחים דילגו על כל שאלה (טקסט השאלה → מונה).
   * נשמר בקונפיג ולא נגזר מההקלטות, כדי שישרוד מחיקת הקלטות בסיום אירוע
   * ויצטבר על פני אירועים. עריכת נוסח שאלה מאפסת את המונה שלה - התנהגות רצויה.
   */
  skipStats?: Record<string, number>;
}

/** מטא-דאטה שנשמרת לצד כל הקלטה */
export interface SessionMeta {
  eventName: string;
  eventId?: string;
  /** חסר בהקלטות ישנות = חתונה */
  eventType?: EventType;
  /** המיקרופון לא שידר כלום כשההקלטה הסתיימה - הסרטון כנראה בלי קול */
  micSilent?: boolean;
  relationship: Relationship[];
  depth: Depth;
  timestamp: number;
  /** השאלות שהאורח ענה עליהן בפועל */
  questions: string[];
  /** שאלות שהאורח החליף ("להחליף שאלה") - לתיעוד מלא של מה שהוצג בהקלטה */
  swappedOut?: string[];
}

/** סטטוס גיבוי הקלטה לענן */
export type UploadStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

/** רשומת הקלטה כפי שהיא מוחזרת מרשימת האחסון (בלי ה-blob) */
export interface RecordingInfo {
  id: string;
  meta: SessionMeta;
  size: number;
  mimeType: string;
  uploadStatus?: UploadStatus;
  remotePath?: string;
  remoteUrl?: string;
}

/** המסכים בזרימת האפליקציה */
export type Screen =
  | 'welcome'
  | 'relationship'
  | 'friendsSub'
  | 'familySub'
  | 'depth'
  | 'countdown'
  | 'recording'
  | 'thankyou'
  | 'pin'
  | 'admin';
