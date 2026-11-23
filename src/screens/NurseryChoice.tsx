import type { CSSProperties } from 'react';
import type { BritDesign } from '../types';
import NurseryBackdrop from '../components/NurseryBackdrop';

export interface ChoiceOption {
  key: string;
  label: string;
  /** שורה משנית מתחת לתווית (מסך העומק) */
  hint?: string;
  /** תגית קטנה מעל הכרטיס, למשל «הכי פופולרי» */
  tag?: string;
}

interface Props {
  design: BritDesign;
  /** משתני הגופן שנבחר - ראו `britFontVars` */
  fontVars: Record<string, string>;
  title: string;
  subtitle?: string;
  options: ChoiceOption[];
  /** 2 = רשת של אריחים (קרבה) · 1 = רשימה של כרטיסים רחבים (עומק) */
  columns: 1 | 2;
  onChoose: (key: string) => void;
  onBack: () => void;
}

/**
 * מסך בחירה בעיצובי «צבעי מים»: «מי אתם בשבילי» ו«כמה בא לכם לשתף».
 *
 * קיים כי מסכי הבחירה הרגילים (`SubCategoryScreen`, `DepthScreen`) בנויים
 * לשפת הזכוכית הכהה: גם כשצובעים אותם בקרם, האריחים קטנים ואין קו מפריד
 * מתחת לכותרת - וזה לא נראה כמו מסך הפתיחה שלפניהם. כאן אותו סולם מידות
 * (`.nw`) ואותם מרכיבים: כותרת, קו עם נקודה, שורת הסבר ואריחים גדולים.
 *
 * ברשת של שתי עמודות, מספר אי-זוגי של אפשרויות משאיר את האחרונה לבד -
 * והיא מתרחבת לרוחב מלא במקום להשאיר חור.
 */
export default function NurseryChoice({
  design,
  fontVars,
  title,
  subtitle,
  options,
  columns,
  onChoose,
  onBack,
}: Props) {
  const lastIsAlone = columns === 2 && options.length % 2 === 1;

  return (
    <div className={`nw nw-choice nw-${design}`} style={fontVars as CSSProperties}>
      <NurseryBackdrop design={design} mode="choice" />
      <button className="back-link glass" onClick={onBack}>
        ‹ חזרה
      </button>

      <div className="nw-choice-body">
        <h2 className="nw-title">{title}</h2>
        <div className="nw-rule">
          <b />
        </div>
        {subtitle && <p className="nw-rs">{subtitle}</p>}

        <div className={`nw-opts cols-${columns}`}>
          {options.map((opt, i) => (
            <button
              key={opt.key}
              className={`nw-opt${
                lastIsAlone && i === options.length - 1 ? ' wide' : ''
              }${opt.hint ? ' with-hint' : ''}`}
              onClick={() => onChoose(opt.key)}
            >
              {opt.tag && <span className="nw-opt-tag">{opt.tag}</span>}
              <span className="nw-opt-label">{opt.label}</span>
              {opt.hint && <span className="nw-opt-hint">{opt.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
