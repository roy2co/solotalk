import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { Relationship } from '../types';
import { RELATIONSHIP_OPTIONS } from '../types';
import { RELATIONSHIP_ICONS } from '../lib/relationshipIcons';

interface Props {
  onNext: (selected: Relationship[]) => void;
  onBack: () => void;
}

export default function RelationshipScreen({ onNext, onBack }: Props) {
  /**
   * **בחירה יחידה.** קודם אפשר היה לסמן כמה קטגוריות, וזה שבר שני דברים:
   * השאלות עורבבו בין קהלים שלא מתאימים זה לזה (עמית מהעבודה קיבל שאלות
   * שדורשות להכיר את שני בני הזוג), ושם הקובץ בענן נגזר מהקרבה האחרונה
   * שסומנה - כלומר שרירותי. קרבה אחת = שאלות מדויקות ושם צפוי.
   */
  const [selected, setSelected] = useState<Relationship | null>(null);

  /**
   * לחיצה **מעבירה מיד** למסך הבא.
   *
   * «ממשיכים» היה לחיצה שנייה על החלטה שכבר התקבלה — האורח בחר כרטיס,
   * ואז נדרש לאשר. נמדד באירוע הראשון: שתי לחיצות מיותרות לכל אורח.
   * מאז שהבחירה יחידה אין מה לאשר, ולכן הכפתור ירד.
   */
  const choose = (opt: Relationship) => {
    setSelected(opt);
    onNext([opt]);
  };

  return (
    <div className="screen">
      <button className="back-link glass" onClick={onBack}>
        ‹ חזרה
      </button>

      <h2>מה הקשר שלכם לזוג?</h2>
      <p className="subtitle">בחרו את הקשר הקרוב ביותר 💛</p>

      <div className="cards cards-grid">
        {RELATIONSHIP_OPTIONS.map((opt) => {
          const isSel = selected === opt;
          return (
            <button
              key={opt}
              className={`card glass ${isSel ? 'selected' : ''}`}
              onClick={() => choose(opt)}
            >
              <span
                className="card-icon"
                style={{ '--icon': `url("${RELATIONSHIP_ICONS[opt]}")` } as CSSProperties}
                aria-hidden
              />
              <span className="name">{opt}</span>
            </button>
          );
        })}
      </div>

    </div>
  );
}
