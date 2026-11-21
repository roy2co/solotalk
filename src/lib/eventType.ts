// כל מה שתלוי בסוג האירוע (חתונה / ברית / בריתה) במקום אחד.
//
// למה קובץ נפרד: הטקסטים האלה מפוזרים על שישה מסכים. כשכל מסך מחזיק
// `if (brit)` משלו, סוג אירוע נוסף (בר מצווה, יום הולדת) הופך לציד
// אחרי תנאים. כאן סוג חדש = שורה אחת בטבלה.
import type { AppConfig, DepthSettings, EventType } from '../types';
import { DEFAULT_BRIT_DEPTH_SETTINGS, DEFAULT_DEPTH_SETTINGS } from '../types';

/**
 * הסוג **בפועל**. האירוע הפעיל גובר על ההגדרה: הוא ננעל בפתיחה, ולכן
 * שינוי הבורר בדשבורד באמצע ערב לא מחליף לאורחים את המסלול.
 */
export function eventTypeOf(config: AppConfig): EventType {
  return config.activeEvent?.type ?? config.eventType ?? 'wedding';
}

/** ברית ובריתה חולקים מסלול; רק לשון הפנייה שונה */
export function isBritType(type: EventType): boolean {
  return type === 'brit' || type === 'brita';
}

/**
 * מחליף `{זכר|נקבה}` בצורה המתאימה: «אראה {בבר|בבת} המצווה שלי».
 *
 * כך מאגר אחד משרת ברית ובריתה. רוב השאלות מנוסחות בלי מין בכלל
 * (גוף ראשון בעברית ניטרלי: «אהיה», «אגדל»), והתבנית נדרשת רק לשמות
 * תואר ולבר/בת מצווה. טקסט בלי תבנית חוזר כמו שהוא.
 */
export function genderize(text: string, type: EventType): string {
  const female = type === 'brita';
  return text.replace(/\{([^{}|]*)\|([^{}|]*)\}/g, (_, m: string, f: string) =>
    female ? f : m,
  );
}

/** השם שמוצג לאורחים ונצרב בחותמת: שם התינוק/ת אם כבר הוכרז, אחרת שם האירוע */
export function displayName(config: AppConfig): string {
  const eventName = (config.activeEvent?.name || config.eventName || '').trim();
  if (!isBritType(eventTypeOf(config))) return eventName;
  return (config.babyName ?? '').trim() || eventName;
}

/** כמות השאלות ותקרת הזמן של המסלול הפעיל */
export function depthSettingsOf(config: AppConfig): DepthSettings {
  return isBritType(eventTypeOf(config))
    ? { ...DEFAULT_BRIT_DEPTH_SETTINGS, ...(config.britDepthSettings ?? {}) }
    : { ...DEFAULT_DEPTH_SETTINGS, ...(config.depthSettings ?? {}) };
}

/** הטקסטים שהאורח רואה, לפי סוג האירוע */
export interface EventCopy {
  /** ההזמנה הגדולה במסך הפתיחה — נקראת ממרחק */
  invite: string;
  photoGlyph: string;
  photoCaption: string;
  relationshipTitle: string;
  relationshipSubtitle: string;
  /** התווית שמעל השאלה הסוגרת במסך הצילום */
  closingLabel: string;
  thankYou: string;
}

const WEDDING_COPY: EventCopy = {
  invite: 'השאירו ברכה מצולמת',
  photoGlyph: '🥂',
  photoCaption: 'התמונה שלכם כאן',
  relationshipTitle: 'מה הקשר שלכם לזוג?',
  relationshipSubtitle: 'בחרו את הקשר הקרוב ביותר 💛',
  closingLabel: '🎁 לסיום — הברכה שלכם',
  thankYou: 'הברכה שלכם נשמרה. איזה כיף שהייתם חלק מהיום הזה.',
};

const BRIT_COPY: EventCopy = {
  invite: 'השאירו לי מסר לעתיד 💌',
  photoGlyph: '👶',
  photoCaption: 'התמונה שלי כאן',
  relationshipTitle: 'מי אתם בשבילי?',
  relationshipSubtitle: 'כדי שאדע מי מדבר אליי כשאגדל 💛',
  closingLabel: '💌 לסיום — המסר שלכם אליי',
  thankYou: 'המסר שלכם נשמר — אראה אותו כשאגדל. תודה שבאתם לחגוג איתי!',
};

export function copyFor(type: EventType): EventCopy {
  if (!isBritType(type)) return WEDDING_COPY;
  return Object.fromEntries(
    Object.entries(BRIT_COPY).map(([k, v]) => [k, genderize(v, type)]),
  ) as unknown as EventCopy;
}
