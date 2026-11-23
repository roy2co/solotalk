import type { CSSProperties } from 'react';
import type { Depth } from '../types';
import { DEPTH_LABELS } from '../types';
import { DEPTH_ICONS } from '../lib/depthIcons';
import { DEPTH_CARD_INFO, DEPTH_ORDER } from '../lib/depthCards';

interface Props {
  onNext: (depth: Depth) => void;
  onBack: () => void;
}

export default function DepthScreen({ onNext, onBack }: Props) {
  return (
    <div className="screen">
      <button className="back-link glass" onClick={onBack}>
        ‹ חזרה
      </button>

      <h2>כמה בא לכם לשתף?</h2>
      <p className="subtitle">בחרו את החוויה שמתאימה לכם</p>

      <div className="cards">
        {DEPTH_ORDER.map((depth) => {
          const info = DEPTH_CARD_INFO[depth];
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
