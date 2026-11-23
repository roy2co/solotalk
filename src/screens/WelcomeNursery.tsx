import type { CSSProperties } from 'react';
import type { AppConfig, BritDesign } from '../types';
import { formatEventDate, hebrewDate } from '../lib/event';
import { DEFAULT_CONFIG } from '../lib/config';
import { britWelcomeTexts, displayName } from '../lib/eventType';
import { Pram, Sprig } from '../components/NurseryArt';
import NurseryBackdrop from '../components/NurseryBackdrop';

interface Props {
  config: AppConfig;
  design: BritDesign;
  onStart: () => void;
  /**
   * תצוגה מקדימה ממוזערת בדשבורד. הכפתור הופך לטקסט בלבד (התצוגה יושבת
   * בתוך כפתור בחירה, וכפתור בתוך כפתור אינו חוקי), והגודל נקבע ע"י
   * העוטף במקום ע"י המסך.
   */
  preview?: boolean;
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
 * ב-CSS). המסך תוכנן ל-45×65 יחידות - היחס של אייפד לאורך - ולכן הוא
 * נכנס בלי גלילה גם כשהאייפד שוכב: הוא פשוט מתכווץ לפי הגובה.
 */
export default function WelcomeNursery({ config, design, onStart, preview }: Props) {
  const name = displayName(config);
  const letters = [...name];
  const date = (config.activeEvent?.date || config.eventDate || '').trim();
  const hebrew = date ? hebrewDate(date) : null;
  const { invite, open } = britWelcomeTexts(config);
  const photoUrl = config.couplePhotoDataUrl;

  // שם משפחה («משפחת כהן», לפני הכרזת השם) ארוך מדי לקוביות וכולל רווח
  const asBlocks =
    design === 'garland' &&
    letters.length > 0 &&
    letters.length <= MAX_BLOCK_LETTERS &&
    !/\s/.test(name);

  /**
   * העיצובים הצבעוניים מציבים את התוכן **בתוך מסגרת** (קשת או אליפסה),
   * ולכן הוא ממורכז כקבוצה אחת והשם מקבל פחות רוחב. בשני העיצובים
   * היוניסקס האיורים הם חלק מהתוכן עצמו (עגלה ליד התמונה).
   */
  const framed = design !== 'pram' && design !== 'garland';
  const nameRoom = design === 'bow' ? 42 : framed ? 50 : 62;
  const nameMax = design === 'bow' ? 7.4 : 8.6;

  // שם ארוך מתכווץ במקום להישבר לשתי שורות ולדחוף את הכפתור מחוץ למסך
  const nameStyle: CSSProperties = {
    fontSize: `${Math.min(nameMax, nameRoom / Math.max(letters.length, 1)).toFixed(2)}em`,
  };
  const blockStyle: CSSProperties = {
    fontSize: `${Math.min(4, 21 / Math.max(letters.length, 1)).toFixed(2)}em`,
  };

  const photo = photoUrl && (
    <div className="nw-photo">
      <img src={photoUrl} alt={name} />
    </div>
  );

  return (
    <div
      className={`nw nw-${design}${framed ? ' nw-framed' : ''}${preview ? ' nw-preview' : ''}`}
    >
      <NurseryBackdrop design={design} mode="welcome" />

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

      {/*
        בלי תמונה אין עיגול ריק: העגלה תופסת את המרכז לבדה. מקום שמור
        ל«התמונה שלי» נראה כמו משהו ששכחו למלא, מול אורחים.
      */}
      {framed ? (
        // המסגרת והאיורים כבר ממלאים את המסך; תמונה, אם יש, נכנסת קטנה
        photo && <div className="nw-stage-framed">{photo}</div>
      ) : !photo ? (
        <div className="nw-stage solo">
          <Sprig className="nw-sprig l" />
          <Sprig className="nw-sprig r" />
          <Pram className="nw-pram" />
        </div>
      ) : design === 'pram' ? (
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

      {/* קבוצה אחת שנדחפת לתחתית, כדי שהסתרת אחת השורות לא תזיז את הכפתור */}
      <div className="nw-bottom">
      {invite && <p className="nw-invite">{invite}</p>}
      {/* הטקסט החופשי מהדשבורד - רק אם המפעיל כתב משהו משלו. ברירת
          המחדל מנוסחת בקול של זוג ולא שייכת למסלול הזה. */}
      {config.welcomeText?.trim() &&
        config.welcomeText !== DEFAULT_CONFIG.welcomeText && (
          <p className="nw-sub">{config.welcomeText}</p>
        )}
      {open && <div className="nw-open">{open}</div>}
      {preview ? (
        <span className="nw-cta">התחל</span>
      ) : (
        <button className="nw-cta" onClick={onStart}>
          התחל
        </button>
      )}
      <div className="nw-foot">SOLOTALK · BY PARTYTALK {new Date().getFullYear()}</div>
      </div>
    </div>
  );
}
