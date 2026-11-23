// האיורים של עיצובי «צבעי מים» במסלול ברית/בריתה - מצוירים ב-SVG.
//
// ⚠️ **HTML בלבד.** שום דבר מכאן לא מצויר על קנבס ההקלטה, ולכן האיורים
// לא נצרבים לסרטון. הם שייכים למסכים שלפני הצילום ואחריו.
//
// כשיהיה סט איורים מצויר ביד (PNG שקוף), מחליפים את גוף הרכיב ב-`<img>`
// ושומרים על אותו `className` - המיקום והגודל מגיעים מה-CSS ולא מכאן.

interface ArtProps {
  className?: string;
}

/**
 * פילטר «צבעי המים» והגרדיאנטים - **פעם אחת בעמוד**.
 *
 * הפילטר מעוות מעט את קווי המתאר ומוסיף פיגמנט לא אחיד, וזה מה שגורם
 * לווקטור שטוח להיראות מצויר. הרכיב חייב לשבת בתוך `<html>` שעליו מוגדר
 * `--il-accent`: הגרדיאנט של הבלון קורא את הצבע **מהמקום שבו הוא מוגדר**,
 * לא מהמקום שבו משתמשים בו.
 *
 * `width/height: 0` ולא `display: none` - בספארי פילטר שמוגדר בתוך אלמנט
 * מוסתר פשוט לא חל.
 */
export function NurseryDefs() {
  return (
    <svg className="nursery-defs" aria-hidden focusable="false">
      <defs>
        <filter id="nwc" x="-8%" y="-8%" width="116%" height="116%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="2" seed="3" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="3" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feTurbulence type="fractalNoise" baseFrequency=".5" numOctaves="3" seed="8" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.4" result="ga" />
          <feComposite in="d" in2="ga" operator="in" result="g" />
          <feGaussianBlur in="g" stdDeviation=".3" />
        </filter>
        <linearGradient id="nTan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dcc09a" />
          <stop offset="1" stopColor="#b58f63" />
        </linearGradient>
        <radialGradient id="nCream" cx=".4" cy=".35" r=".8">
          <stop offset="0" stopColor="#fbf6ec" />
          <stop offset="1" stopColor="#d8c9b0" />
        </radialGradient>
        <radialGradient id="nB1" cx=".36" cy=".3" r=".8">
          <stop offset="0" stopColor="#fcf6ea" />
          <stop offset=".6" stopColor="#ead8bd" />
          <stop offset="1" stopColor="#cdb18a" />
        </radialGradient>
        <radialGradient id="nB2" cx=".36" cy=".3" r=".8">
          <stop offset="0" stopColor="#fdf8f0" />
          <stop offset=".6" style={{ stopColor: 'var(--il-accent)' }} />
          <stop offset="1" style={{ stopColor: 'var(--il-accent)' }} stopOpacity=".75" />
        </radialGradient>
        <radialGradient id="nB3" cx=".36" cy=".3" r=".8">
          <stop offset="0" stopColor="#fbf3e6" />
          <stop offset=".6" stopColor="#e3cba9" />
          <stop offset="1" stopColor="#c2a27a" />
        </radialGradient>
      </defs>
    </svg>
  );
}

const ACCENT = { fill: 'var(--il-accent)' } as const;
const SAGE = { fill: 'var(--il-sage)' } as const;

/** עגלת וינטג׳ עם שלושה בלונים. הבלון האמצעי והסרט נצבעים בצבע המשלים. */
export function Pram({ className }: ArtProps) {
  return (
    <svg className={className} viewBox="0 0 220 240" aria-hidden focusable="false">
      <g filter="url(#nwc)">
        <path
          d="M62 126Q50 100 40 80M62 126Q64 92 67 66M62 126Q78 104 89 85"
          fill="none" stroke="#8a6a50" strokeWidth=".8" strokeLinecap="round" opacity=".8"
        />
        <ellipse cx="38" cy="52" rx="19" ry="24" fill="url(#nB1)" />
        <path d="M38 76l-3 5h6z" fill="#c9a882" />
        <ellipse cx="92" cy="60" rx="17" ry="22" fill="url(#nB3)" />
        <path d="M92 82l-3 5h6z" fill="#c2a27a" />
        <ellipse cx="68" cy="38" rx="20" ry="25" fill="url(#nB2)" />
        <path d="M68 63l-3 5h6z" style={ACCENT} />
        <g fill="#fff" opacity=".5">
          <ellipse cx="31" cy="42" rx="4" ry="8" transform="rotate(20 31 42)" />
          <ellipse cx="61" cy="28" rx="4" ry="8" transform="rotate(20 61 28)" />
          <ellipse cx="86" cy="51" rx="3.5" ry="7" transform="rotate(20 86 51)" />
        </g>
        <g fill="none" stroke="#a88662" strokeWidth="1.8" opacity=".6">
          <circle cx="118" cy="211" r="17" />
          <circle cx="176" cy="210" r="17" />
        </g>
        <g fill="none" stroke="#7d5c41" strokeLinecap="round">
          <path d="M90 194Q132 206 180 192" strokeWidth="2" />
          <path d="M101 197L98 214M160 198L158 214" strokeWidth="1.6" />
          <path d="M86 152Q66 146 62 124" strokeWidth="2.6" />
        </g>
        <path d="M134 150H186A52 52 0 0 0 120.5 99.8Z" fill="url(#nCream)" stroke="#b9a587" strokeWidth="1" />
        <path
          d="M134 150L182.9 132.2M134 150L170.8 113.2M134 150L151.8 101.1M134 150V98"
          fill="none" stroke="#b9a587" strokeWidth=".9" opacity=".8"
        />
        <path
          d="M84 150H184Q186 152 184 158L174 188Q172 195 163 195H105Q96 195 94 188L84 158Q82 152 84 150Z"
          fill="url(#nTan)"
        />
        <path
          d="M88 162Q134 168 180 162M91 172Q134 178 177 172M95 183Q134 189 173 183"
          fill="none" stroke="#8a6a50" strokeWidth=".7" opacity=".35"
        />
        <path d="M82 150H186" stroke="#8a6a50" strokeWidth="3" strokeLinecap="round" />
        <path d="M104 160q-13-10-14 2q1 10 14-2zM104 160q13-10 14 2q-1 10-14-2z" style={ACCENT} />
        <path
          d="M103 162q-4 10-9 14M105 162q3 10 8 15"
          fill="none" strokeWidth="2" strokeLinecap="round" style={{ stroke: 'var(--il-accent)' }}
        />
        <circle cx="104" cy="160" r="2.6" style={ACCENT} />
        <g fill="none" stroke="#7d5c41">
          <circle cx="98" cy="214" r="17" strokeWidth="2.2" />
          <circle cx="158" cy="214" r="19" strokeWidth="2.2" />
          <path
            d="M81 214H115M98 197V231M86 202L110 226M110 202L86 226M139 214H177M158 195V233M144.6 200.6L171.4 227.4M171.4 200.6L144.6 227.4"
            strokeWidth=".8"
          />
        </g>
        <circle cx="98" cy="214" r="2.8" fill="#7d5c41" />
        <circle cx="158" cy="214" r="3" fill="#7d5c41" />
      </g>
    </svg>
  );
}

/** ענף עלים בודד, גדל מלמטה למעלה. מסובבים ומשקפים אותו ב-CSS. */
export function Sprig({ className }: ArtProps) {
  return (
    <svg className={className} viewBox="0 0 60 120" aria-hidden focusable="false">
      <g filter="url(#nwc)">
        <path d="M30 118Q26 70 34 8" fill="none" stroke="#8a8f76" strokeWidth="1.4" strokeLinecap="round" />
        <g style={SAGE} opacity=".88">
          <ellipse cx="19" cy="97" rx="10" ry="6.5" transform="rotate(-32 19 97)" />
          <ellipse cx="42" cy="88" rx="10" ry="6.5" transform="rotate(32 42 88)" />
          <ellipse cx="18" cy="72" rx="9.5" ry="6" transform="rotate(-32 18 72)" />
          <ellipse cx="42" cy="63" rx="9.5" ry="6" transform="rotate(32 42 63)" />
          <ellipse cx="20" cy="48" rx="8.5" ry="5.5" transform="rotate(-32 20 48)" />
          <ellipse cx="42" cy="39" rx="8.5" ry="5.5" transform="rotate(32 42 39)" />
          <ellipse cx="24" cy="26" rx="7" ry="4.6" transform="rotate(-32 24 26)" />
          <ellipse cx="41" cy="18" rx="7" ry="4.6" transform="rotate(32 41 18)" />
          <ellipse cx="34" cy="7" rx="4.5" ry="6" />
        </g>
      </g>
    </svg>
  );
}

/** חבל כביסה: עלים, נעלי תינוק, בגד גוף (בצבע המשלים) וכוכב עץ. */
export function Garland({ className }: ArtProps) {
  return (
    <svg className={className} viewBox="0 0 400 84" aria-hidden focusable="false">
      <g filter="url(#nwc)">
        <path d="M12 14Q200 46 388 14" fill="none" stroke="#8a6a50" strokeWidth="1.2" strokeLinecap="round" />
        <path
          d="M12 14q-9-8-10 0q2 8 10 0M12 14q-5 8-9 11M388 14q9-8 10 0q-2 8-10 0M388 14q5 8 9 11"
          fill="none" stroke="#8a6a50" strokeWidth="1.1" strokeLinecap="round"
        />
        <path d="M62 22q2 16-2 32M338 22q-2 16 2 32" fill="none" stroke="#8a8f76" strokeWidth="1" />
        <g style={SAGE} opacity=".88">
          <ellipse cx="55" cy="31" rx="6" ry="3.8" transform="rotate(-30 55 31)" />
          <ellipse cx="68" cy="36" rx="6" ry="3.8" transform="rotate(30 68 36)" />
          <ellipse cx="55" cy="43" rx="5.5" ry="3.5" transform="rotate(-30 55 43)" />
          <ellipse cx="66" cy="48" rx="5.5" ry="3.5" transform="rotate(30 66 48)" />
          <ellipse cx="60" cy="57" rx="3.4" ry="4.6" />
          <ellipse cx="345" cy="31" rx="6" ry="3.8" transform="rotate(30 345 31)" />
          <ellipse cx="332" cy="36" rx="6" ry="3.8" transform="rotate(-30 332 36)" />
          <ellipse cx="345" cy="43" rx="5.5" ry="3.5" transform="rotate(30 345 43)" />
          <ellipse cx="334" cy="48" rx="5.5" ry="3.5" transform="rotate(-30 334 48)" />
          <ellipse cx="340" cy="57" rx="3.4" ry="4.6" />
        </g>
        <path d="M124 27v6M136 28v7M280 27v8" stroke="#8a6a50" strokeWidth=".8" />
        <g fill="#e6d3b6" stroke="#c4a783" strokeWidth=".6">
          <path d="M118 33h9v8h6q5 0 5 5v3h-20z" />
          <path d="M131 35h8v7h5q4 0 4 4.5v2.5h-17z" opacity=".9" />
        </g>
        <g transform="translate(200 30)">
          <path
            d="M-16 0H-7Q0 6 7 0H16L25 9L18 16L13 12V30Q13 35 8 37Q0 41-8 37Q-13 35-13 30V12L-18 16L-25 9Z"
            style={ACCENT} stroke="#fff" strokeOpacity=".5" strokeWidth=".8"
          />
          <path d="M0 24q-4-4-2.3-6.5q1.6-1.5 2.3.7q.7-2.2 2.3-.7q1.7 2.5-2.3 6.5z" fill="#fbf6ee" opacity=".9" />
          <path d="M-13-4v8M13-4v8" stroke="#b58f63" strokeWidth="2.4" strokeLinecap="round" />
        </g>
        <path
          transform="translate(280 46)"
          d="M0-11 3.2-3.4 11.3-3.4 4.7 1.5 7 9.7 0 4.8-7 9.7-4.7 1.5-11.3-3.4-3.2-3.4Z"
          fill="#dcc09a" stroke="#b58f63" strokeWidth=".6"
        />
        <g fill="#b58f63">
          <rect x="61" y="18" width="2.2" height="7" rx="1" />
          <rect x="337" y="18" width="2.2" height="7" rx="1" />
        </g>
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// האיורים של העיצובים הצבעוניים (כדור פורח, פפיון, משבצות, עננים).
// הצבע מגיע מ-`--il-tone*`: כחול בברית, ורוד בבריתה. ראו index.css.
// ---------------------------------------------------------------------------

const TONE = { fill: 'var(--il-tone)' } as const;
const TONE_DEEP = { fill: 'var(--il-tone-deep)' } as const;
const TONE_SOFT = { fill: 'var(--il-tone-soft)' } as const;

/** קו אורך של מעטפת הכדור: מהקודקוד, דרך הרוחב המרבי, אל הפתח */
function meridian(ox: number): string {
  return `C${60 + ox * 0.8} 8 ${60 + ox} 38 ${60 + ox} 64C${60 + ox} 92 ${60 + ox * 0.5} 112 ${60 + ox * 0.26} 128`;
}
/** אותו קו, מהפתח חזרה לקודקוד - כדי לסגור פלח בין שני קווים */
function meridianBack(ox: number): string {
  return `C${60 + ox * 0.5} 112 ${60 + ox} 92 ${60 + ox} 64C${60 + ox} 38 ${60 + ox * 0.8} 8 60 6`;
}
const GORE_EDGES = [-54, -36, -18, 0, 18, 36, 54];

/**
 * כדור פורח מפוספס. `teddy` מושיב דובי קטן בסל.
 * הפסים הם פלחים אמיתיים בין קווי אורך, ולכן הם מתעקלים עם הכדור.
 */
export function HotAirBalloon({ className, teddy }: ArtProps & { teddy?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 120 180" aria-hidden focusable="false">
      <g filter="url(#nwc)">
        {GORE_EDGES.slice(0, -1).map((ox, i) => (
          <path
            key={ox}
            d={`M60 6${meridian(ox)}L${60 + GORE_EDGES[i + 1] * 0.26} 128${meridianBack(GORE_EDGES[i + 1])}Z`}
            style={i % 2 === 0 ? TONE : undefined}
            fill={i % 2 === 0 ? undefined : '#fbf6ee'}
          />
        ))}
        <ellipse cx="38" cy="50" rx="9" ry="22" fill="#fff" opacity=".32" transform="rotate(14 38 50)" />
        <path d="M46 128H74L70 137H50Z" style={TONE_DEEP} />
        <path d="M50 137L52 151M70 137L68 151M60 137V151" stroke="#8a6a50" strokeWidth=".9" fill="none" />
        {teddy && (
          <g>
            <circle cx="53.5" cy="140.5" r="3.2" fill="#c39a70" />
            <circle cx="66.5" cy="140.5" r="3.2" fill="#c39a70" />
            <circle cx="60" cy="146" r="7.4" fill="#cfa77c" />
            <ellipse cx="60" cy="148.6" rx="3.5" ry="2.7" fill="#efdcc2" />
            <circle cx="57" cy="144.6" r=".9" fill="#5c4635" />
            <circle cx="63" cy="144.6" r=".9" fill="#5c4635" />
            <ellipse cx="60" cy="147.6" rx="1.1" ry=".8" fill="#5c4635" />
          </g>
        )}
        <path d="M49 150H71L69 164Q68 167 65 167H55Q52 167 51 164Z" fill="url(#nTan)" />
        <path d="M50 155H70M51 160H69" stroke="#8a6a50" strokeWidth=".7" opacity=".4" fill="none" />
        <path d="M48 150H72" stroke="#8a6a50" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** ענן צבעי מים: שכבת צבע ומעליה שכבה לבנה מוזזת, כך שנשאר «צל» רך בתחתית */
export function Cloud({ className }: ArtProps) {
  const puffs = (
    <>
      <circle cx="46" cy="72" r="30" />
      <circle cx="80" cy="50" r="36" />
      <circle cx="122" cy="56" r="34" />
      <circle cx="156" cy="74" r="26" />
      <circle cx="100" cy="80" r="34" />
      <ellipse cx="100" cy="86" rx="80" ry="20" />
    </>
  );
  return (
    <svg className={className} viewBox="0 0 200 116" aria-hidden focusable="false">
      <g filter="url(#nwc)">
        <g style={TONE} opacity=".5">{puffs}</g>
        <g fill="#fff" opacity=".62" transform="translate(7 -6) scale(.9)">{puffs}</g>
      </g>
    </svg>
  );
}

/** פפיון גדול עם שני זנבות */
export function Bow({ className }: ArtProps) {
  return (
    <svg className={className} viewBox="0 0 220 200" aria-hidden focusable="false">
      <g filter="url(#nwc)">
        <path d="M102 74C86 110 70 150 58 186L84 170C92 140 104 104 112 78Z" style={TONE} />
        <path d="M118 74C134 110 150 150 164 190L140 172C132 140 122 104 110 78Z" style={TONE} />
        <path d="M110 60C80 20 20 16 14 50C8 86 70 96 110 70Z" style={TONE} />
        <path d="M110 60C140 20 200 16 206 50C212 86 150 96 110 70Z" style={TONE} />
        <g fill="none" style={{ stroke: 'var(--il-tone-deep)' }} strokeWidth="2.4" strokeLinecap="round" opacity=".45">
          <path d="M104 62C80 44 46 40 30 54M116 62C140 44 174 40 190 54" />
          <path d="M100 88C92 112 82 140 74 162M120 88C128 112 138 140 148 164" />
        </g>
        <g fill="#fff" opacity=".3">
          <path d="M100 48C78 30 44 26 28 40C50 34 78 40 98 56Z" />
          <path d="M120 48C142 30 176 26 192 40C170 34 142 40 122 56Z" />
        </g>
        <ellipse cx="110" cy="65" rx="13" ry="15" style={TONE_DEEP} />
        <ellipse cx="107" cy="61" rx="5" ry="7" fill="#fff" opacity=".25" />
      </g>
    </svg>
  );
}

const SCALLOPS = Array.from({ length: 46 }, (_, i) => {
  const t = (i / 46) * Math.PI * 2;
  return { x: 200 + 181 * Math.cos(t), y: 300 + 281 * Math.sin(t) };
});

/** מסגרת אובלית עם שוליים מסולסלים וקו תפר לבן */
export function ScallopOval({ className }: ArtProps) {
  return (
    <svg className={className} viewBox="0 0 400 600" aria-hidden focusable="false">
      <g style={TONE} opacity=".55">
        {SCALLOPS.map((p, i) => (
          <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r="17" />
        ))}
      </g>
      <ellipse cx="200" cy="300" rx="180" ry="280" fill="#fff" opacity=".7" />
      <ellipse cx="200" cy="300" rx="172" ry="272" style={TONE_SOFT} />
      <ellipse
        cx="200" cy="300" rx="160" ry="260"
        fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="7 7" opacity=".9"
      />
    </svg>
  );
}

/** שני בלונים רגילים על חוטים */
export function Balloons({ className }: ArtProps) {
  return (
    <svg className={className} viewBox="0 0 110 190" aria-hidden focusable="false">
      <g filter="url(#nwc)">
        <path d="M40 84Q46 130 52 186M72 70Q64 130 54 186" fill="none" stroke="#8a6a50" strokeWidth=".9" opacity=".7" />
        <ellipse cx="38" cy="52" rx="24" ry="29" fill="url(#nB1)" />
        <path d="M38 81l-3 5h6z" fill="#c9a882" />
        <ellipse cx="74" cy="38" rx="25" ry="30" style={TONE} />
        <path d="M74 68l-3 5h6z" style={TONE_DEEP} />
        <g fill="#fff" opacity=".45">
          <ellipse cx="30" cy="42" rx="5" ry="10" transform="rotate(20 30 42)" />
          <ellipse cx="65" cy="27" rx="5" ry="10" transform="rotate(20 65 27)" />
        </g>
      </g>
    </svg>
  );
}

const SPARKS: [number, number, number][] = [
  [20, 30, 2.2], [48, 12, 1.4], [70, 44, 1.8], [102, 20, 1.2], [130, 52, 2],
  [156, 16, 1.5], [180, 40, 1.1], [34, 70, 1.3], [88, 78, 1.6], [146, 84, 1.2],
  [60, 96, 1], [116, 100, 1.4], [172, 72, 1.7], [12, 92, 1.1],
];

/** נצנוצי זהב פזורים */
export function Sparkles({ className }: ArtProps) {
  return (
    <svg className={className} viewBox="0 0 200 110" aria-hidden focusable="false">
      <g fill="#d9b767" opacity=".85">
        {SPARKS.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} />
        ))}
        <path d="M94 40l1.6 5.4 5.4 1.6-5.4 1.6-1.6 5.4-1.6-5.4-5.4-1.6 5.4-1.6z" />
        <path d="M160 58l1.2 4 4 1.2-4 1.2-1.2 4-1.2-4-4-1.2 4-1.2z" />
      </g>
    </svg>
  );
}

/**
 * רקע של פפיונים קטנים וענפים, ברוח טפט «טואל».
 * `viewBox` ביחס של אייפד לאורך עם `slice`, כדי שהדוגמה תתכווץ יחד עם
 * המסך (גם בתצוגה המקדימה) במקום להישאר בגודל פיקסלים קבוע.
 */
export function BowPattern({ className }: ArtProps) {
  return (
    <svg className={className} viewBox="0 0 454 654" preserveAspectRatio="xMidYMid slice" aria-hidden focusable="false">
      <defs>
        <pattern id="nBowTile" width="112" height="112" patternUnits="userSpaceOnUse">
          <g style={TONE} opacity=".42">
            <path d="M28 28c-7-9-20-9-21-2c-1 8 13 10 21 4zM28 28c7-9 20-9 21-2c1 8-13 10-21 4z" />
            <path d="M26 31c-3 8-6 15-9 21l6-3c2-6 4-11 6-17zM30 31c3 8 6 15 9 21l-6-3c-2-6-4-11-6-17z" />
            <circle cx="28" cy="29" r="3" />
          </g>
          <g fill="none" style={{ stroke: 'var(--il-tone)' }} strokeWidth="1.3" opacity=".4" strokeLinecap="round">
            <path d="M74 70q10 8 8 24M82 82q7-4 12-2M79 76q-7-3-12 0M84 90q6 0 10 4" />
          </g>
          <g style={TONE} opacity=".3">
            <circle cx="92" cy="22" r="2" />
            <circle cx="14" cy="88" r="2" />
            <circle cx="56" cy="62" r="1.5" />
          </g>
        </pattern>
      </defs>
      <rect width="454" height="654" fill="url(#nBowTile)" />
    </svg>
  );
}
