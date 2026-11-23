// הטקסטים של מסך «כמה בא לכם לשתף» - משותפים למסך הרגיל ולמסך צבעי המים.
import type { Depth } from '../types';

export const DEPTH_ORDER: Depth[] = ['blessing', 'few', 'many'];

// המשכים נגזרים מהכמות שבקונפיג בהנחת ~20-25 שניות לשאלה,
// ועוד הברכה הסוגרת שנוספת לכולם.
export const DEPTH_CARD_INFO: Record<Depth, { hint: string; tag?: string }> = {
  blessing: { hint: 'ברכה קצרה מהלב · חצי דקה' },
  few: { hint: 'שיחה קלילה וכיפית · כדקה', tag: 'הכי פופולרי' },
  many: { hint: 'עד שנמאס · תקרה 4 דקות' },
};
