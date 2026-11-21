import type { ActiveEvent, EventType, RecordingInfo } from '../types';

/** כמה אירועים שהסתיימו נשמרים להיסטוריה */
const MAX_PAST_EVENTS = 30;

/** slug בטוח לשמות קבצים/תיקיות (עברית נשמרת) */
export function slug(s: string): string {
  return (s || 'event').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40);
}

/**
 * תאריך האירוע כ-`D_M_YYYY` — הפורמט שרועי ביקש לראות בתיקיות הענן
 * (`billi_jon_16_8_2026`). נופל חזרה לתאריך ההתחלה אם ההזנה לא תקינה.
 */
function folderDate(entered: string | undefined, startedAt: number): string {
  const parts = (entered ?? '').split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts.map((p) => p.trim());
    if (/^\d{4}$/.test(year) && /^\d{1,2}$/.test(month) && /^\d{1,2}$/.test(day)) {
      return `${Number(day)}_${Number(month)}_${year}`;
    }
  }
  const d = new Date(startedAt);
  return `${d.getDate()}_${d.getMonth() + 1}_${d.getFullYear()}`;
}

/**
 * מזהה אירוע = **שמות החוגגים + תאריך האירוע**, וזהו: `billi_jon_16_8_2026`.
 *
 * המזהה הוא גם שם התיקייה בענן, ולכן הוא מכוון להיות **יציב ולא ייחודי**:
 * לחיצה חוזרת על «התחל אירוע חדש» לאותו זוג ובאותו תאריך מחזירה בדיוק את
 * אותו מזהה, וכל הסרטונים נשארים יחד. קודם הייתה כאן סיומת שעה+אקראית, וכל
 * לחיצה פיצלה את הזוג לתיקייה נוספת עם סרטון בודד — כך שה-ZIP שנשלח לזוג
 * היה חלקי, בשקט.
 *
 * התאריך נלקח מ**מה שהוזן** ולא משעון ההקלטה, והמזהה ננעל בזמן ההתחלה — לכן
 * אירוע שחוצה חצות נשאר בתיקייה אחת.
 */
export function makeEventId(name: string, startedAt: number, date?: string): string {
  return `${slug(name)}_${folderDate(date, startedAt)}`;
}

/** יוצר אירוע פעיל חדש */
export function startEvent(
  name: string,
  date: string,
  type: EventType = 'wedding',
): ActiveEvent {
  const startedAt = Date.now();
  return {
    id: makeEventId(name, startedAt, date),
    name: name.trim(),
    date: date.trim(),
    startedAt,
    type,
  };
}

/** מוסיף אירוע שהסתיים להיסטוריה, בלי כפילויות והחדש בראש */
export function pushPastEvent(
  past: ActiveEvent[] | undefined,
  event: ActiveEvent,
): ActiveEvent[] {
  const without = (past ?? []).filter((e) => e.id !== event.id);
  return [event, ...without].slice(0, MAX_PAST_EVENTS);
}

/**
 * רשימת האירועים שאפשר לחזור אליהם: ההיסטוריה השמורה **ממוזגת** עם אירועים
 * שנגזרים מההקלטות שעדיין במכשיר.
 *
 * המיזוג הוא מה שהופך את השחזור לאמין: גם אם הקונפיג אבד או נמחק, כל אירוע
 * שיש לו הקלטה מקומית עדיין ניתן לפתיחה מחדש.
 */
export function recoverableEvents(
  past: ActiveEvent[] | undefined,
  recordings: RecordingInfo[],
): ActiveEvent[] {
  const byId = new Map<string, ActiveEvent>();
  for (const e of past ?? []) byId.set(e.id, e);

  for (const rec of recordings) {
    const id = rec.meta.eventId;
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      id,
      name: rec.meta.eventName || id,
      date: '',
      // אין חותמת התחלה אמיתית — ההקלטה המוקדמת ביותר היא הקירוב הטוב ביותר
      startedAt: rec.meta.timestamp,
    });
  }

  return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt);
}

/** מציג תאריך לתצוגה בפורמט d.m.yyyy (נקודות, בלי אפסים מובילים) */
export function formatEventDate(date: string): string {
  /**
   * גם ISO (`YYYY-MM-DD`). הטופס שומר `DD/MM/YYYY`, אבל קונפיג שיובא או
   * נכתב בדרך אחרת עלול להחזיק ISO - וללא הטיפול הזה **האורחים היו רואים
   * `2026-08-30` במסך הפתיחה** במקום תאריך קריא.
   */
  const iso = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${Number(iso[3])}.${Number(iso[2])}.${iso[1]}`;

  const parts = date.split('/');
  if (parts.length !== 3) return date;
  const [day, month, year] = parts;
  const d = parseInt(day, 10);
  const m = parseInt(month, 10);
  if (Number.isNaN(d) || Number.isNaN(m)) return date;
  return `${d}.${m}.${year}`;
}

/** מספר באותיות: 23 → כ״ג, 787 → תשפ״ז */
function gematria(n: number): string {
  const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  let rest = n;
  let out = '';
  for (const [value, letter] of [[400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק']] as const) {
    while (rest >= value) {
      out += letter;
      rest -= value;
    }
  }
  // ט״ו וט״ז, ולא צירופי האותיות של שם השם
  if (rest === 15) out += 'טו';
  else if (rest === 16) out += 'טז';
  else out += tens[Math.floor(rest / 10)] + ones[rest % 10];
  return out.length > 1 ? `${out.slice(0, -1)}״${out.slice(-1)}` : `${out}׳`;
}

/**
 * התאריך העברי של האירוע: `03/12/2026` → «כ״ג בכסלו תשפ״ז».
 *
 * `null` כשהתאריך לא מפוענח או כשהדפדפן לא תומך בלוח העברי — הקורא פשוט
 * מציג את התאריך הלועזי לבדו.
 */
export function hebrewDate(date: string): string | null {
  const [day, month, year] = date.split('/').map((p) => Number(p));
  if (!day || !month || !year) return null;
  try {
    // צהריים, כדי שהפרש אזורי זמן לא יזיז את התאריך ליום הקודם
    const parts = new Intl.DateTimeFormat('he-u-ca-hebrew-nu-latn', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).formatToParts(new Date(year, month - 1, day, 12));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const hebDay = Number(get('day'));
    const hebYear = Number(get('year'));
    const hebMonth = get('month').replace(/^ב/, '');
    if (!hebDay || !hebYear || !hebMonth) return null;
    return `${gematria(hebDay)} ב${hebMonth} ${gematria(hebYear % 1000)}`;
  } catch {
    return null;
  }
}
