// מאגר ברירת המחדל של מסלול ברית/בריתה.
//
// הרעיון: **קפסולת זמן**. השאלות כתובות בקולו של התינוק («מה אתם מאחלים
// לי?») והפנייה לאורחים ברבים, כך שלא צריך לדעת אם האורח גבר או אישה.
// מין התינוק/ת נכנס רק דרך התבנית `{זכר|נקבה}` - ראו `genderize`.
import type { AppConfig, Depth, Question, Relationship } from '../types';
import { newQuestion, shuffle, type SelectedQuestions } from './questions';
import { depthSettingsOf, eventTypeOf, genderize } from './eventType';

/** חובה להעלות בכל שינוי ב-`DEFAULT_BRIT` - אחרת המאגר השמור באייפד מנצח */
export const BRIT_BANK_VERSION = 2;

/**
 * תמיד **ראשונה**, לכל אורח, ולא ניתנת להחלפה: מי שיצפה בסרטון בעוד 13
 * שנה צריך קודם כול לדעת מי מדבר אליו.
 */
export const DEFAULT_BRIT_INTRO =
  'ספרו לי מי אתם, ומה הקשר שלכם אליי ולהורים שלי 👋';

/** תמיד **אחרונה** - המקבילה לברכה הסוגרת בחתונה */
export const DEFAULT_BRIT_BLESSING = 'מה המסר האישי ממכם אליי?';

/**
 * הנוסח הקודם של המסר הסוגר. נשמר רק כדי ש-`mergeConfig` יזהה אותו
 * בקונפיג שכבר שמור במכשיר ויחליף בחדש; נוסח שהמפעיל כתב בעצמו לא נוגע.
 */
export const LEGACY_BRIT_BLESSING =
  'ולסיום \u2014 מסר אישי ממכם אליי, שאראה {בבר|בבת} המצווה שלי 💌';

/** ברירות המחדל של שתי שורות הטקסט במסך הפתיחה. ניתנות לעריכה בדשבורד. */
export const DEFAULT_BRIT_INVITE = 'השאירו לי מסר לעתיד';
export const DEFAULT_BRIT_OPEN = 'ייפתח {בבר|בבת} המצווה · {שנה}';

const GRAND: Relationship[] = ['סבא וסבתא'];
const UNCLES: Relationship[] = ['דודים ובני דודים'];
const SIBLINGS: Relationship[] = ['אחים ואחיות'];
const FRIENDS: Relationship[] = ['חברים'];
/** כל מי שבא מהמשפחה - לשאלות על «המשפחה שנולדתי אליה» */
const FAMILY: Relationship[] = ['משפחה', 'סבא וסבתא', 'דודים ובני דודים'];

/**
 * ⚠️ **הסדר כאן הוא סדר ההופעה בסרטון.**
 *
 * בשונה ממאגר החתונה (שמעורבב), כאן `selectQuestions` שומר על הסדר:
 * הוא מחלק את השאלות המתאימות לאורח ל-N קבוצות רצופות ולוקח אחת מכל
 * קבוצה. לכן ארבעת הנושאים מופיעים בסרטון תמיד באותו רצף -
 * עתיד → איחול → להורים → טיפ לחיים - ורק הניסוח מתחלף בין אורח לאורח.
 *
 * כדי שזה יעבוד, **כל נושא מקבל אותה כמות שאלות לכל קרבה**: חמש לכולם,
 * ועוד אחת לכל קרבה מתויגת. מי שמוסיף שאלה לנושא אחד בלבד מזיז את
 * גבולות הקבוצות - הסדר נשמר, אבל ייתכנו שתי שאלות מאותו נושא ברצף.
 */
export const DEFAULT_BRIT: Question[] = [
  // ==== 1. עתיד - ניחושים ====
  newQuestion('מה לדעתכם אהיה כשאגדל?', []),
  newQuestion('נחשו: מה תהיה המילה הראשונה שלי?', []),
  newQuestion('למי אני דומה יותר - לאבא או לאמא? ומה כדאי שאקח מכל אחד?', []),
  newQuestion('איזה תחביב יהיה לי בגיל 10? נחשו', []),
  newQuestion('מה לדעתכם הכי יאפיין אותי {בבר|בבת} המצווה שלי?', []),
  newQuestion('איך הייתם רוצים שאקרא לכם כשאתחיל לדבר?', GRAND),
  newQuestion('איזה מין דודים אתם מתכוונים להיות בשבילי?', UNCLES),
  newQuestion('מה נשחק יחד כשאגדל קצת?', SIBLINGS),
  newQuestion('איזה מין הורים יהיו ההורים שלי? תהיו כנים 😄', FRIENDS),
  newQuestion('איזו תכונה משפחתית לדעתכם כבר עברה אליי?', FAMILY),

  // ==== 2. איחולים ====
  newQuestion('מה אתם מאחלים לי לחיים?', []),
  newQuestion('איזו תכונה אתם מאחלים שתהיה לי?', []),
  newQuestion('מה הדבר שאתם הכי מקווים שאזכה לחוות?', []),
  newQuestion('איזה חלום אתם מאחלים לי להגשים?', []),
  newQuestion('אם הייתם יכולים לתת לי מתנה אחת שאי אפשר לקנות - מה היא הייתה?', []),
  newQuestion('מה אתם מאחלים שאירש מכם?', GRAND),
  newQuestion('מה אתם מאחלים לי ולבני הדודים שלי יחד?', UNCLES),
  newQuestion('מה אתם הכי רוצים שנעשה יחד, אני ואתם?', SIBLINGS),
  newQuestion('מה אתם מאחלים להורים שלי בהרפתקה החדשה שלהם?', FRIENDS),
  newQuestion('איזו מסורת משפחתית אתם מאחלים שאמשיך?', FAMILY),

  // ==== 3. להורים שלי ====
  newQuestion('איזה טיפ יש לכם להורים שלי לגידול שלי?', []),
  newQuestion('מה אסור להורים שלי לשכוח בשנה הראשונה שלי?', []),
  newQuestion('מה הדבר הכי חשוב שהורים צריכים לתת לילד?', []),
  newQuestion('ספרו לי משהו על ההורים שלי שהם בחיים לא יספרו לי בעצמם 😉', []),
  newQuestion('איזו טעות של הורים מתחילים כדאי שההורים שלי ידלגו עליה?', []),
  newQuestion('איך היו אבא או אמא שלי כשהם היו תינוקות? ספרו לי הכול', GRAND),
  newQuestion('איך היו אבא או אמא שלי בתור ילדים? תנו סיפור אחד', UNCLES),
  newQuestion('מה ההורים שלנו צריכים לדעת על לגדל אותי? אתם כבר מנוסים 😄', SIBLINGS),
  newQuestion('איך היו ההורים שלי לפני שנולדתי? ספרו לי את האמת', FRIENDS),
  newQuestion('מה המשפחה שלנו עושה הכי טוב, שההורים שלי חייבים להמשיך?', FAMILY),

  // ==== 4. טיפים לחיים שלי ====
  newQuestion('איזה טיפ יש לכם בשבילי לחיים טובים?', []),
  newQuestion('מה הייתם רוצים שמישהו היה אומר לכם כשהייתם ילדים?', []),
  newQuestion('מה קורה בעולם היום שכדאי שאדע כשאגדל?', []),
  newQuestion('מה הדבר הראשון שתלמדו אותי כשאגדל קצת?', []),
  newQuestion('מה הסוד שלכם לשמוח בחיים?', []),
  newQuestion('מה למדתם בחיים שהייתם רוצים שאדע כבר מההתחלה?', GRAND),
  newQuestion('למה תמיד אוכל לבוא אליכם, גם כשאהיה {גדול|גדולה}?', UNCLES),
  newQuestion('מה הדבר הכי חשוב שתלמדו אותי בתור האחים הגדולים שלי?', SIBLINGS),
  newQuestion('איזה סיפור על ההורים שלי כדאי שאשמע כשאהיה {בן|בת} 18?', FRIENDS),
  newQuestion('מה כדאי שאדע על המשפחה שנולדתי אליה?', FAMILY),
];

/**
 * כמה שאלות בפריסטייל. בחתונה המכסה גבוהה מלאכותית והזמן הוא המגבלה;
 * כאן זה היה שובר את הסדר - האורח היה עובר על המאגר מההתחלה ולא מגיע
 * אף פעם לטיפים. 8 = שתיים מכל נושא, בערך מה שנכנס ב-4 דקות.
 */
const BRIT_FREESTYLE_COUNT = 8;

/**
 * בוחר את השאלות לאורח במסלול ברית/בריתה: פתיחה קבועה, אחת מכל קבוצה
 * רצופה במאגר (ראו ההסבר ליד `DEFAULT_BRIT`), ומסר סוגר.
 *
 * «רק לברך» = פתיחה + מסר סוגר. הפתיחה נשארת גם שם: סרטון בלי «מי אני»
 * חסר ערך למי שיצפה בו בעוד שנים.
 */
export function selectBritQuestions(
  config: AppConfig,
  relationships: Relationship[],
  depth: Depth,
): SelectedQuestions {
  const type = eventTypeOf(config);
  const say = (t: string) => genderize(t.trim(), type);

  const intro = say(config.britIntroPrompt?.trim() || DEFAULT_BRIT_INTRO);
  const blessing = say(config.britBlessingPrompt?.trim() || DEFAULT_BRIT_BLESSING);

  const count =
    depth === 'blessing'
      ? 0
      : depth === 'few'
        ? Math.max(1, Math.round(depthSettingsOf(config).fewCount))
        : BRIT_FREESTYLE_COUNT;

  const bank = (config.britQuestions ?? DEFAULT_BRIT).filter((q) => q.text.trim());
  let matching = bank.filter(
    (q) =>
      q.relationships.length === 0 ||
      q.relationships.some((r) => relationships.includes(r)),
  );
  if (matching.length === 0) matching = bank;

  if (count === 0 || matching.length === 0) {
    return { questions: [intro, blessing], spares: [], fixedFirst: true };
  }

  const texts = matching.map((q) => say(q.text));
  const groups = Math.min(count, texts.length);
  const picked: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < groups; i++) {
    const from = Math.floor((i * texts.length) / groups);
    const to = Math.floor(((i + 1) * texts.length) / groups);
    const group = texts.slice(from, to);
    const chosen = Math.floor(Math.random() * group.length);
    picked.push(group[chosen]);
    rest.push(...group.filter((_, j) => j !== chosen));
  }

  return {
    questions: [intro, ...picked, blessing],
    spares: shuffle(rest),
    fixedFirst: true,
  };
}
