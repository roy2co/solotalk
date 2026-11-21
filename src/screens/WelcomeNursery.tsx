import type { CSSProperties } from 'react';
import type { AppConfig, BritDesign } from '../types';
import { formatEventDate, hebrewDate } from '../lib/event';
import { DEFAULT_CONFIG } from '../lib/config';
import { copyFor, displayName, eventTypeOf, openingLine } from '../lib/eventType';
import { Garland, Pram, Sprig } from '../components/NurseryArt';

interface Props {
  config: AppConfig;
  design: Exclude<BritDesign, 'classic'>;
  onStart: () => void;
}

/** מעל זה השם כבר לא נכנס בשורה אחת של קוביות, וחוזרים לכתב רגיל */
const MAX_BLOCK_LETTERS = 7;

/**
 * מסך הפתיחה של עיצובי «צבעי מים» במסלול ברית/בריתה.
 *
 * רכיב נפרד מ-`Welcome` ולא ענף בתוכו: המבנה שונה (אין בועות, אין בורר
 * ערכות, יש איורים שממוקמים יחסית לתמונה), ותנאים על כל שורה היו הופכים
 * את שני המסכים לבלתי קריאים.
 *
 * ⚠️ **כל המידות ב-`em`**, וגודל הגופן של השורש נגזר מהמסך (ראו `.nw`
 * ב-CSS). המסך תוכנן ל-45×65 יחידות — היחס של אייפד לאורך — ולכן הוא
 * נכנס בלי גלילה גם כשהאייפד שוכב: הוא פשוט מתכווץ לפי הגובה.
 */
export default function WelcomeNursery({ config, design, onStart }: Props) {
  const type = eventTypeOf(config);
  const name = displayName(config);
  const letters = [...name];
  const date = (config.activeEvent?.date || config.eventDate || '').trim();
  const hebrew = date ? hebrewDate(date) : null;
  // ה-💌 שייך למראה הקלאסי; כאן האיורים עושים את העבודה
  const invite = copyFor(type).invite.replace(/\s*💌\s*$/, '');

  // שם משפחה («משפחת כהן», לפני הכרזת השם) ארוך מדי לקוביות וכולל רווח
  const asBlocks =
    design === 'garland' &&
    letters.length > 0 &&
    letters.length <= MAX_BLOCK_LETTERS &&
    !/\s/.test(name);

  // שם ארוך מתכווץ במקום להישבר לשתי שורות ולדחוף את הכפתור מחוץ למסך
  const nameStyle: CSSProperties = {
    fontSize: `${Math.min(8.6, 62 / Math.max(letters.length, 1)).toFixed(2)}em`,
  };
  const blockStyle: CSSProperties = {
    fontSize: `${Math.min(4, 21 / Math.max(letters.length, 1)).toFixed(2)}em`,
  };

  const photo = (
    <div className="nw-photo">
      {config.couplePhotoDataUrl ? (
        <img src={config.couplePhotoDataUrl} alt={name} />
      ) : (
        <span className="nw-ph-cap">התמונה שלי</span>
      )}
    </div>
  );

  return (
    <div className={`nw nw-${design}`}>
      {design === 'garland' && <Garland className="nw-clothesline" />}

      {design === 'pram' &&
        (config.logoDataUrl ? (
          <img className="nw-logo" src={config.logoDataUrl} alt="לוגו" />
        ) : (
          <div className="nw-wm">SOLOTALK</div>
        ))}

      {asBlocks ? (
        <h1 className="nw-blocks" aria-label={name}>
          {letters.map((ch, i) => (
            <span className="nw-blk" style={blockStyle} key={i} aria-hidden>
              {ch}
            </span>
          ))}
        </h1>
      ) : (
        <h1 className="nw-name" style={nameStyle}>
          {name}
        </h1>
      )}

      <div className="nw-rule">
        <b />
      </div>
      {date && (
        <div className="nw-date">
          {formatEventDate(date)}
          {hebrew && ` · ${hebrew}`}
        </div>
      )}

      {design === 'pram' ? (
        <div className="nw-stage">
          <Sprig className="nw-sprig" />
          {photo}
          <Pram className="nw-pram" />
        </div>
      ) : (
        <div className="nw-stage2">
          <Sprig className="nw-sprig l" />
          <Sprig className="nw-sprig r" />
          {photo}
        </div>
      )}

      <p className="nw-invite">{invite}</p>
      {/* הטקסט החופשי מהדשבורד — רק אם המפעיל כתב משהו משלו. ברירת
          המחדל מנוסחת בקול של זוג ולא שייכת למסלול הזה. */}
      {config.welcomeText?.trim() &&
        config.welcomeText !== DEFAULT_CONFIG.welcomeText && (
          <p className="nw-sub">{config.welcomeText}</p>
        )}
      <div className="nw-open">{openingLine(config)}</div>
      <button className="nw-cta" onClick={onStart}>
        התחל
      </button>
      <div className="nw-foot">SOLOTALK · BY PARTYTALK</div>
    </div>
  );
}
