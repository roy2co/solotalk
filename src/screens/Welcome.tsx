import { useMemo, useState } from 'react';
import type { AppConfig, ThemeName } from '../types';
import { THEME_OPTIONS } from '../types';
import { formatEventDate } from '../lib/event';
import { DEFAULT_CONFIG } from '../lib/config';
import { copyFor, displayName, eventTypeOf, genderize, isBritType } from '../lib/eventType';
import defaultLogo from '../assets/logo.png';

interface Props {
  config: AppConfig;
  onStart: () => void;
  onThemeChange: (theme: ThemeName) => void;
}

// מיקומים קבועים לבועות — צמודות לקצוות בלבד, כדי לא לחפוף לתוכן המרכזי (לוגו/שם/כפתור)
const BUBBLE_SPOTS = [
  { top: '10%', left: '3%', delay: '0s', far: false },
  { top: '22%', right: '3%', delay: '-3s', far: false },
  { top: '42%', left: '2%', delay: '-5s', far: true },
  { bottom: '22%', right: '4%', delay: '-2s', far: false },
  { bottom: '9%', left: '5%', delay: '-6s', far: true },
  { top: '6%', right: '20%', delay: '-4s', far: true },
];

function sampleQuestions(config: AppConfig): string[] {
  try {
    // הבועות הן טעימה ממה שהאורח יישאל, ולכן הן חייבות לבוא מהמאגר של
    // המסלול הפעיל — שאלות על «החתן והכלה» בברית היו פשוט טעות.
    const type = eventTypeOf(config);
    const source = isBritType(type)
      ? (config.britQuestions ?? [])
      : [...config.genericQuestions, ...config.customQuestions];
    const pool = source
      .map((q) => genderize(q.text.trim(), type))
      .filter((t) => t && t.length < 45);
    const seen = new Set<string>();
    const unique = pool.filter((t) => (seen.has(t) ? false : seen.add(t)));
    return unique.slice(0, BUBBLE_SPOTS.length);
  } catch (e) {
    console.error('sampleQuestions error:', e);
    return [];
  }
}

export default function Welcome({ config, onStart, onThemeChange }: Props) {
  const [isThemeOpen, setIsThemeOpen] = useState(false);

  const bubbles = useMemo(() => sampleQuestions(config), [config]);

  const eventName = displayName(config);
  const copy = copyFor(eventTypeOf(config));
  const eventDate = config.activeEvent?.date || config.eventDate;

  const activeTheme = config.theme || 'gold';

  return (
    <>
      {/* בורר ערכות צבע מקומי — חץ + סרגל ללמטה */}
      <div className="theme-picker-welcome">
        <button
          className="theme-arrow"
          onClick={() => setIsThemeOpen(!isThemeOpen)}
          aria-label="בחר ערכת צבע"
        >
          {isThemeOpen ? '▼' : '›'}
        </button>

        {isThemeOpen && (
          <div className="theme-dropdown" onClick={(e) => e.stopPropagation()}>
            <div className="theme-swatches-dropdown">
              {THEME_OPTIONS.map((theme) => (
                <button
                  key={theme}
                  className={`swatch ${theme} ${activeTheme === theme ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onThemeChange(theme);
                  }}
                  title={theme}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bubbles" aria-hidden>
        {bubbles.map((q, i) => {
          const spot = BUBBLE_SPOTS[i];
          const { delay, far, ...pos } = spot;
          return (
            <div
              key={q}
              className={`bubble glass${far ? ' far' : ''}`}
              style={{ ...pos, animationDelay: delay }}
            >
              {q}
            </div>
          );
        })}
      </div>

      <div className="screen welcome-screen" onClick={() => isThemeOpen && setIsThemeOpen(false)}>
        <img
          className="welcome-logo small"
          src={config.logoDataUrl || defaultLogo}
          alt="לוגו"
        />

        {/* השמות מיד מתחת ללוגו: זה מה שהאורח בא לראות, ולכן הוא מקבל את
            המקום הגבוה ביותר. ה-ON AIR ירד לתחתית — הוא אווירה, לא מידע. */}
        {/* ON AIR עולה לראש: הוא אומר «העמדה חיה עכשיו», וזה מידע —
            לא אווירה. בתחתית הוא היה קישוט שאיש לא ראה. */}
        <div className="on-air glass">
          <span className="live-dot" />
          ON AIR
        </div>

        <h1 className="event-names">
          <span className="gradient-text">{eventName}</span>
        </h1>
        {eventDate && (
          <div className="event-date">{formatEventDate(eventDate)}</div>
        )}

        <div className="photo-wrap">
          <div className="photo-halo" />
          <div className="photo-ring" />
          <div className="photo-frame">
            {config.couplePhotoDataUrl ? (
              <img
                className="couple-photo"
                src={config.couplePhotoDataUrl}
                alt={eventName}
              />
            ) : (
              <div className="photo-placeholder">
                <span className="glyph">{copy.photoGlyph}</span>
                <span className="cap">{copy.photoCaption}</span>
              </div>
            )}
          </div>
        </div>

        {/**
          * ההזמנה נקראת **ממרחק**, ולכן היא בגופן הכותרות ולא בטקסט הגוף.
          * זו ההוראה היחידה שהאורח צריך כאן; כל השאר מחכה למסך הבא.
          * הטקסט החופשי מהדשבורד יורד לשורה משנית מתחתיה.
          */}
        <p className="welcome-invite">{copy.invite}</p>
        {/* ברירת המחדל כתובה בקול של זוג («השאירו לנו ברכה»), ובמסלול ברית
            היא סותרת את ההזמנה שמעליה. טקסט שהמפעיל כתב בעצמו — מוצג תמיד. */}
        {config.welcomeText?.trim() &&
          !(isBritType(eventTypeOf(config)) &&
            config.welcomeText === DEFAULT_CONFIG.welcomeText) && (
            <p className="subtitle welcome-sub">{config.welcomeText}</p>
          )}

        <div className="cta-zone">
          <div className="cta-halo" aria-hidden />
          <button className="btn btn-shimmer" onClick={onStart}>
            התחל
          </button>
        </div>


      </div>

      {/* SOLOTALK branding at bottom */}
      <div className="solotalk-branding">
        SOLOTALK · BY <b>PARTYTALK</b>
      </div>
    </>
  );
}
