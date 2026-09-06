import { useState } from 'react';
import type { Relationship } from '../types';
import { SUB_OTHER } from '../types';

interface Props {
  title: string;
  options: readonly Relationship[];
  onNext: (selected: Relationship[]) => void;
  onBack: () => void;
}

/**
 * מסך הביניים שמופיע אחרי «חברים» או «משפחה».
 *
 * למה הוא קיים: שאלות ההורים מנוסחות «הילד/ה שלך» ונשברות לאח או לבן דוד,
 * ושאלה כמו «מה החתן הכי אוהב בכלה?» משאירה עמית מהעבודה בלי תשובה מול
 * המצלמה. הבחירה כאן **מתווספת** ל-`session.relationship`, ולכן הסינון
 * הקיים ב-`selectQuestions` עובד בלי שינוי.
 *
 * בכוונה בלי אייקונים: מסך משני קריא יותר כטקסט, ואייקונים היו שוברים את
 * שפת הקו-זהב של המסך הראשי.
 */
export default function SubCategoryScreen({
  title,
  options,
  onNext,
  onBack,
}: Props) {
  // כולל את «אחר», שאינו ערך קרבה — ראו SUB_OTHER ב-types
  // **בחירה יחידה**, כמו במסך הראשי: תת-קטגוריה אחת = מאגר שאלות אחד מדויק.
  const [selected, setSelected] = useState<string | null>(null);

  /** לחיצה מעבירה מיד — ראו את אותו הסבר ב-`Relationship.tsx` */
  const choose = (opt: string) => {
    setSelected(opt);
    // «אחר» רק מאשר שאין קטגוריה מדויקת, ולכן ממשיכים עם קטגוריית האב
    onNext(opt === SUB_OTHER ? [] : ([opt] as Relationship[]));
  };

  return (
    <div className="screen">
      <button className="back-link glass" onClick={onBack}>
        ‹ חזרה
      </button>

      <h2>{title}</h2>
      <p className="subtitle">כדי שנתאים לכם את השאלות 💛</p>

      <div className="cards family-sub">
        {[...options, SUB_OTHER].map((opt) => (
          <button
            key={opt}
            className={`card glass ${selected === opt ? 'selected' : ''}`}
            onClick={() => choose(opt)}
          >
            <span className="name">{opt}</span>
          </button>
        ))}
      </div>

    </div>
  );
}
