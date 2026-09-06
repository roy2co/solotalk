import type { CSSProperties } from 'react';
import type { Depth } from '../types';
import { DEPTH_LABELS } from '../types';
import { DEPTH_ICONS } from '../lib/depthIcons';

interface Props {
  onNext: (depth: Depth) => void;
  onBack: () => void;
}

const ORDER: Depth[] = ['blessing', 'few', 'many'];

// המשכים נגזרים מהכמות שבקונפיג בהנחת ~20-25 שניות לשאלה,
// ועוד הברכה הסוגרת שנוספת לכולם.
const CARD_INFO: Record<Depth, { hint: string; tag?: string }> = {
  blessing: { hint: 'ברכה קצרה מהלב · חצי דקה' },
  few: { hint: 'שיחה קלילה וכיפית · כדקה', tag: 'הכי פופולרי' },
  many: { hint: 'עד שנמאס · תקרה 4 דקות' },
};

export default function DepthScreen({ onNext, onBack }: Props) {
  return (
    <div className="screen">
      <button className="back-link glass" onClick={onBack}>
        ‹ חזרה
      </button>

      <h2>כמה בא לכם לשתף?</h2>
      <p className="subtitle">בחרו את החוויה שמתאימה לכם</p>

      <div className="cards">
        {ORDER.map((depth) => {
          const info = CARD_INFO[depth];
          return (
            <button
              key={depth}
              className="card glass"
              onClick={() => onNext(depth)}
            >
              {info.tag && <span className="tag">{info.tag}</span>}
              <span
                className="card-icon"
                style={{ '--icon': `url("${DEPTH_ICONS[depth]}")` } as CSSProperties}
                aria-hidden
              />
              <span className="name">{DEPTH_LABELS[depth]}</span>
              <span className="hint">{info.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
