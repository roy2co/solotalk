import type { Relationship } from '../types';

import closeFamily from '../assets/icons/close-family.png';
import bestFriends from '../assets/icons/best-friends.png';
import companions from '../assets/icons/companions.png';
import coworkers from '../assets/icons/coworkers.png';
import family from '../assets/icons/family.png';
import army from '../assets/icons/army.png';
import childhood from '../assets/icons/childhood.png';
import other from '../assets/icons/other.png';

/**
 * אייקוני קו-זהב לכל סוג קרבה.
 * הקבצים הם **מסכות אלפא** (לבן + שקיפות) — ב-CSS הם משמשים כ-mask
 * ונצבעים בגרדיאנט של ערכת הצבע הפעילה, כך שהם מתחלפים יחד עם הערכה.
 */
export const RELATIONSHIP_ICONS: Partial<Record<Relationship, string>> = {
  'מלווים של הזוג': companions,
  'חברים': bestFriends,
  'משפחה': family,
  // האייקון של «משפחה קרובה» התפנה כשהקטגוריה בוטלה — מושאל לחתן וכלה.
  // שווה להחליף אותו באייקון ייעודי: מספיק להחליף את קובץ ה-PNG.
  'חתן וכלה': closeFamily,
  'חברים/חברות מהעבודה': coworkers,
  'חברים/חברות מהצבא': army,
  'חברי ילדות': childhood,
  'אחר': other,
  // תת-קטגוריות המשפחה בכוונה בלי אייקון — מסך משני עם ארבע אפשרויות
  // קריא יותר כטקסט, ואייקוני אימוג'י היו שוברים את שפת הקו-זהב.
};
