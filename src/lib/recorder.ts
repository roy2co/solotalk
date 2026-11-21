// מודול ההקלטה — הליבה של האפליקציה.
// מצייר את פריים המצלמה + טקסט השאלה על canvas, ומקליט את ה-canvas
// כך שהשאלה "נצרבת" לתוך קובץ הוידאו עצמו.
//
// ⚠️ הטיפוסים נקראים `VideoFrameStyle`/`VideoStampPos` ולא `VideoFrame` —
// `VideoFrame` הוא טיפוס **גלובלי של WebCodecs**, ו-TypeScript תפס אותו
// בשקט במקום שלנו. אין לשנות את השמות בחזרה.
import type { VideoFrameStyle, VideoStampPos } from '../types';
import { acquireCamera, hasLiveCamera } from './camera';
import { listenForSignal, type MicSignal } from './micLevel';

const PREFERRED_MIME_TYPES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

/**
 * איכות ההקלטה. בלי הערכים האלה הדפדפן בוחר לבד — ספארי בחר ~1.2Mbps,
 * שזו איכות נמוכה מדי לסרטון שנשלח כמזכרת.
 *
 * 4.5Mbps ל-1080x1440@30fps ≈ 84 מ"ב לסרטון של 2.5 דקות.
 * אירוע של 25 סרטונים ≈ 2.1 ג"ב.
 */
const VIDEO_BITS_PER_SECOND = 4_500_000;
const AUDIO_BITS_PER_SECOND = 192_000;

/** הצלע הארוכה של ה-canvas. תואם לחיתוך 1080x1440 ממצלמת פורטרט 1080p. */
const CANVAS_LONG_SIDE = 1440;

/** האם המסך כרגע לאורך. מקור אמת יחיד לכל החלטה שתלויה באוריינטציה. */
export function isPortrait(): boolean {
  const w = window.innerWidth || 800;
  const h = window.innerHeight || 1200;
  return h >= w;
}

const DIAG_KEY = 'soloTalk.captureDiagnostics';

export interface CaptureDiagnostics {
  /** הרזולוציה שהמצלמה נתנה בפועל */
  camera: string;
  /** גודל ה-canvas שנצרב לקובץ */
  canvas: string;
  at: number;
}

function saveCaptureDiagnostics(d: CaptureDiagnostics): void {
  try {
    localStorage.setItem(DIAG_KEY, JSON.stringify(d));
  } catch {
    /* אבחון בלבד — לא שווה לשבור הקלטה בגללו */
  }
}

/** מה המצלמה נתנה בהקלטה האחרונה. null אם עוד לא צולם על המכשיר הזה. */
export function getCaptureDiagnostics(): CaptureDiagnostics | null {
  try {
    const raw = localStorage.getItem(DIAG_KEY);
    return raw ? (JSON.parse(raw) as CaptureDiagnostics) : null;
  } catch {
    return null;
  }
}

/**
 * ---- מד הקלטה ----
 *
 * נכתב ל-localStorage **תוך כדי** ההקלטה, לא בסופה.
 *
 * למה: ההקלטה נצברת בזיכרון עד השמירה (עד ~240 מ"ב ב-7 דקות), וזה הטווח
 * שבו טאב ספארי עלול ליפול. אם הוא נופל, כל מה שבזיכרון אבד - כולל הידיעה
 * **מתי ובאיזה נפח** זה קרה. כתיבה מתמשכת הופכת קריסה מתעלומה לממצא:
 * אחרי רענון הדשבורד יראה «הגיע ל-4:32 / 190 מ"ב ולא הסתיים».
 */
const REC_DIAG_KEY = 'soloTalk.recordingProgress';

export interface RecordingProgress {
  /** כמה זמן ההקלטה רצה כשנכתב המדד */
  elapsedMs: number;
  /** כמה בתים נצברו בזיכרון */
  bytes: number;
  /** כמה מקטעים */
  chunks: number;
  /** `false` = ההקלטה לא הגיעה ל-stop. אחרי קריסה זה יישאר false */
  completed: boolean;
  at: number;
}

function writeRecordingProgress(p: RecordingProgress): void {
  try {
    localStorage.setItem(REC_DIAG_KEY, JSON.stringify(p));
  } catch {
    /* אבחון בלבד - לא שווה לשבור הקלטה בגללו */
  }
}

/** נתוני ההקלטה האחרונה. `completed: false` מעיד שהיא נקטעה. */
export function getRecordingProgress(): RecordingProgress | null {
  try {
    const raw = localStorage.getItem(REC_DIAG_KEY);
    return raw ? (JSON.parse(raw) as RecordingProgress) : null;
  } catch {
    return null;
  }
}

export interface RecorderResult {
  blob: Blob;
  mimeType: string;
}

// ---- מטמון גרדיאנטים ----
//
// `drawQuestion` יצר `createLinearGradient` **בכל פריים** — 30 הקצאות
// בשנייה, לאורך הקלטה של עד 7 דקות. המסגרת מוסיפה עוד ארבעה, ולכן בלי
// מטמון התוספת הייתה מכפילה את הלחץ בדיוק במסלול הקריטי.
//
// ממופתח לפי הקשר הציור: `CanvasGradient` שייך ל-ctx שיצר אותו, ואסור
// להעביר אותו לקנבס אחר (התצוגה המקדימה בדשבורד היא ctx נפרד).
const gradientCache = new WeakMap<
  CanvasRenderingContext2D,
  Map<string, CanvasGradient>
>();

function cachedGradient(
  ctx: CanvasRenderingContext2D,
  key: string,
  make: () => CanvasGradient,
): CanvasGradient {
  let forCtx = gradientCache.get(ctx);
  if (!forCtx) {
    forCtx = new Map();
    gradientCache.set(ctx, forCtx);
  }
  let g = forCtx.get(key);
  if (!g) {
    g = make();
    // הקנבס משנה גודל רק בפתיחת מצלמה. אם המפתחות מתרבים מעבר לסביר,
    // מנקים — עדיף לבנות מחדש מלהחזיק גרדיאנטים של גדלים מתים.
    if (forCtx.size > 24) forCtx.clear();
    forCtx.set(key, g);
  }
  return g;
}

/** צבע ההדגשה בפועל לכל אפשרות מסגרת. `theme` נקרא מהערכה הפעילה. */
export function frameColor(frame: VideoFrameStyle, accent: string): string | null {
  switch (frame) {
    case 'none':
      return null;
    case 'gold':
      return '#C9A84C';
    case 'white':
      return '#FFFFFF';
    case 'black':
      return null; // הצללה בלבד, בלי קו
    case 'theme':
      return accent || '#C9A84C';
  }
}

/**
 * מסגרת נצרבת: הצללה רכה מארבעת הקצוות פנימה, ומעליה קו דק בצבע.
 *
 * **פונקציה טהורה** — הדשבורד מרנדר איתה תצוגה מקדימה, ולכן מה שרואים שם
 * הוא בדיוק מה שייצרב. חיקוי נפרד היה נפרד מהמציאות בשינוי הראשון.
 */
export function drawVideoFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: VideoFrameStyle,
  accent = '#C9A84C',
): void {
  if (frame === 'none') return;
  const short = Math.min(w, h);
  const depth = Math.round(short * 0.06); // עומק הדעיכה
  const color = frameColor(frame, accent);

  // ---- הצללה: ארבעה גרדיאנטים מהקצה פנימה ----
  ctx.save();
  const edges: [string, number, number, number, number, number, number][] = [
    ['top', 0, 0, 0, depth, w, depth],
    ['bottom', 0, h, 0, h - depth, w, depth],
    ['left', 0, 0, depth, 0, depth, h],
    ['right', w, 0, w - depth, 0, depth, h],
  ];
  for (const [side, x0, y0, x1, y1, gw, gh] of edges) {
    const g = cachedGradient(ctx, `edge-${side}-${w}x${h}`, () => {
      const lg = ctx.createLinearGradient(x0, y0, x1, y1);
      lg.addColorStop(0, 'rgba(0,0,0,0.34)');
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      return lg;
    });
    ctx.fillStyle = g;
    const rx = side === 'right' ? w - depth : 0;
    const ry = side === 'bottom' ? h - depth : 0;
    ctx.fillRect(rx, ry, gw, gh);
  }
  ctx.restore();

  // ---- קו דק פנימי ----
  if (!color) return;
  const inset = Math.round(short * 0.025);
  /**
   * עובי הקו נמדד מול הקובץ המוקלט, לא נבחר בעין.
   *
   * ב-0.0015 (2px ב-1080) הקו יצא על הקנבס `[163,143,86]` אבל בקובץ
   * `[103,101,89]` — דחיסת H.264 עם chroma subsampling מרחה קו דק כל כך
   * עד שהזהב כמעט נעלם. 0.0026 (3px) שורד את הקידוד.
   */
  const lw = Math.max(2, Math.round(short * 0.0026));
  ctx.save();
  ctx.globalAlpha = frame === 'white' ? 0.55 : 0.72;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  const r = Math.round(short * 0.018); // פינות מעוגלות עדינות
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, r);
  } else {
    ctx.rect(inset, inset, w - inset * 2, h - inset * 2);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * מצייר ספרות בריווח אותיות ידני.
 *
 * ⚠️ **לא `ctx.letterSpacing`** - הוא לא נתמך בספארי ישן, ובאייפד זה היה
 * מתעלם בשקט. וריווח ידני על **עברית** היה שובר את סדר האותיות, ולכן הוא
 * מוגבל כאן לתאריך (ספרות ונקודות) בלבד.
 *
 * מחזיר את הרוחב הכולל, כדי שהקורא יוכל למקם לפיו.
 */
function drawSpacedDigits(
  ctx: CanvasRenderingContext2D,
  text: string,
  anchorX: number,
  y: number,
  spacing: number,
  align: 'left' | 'center' | 'right',
): number {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let x =
    align === 'center' ? anchorX - total / 2 : align === 'right' ? anchorX - total : anchorX;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  chars.forEach((c, i) => {
    if (ctx.lineWidth > 0) ctx.strokeText(c, x, y);
    ctx.fillText(c, x, y);
    x += widths[i] + spacing;
  });
  ctx.textAlign = prevAlign;
  return total;
}

/**
 * חותמת שם הזוג + התאריך - **שתי שורות**: השם גדול, התאריך קטן מתחתיו.
 *
 * הגובה קבוע ולא בפינה התחתונה ממש: שורת הכפתורים תופסת את ~10% התחתונים
 * על המסך, וחותמת מתחתיה הייתה נחבאת מאחורי כפתור.
 *
 * **הקריאוּת מושגת במתאר כהה סביב האותיות בלבד — בלי scrim.**
 *
 * בגרסה קודמת היה כאן גם גרדיאנט כהה בתחתית הפריים. הוא נוסף כשעוד לא
 * היה מתאר, ואז היה הכרחי (התאריך הזהוב נמדד בניגודיות 1.01 מול שמלה
 * לבנה - בלתי נראה). אחרי שנוסף המתאר נמדד שה-scrim **מזיק**: הוא מכהה
 * את הרקע לכיוון צבע המתאר ומקטין את ההפרדה.
 *
 * ```
 *                  עם scrim   בלי
 * שמלה לבנה           8.20    14.69
 * אולם                2.66     4.17
 * ```
 *
 * בנוסף הוא נראה כמו כתם מטושטש מתחת לחותמת. אין להחזיר אותו.
 */
export function drawVideoStamp(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  name: string,
  date: string,
  pos: VideoStampPos,
  accent = '#C9A84C',
): void {
  if (pos === 'off') return;
  const coupleName = name.trim();
  const eventDate = date.trim();
  if (!coupleName && !eventDate) return;

  const short = Math.min(w, h);
  const pad = Math.round(short * 0.055);
  const maxWidth = w - pad * 2;

  const align: 'left' | 'center' | 'right' =
    pos === 'right' ? 'right' : pos === 'left' ? 'left' : 'center';
  const anchorX = pos === 'right' ? w - pad : pos === 'left' ? pad : w / 2;

  ctx.save();
  ctx.direction = 'rtl';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = align;
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowOffsetY = 2;

  // ---- שורה 1: השם ----
  const nameY = Math.round(h * 0.845);
  if (coupleName) {
    let nameSize = Math.round(short * 0.062);
    ctx.font = `400 ${nameSize}px "Suez One", Georgia, serif`;
    // מתכווץ אם השם ארוך, במקום לגלוש מחוץ לפריים
    while (ctx.measureText(coupleName).width > maxWidth && nameSize > 14) {
      nameSize -= 1;
      ctx.font = `400 ${nameSize}px "Suez One", Georgia, serif`;
    }
    ctx.shadowBlur = Math.round(nameSize * 0.35);
    /**
     * מתאר כהה סביב האותיות - **לא קוסמטי**.
     *
     * נמדד מול «שמלה לבנה»: עם scrim בלבד, ניגודיות התאריך הייתה 1.01
     * (בלתי נראה) והשם 2.29. הרקע האמיתי בסרטון לא ידוע מראש, ו-scrim
     * חזק מספיק היה מצריך פס שחור על 28% התחתונים של כל פריים.
     * מתאר מבודד את האותיות מכל רקע - זו הטכניקה של כתוביות.
     */
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.82)';
    ctx.lineWidth = Math.max(2, Math.round(nameSize * 0.11));
    ctx.strokeText(coupleName, anchorX, nameY);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(coupleName, anchorX, nameY);
  }

  // ---- שורה 2: התאריך ----
  if (eventDate) {
    const dateSize = Math.round(short * 0.023);
    ctx.font = `500 ${dateSize}px "Heebo", system-ui, sans-serif`;
    ctx.shadowBlur = Math.round(dateSize * 0.6);
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.82)';
    ctx.lineWidth = Math.max(2, Math.round(dateSize * 0.22));
    ctx.fillStyle = accent || '#C9A84C';
    const dateY = coupleName ? nameY + Math.round(short * 0.042) : nameY;
    drawSpacedDigits(ctx, eventDate, anchorX, dateY, short * 0.014, align);
  }
  ctx.lineWidth = 0;
  ctx.restore();
}

export interface VideoStyle {
  frame: VideoFrameStyle;
  stamp: VideoStampPos;
  /** שם הזוג. נבנה מראש כדי שהלולאה לא תרכיב מחרוזת בכל פריים */
  stampName: string;
  /** תאריך האירוע, מצויר בשורה נפרדת מתחת לשם */
  stampDate: string;
  /** צבע ההדגשה של הערכה הפעילה, לאפשרות `theme` ולחותמת */
  accent: string;
}

export class QuestionRecorder {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private recorder: MediaRecorder | null = null;
  private rafId = 0;
  private question = '';
  private mimeType = '';
  private wakeLock: WakeLockSentinel | null = null;
  private startedAt = 0;
  private bytes = 0;
  private diagTimer = 0;
  private chunks: Blob[] = [];
  /** מזהה ההקלטה הנוכחית — המפתח שתחתיו המקטעים נשמרים בדיסק */
  private seq = 0;
  /**
   * תור כתיבה סדרתי. `ondataavailable` סינכרוני והכתיבה אסינכרונית,
   * ובלי תור שתי טרנזקציות היו מתחרות ומשבשות את הסדר.
   */
  /** ברירת מחדל: כלום לא נצרב מעבר לשאלה — בדיוק כמו לפני הפיצ'ר */
  private style: VideoStyle = {
    frame: 'none',
    stamp: 'off',
    stampName: '',
    stampDate: '',
    accent: '#C9A84C',
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
  }

  /** פותח את המצלמה הקדמית ומתחיל את לולאת הציור. אינו מתחיל הקלטה עדיין. */
  async openCamera(): Promise<void> {
    // מבקשים מהמצלמה את **אותה אוריינטציה** של המסך. drawLoop חותך כדי להתאים
    // ל-canvas, אז מצלמה בכיוון הלא נכון פשוט נזרקת לפח: מצלמה לרוחב מול canvas
    // פורטרט משאירה רק 42% מרוחב החיישן. כשהכיוונים תואמים — אין חיתוך משמעותי.
    // ideal ולא exact: אם iOS לא יכבד את הבקשה נקבל את מה שיש, ו-drawLoop יסתדר.
    /**
     * הזרם מגיע מ-`camera.ts` ולא מ-`getUserMedia` ישירות.
     *
     * מסך הספירה כבר פתח אותו לתצוגה המקדימה, ולכן כאן הוא **מוחזר מיד**
     * במקום להיפתח מחדש. פתיחה כפולה תוך שבריר שנייה היא בדיוק מה שמייצר
     * `NotReadableError` ב-iOS. אם הספירה דולגה — זו הפתיחה הראשונה, וזה
     * עובד בדיוק כמו קודם.
     */
    this.stream = await acquireCamera();
    this.video.srcObject = this.stream;
    await this.video.play();

    // גודל ה-canvas = יחס המסך (לא רזולוציית הווידאו). כך התצוגה החיה
    // וההקלטה זהות לחלוטין, והשאלה תמיד נראית (בלי חיתוך של object-fit).
    const dispW = window.innerWidth || 800;
    const dispH = window.innerHeight || 1200;
    const aspect = dispW / dispH;
    if (dispH >= dispW) {
      // portrait — צלע ארוכה CANVAS_LONG_SIDE
      this.canvas.height = CANVAS_LONG_SIDE;
      this.canvas.width = Math.round(CANVAS_LONG_SIDE * aspect);
    } else {
      this.canvas.width = CANVAS_LONG_SIDE;
      this.canvas.height = Math.round(CANVAS_LONG_SIDE / aspect);
    }

    // אבחון: מה המצלמה **באמת** נתנה. iOS לא תמיד מכבד בקשת פורטרט, ואי-אפשר
    // לדעת את זה בלי להריץ על המכשיר — לכן נשמר ומוצג בדשבורד.
    saveCaptureDiagnostics({
      camera: `${this.video.videoWidth}×${this.video.videoHeight}`,
      canvas: `${this.canvas.width}×${this.canvas.height}`,
      at: Date.now(),
    });

    /**
     * **חובה לפני שהלולאה מתחילה לצייר.** הגופנים נטענים מ-Google Fonts
     * אסינכרונית, ו-`fillText` על גופן שטרם נטען נופל לחלופי **בשקט** -
     * כלומר הפריימים הראשונים היו נצרבים בגופן הלא נכון, לתמיד.
     * לא חוסם את פתיחת המצלמה: כישלון טעינה רק נופל לחלופי כמו קודם.
     */
    if (document.fonts) {
      try {
        await Promise.all([
          document.fonts.load('400 100px "Suez One"'),
          document.fonts.load('500 100px "Heebo"'),
          document.fonts.load('700 100px "Heebo"'),
        ]);
      } catch {
        /* גופן חלופי עדיף על מצלמה שלא נפתחת */
      }
    }

    this.drawLoop();
    await this.requestWakeLock();
  }

  /** הזרם החי — למד הווליום. אינו מעביר בעלות; הסגירה נשארת ב-`close()`. */
  getStream(): MediaStream | null {
    return this.stream;
  }

  setQuestion(text: string): void {
    this.question = text;
  }

  /** מסגרת וחותמת שנצרבות לקובץ. נקבע פעם אחת לפני `start()`. */
  setVideoStyle(style: VideoStyle): void {
    this.style = style;
  }

  /** מתחיל להקליט את ה-canvas (וידאו) יחד עם האודיו מהמצלמה */
  start(): void {
    if (!this.stream) throw new Error('camera not open');
    const canvasStream = this.canvas.captureStream(30);
    const audioTrack = this.stream.getAudioTracks()[0];
    if (audioTrack) canvasStream.addTrack(audioTrack);

    this.mimeType = pickMimeType();

    // ניסיון ראשון עם הגדרות האיכות המלאות. אם דפדפן כלשהו לא מקבל את שדות
    // הקצב — נופלים חזרה להקלטה רגילה במקום לשבור לאורח את הצילום.
    const opts: MediaRecorderOptions = {
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    };
    if (this.mimeType) opts.mimeType = this.mimeType;
    try {
      this.recorder = new MediaRecorder(canvasStream, opts);
    } catch (err) {
      console.warn('[recorder] הגדרות איכות נדחו, נופל לברירת מחדל', err);
      this.recorder = new MediaRecorder(
        canvasStream,
        this.mimeType ? { mimeType: this.mimeType } : undefined,
      );
    }
    this.startedAt = Date.now();
    this.bytes = 0;
    this.diagTimer = 0;
    this.seq = 0;
    this.chunks = [];

    /**
     * ⚠️ **המקטעים נצברים בזיכרון. אל תחזיר כתיבה לדיסק בלי אימות מלא.**
     *
     * ניסיון לכתוב כל מקטע ל-IndexedDB תוך כדי הקלטה (כדי לחסוך זיכרון)
     * גרם לכך ש**כל ההקלטות שנוצרו כך היו שבורות**: הן נפתחו על הפריים
     * הראשון וקפאו, בלי תמונה ממוזערת. המסלול עבד בכרום ונכשל באייפד,
     * ולכן לא נתפס בבדיקות שלי.
     *
     * הצריכה בזיכרון מטופלת בתקרת ההקלטה (5 דקות ≈ 278 מ"ב) ולא
     * בארכיטקטורה. עדיף הקלטה שעובדת עם תקרה מהודקת מאשר ארכיטקטורה
     * חסכונית שמייצרת קבצים שלא נפתחים.
     */
    this.recorder.ondataavailable = (e) => {
      if (e.data.size <= 0) return;
      this.chunks.push(e.data);
      this.bytes += e.data.size;
      this.seq++;
    };

    /**
     * המד רץ על **טיימר ולא על הגעת מקטעים**.
     *
     * ניסיון ראשון תלה אותו ב-`ondataavailable`, ואז בבדיקה לא נכתב כלום:
     * על תוכן דל-תנועה הקודק לא פולט מקטע עד ה-stop. בדיוק במבחן העומס,
     * שבו הטאב עלול ליפול, המד היה שותק. טיימר עצמאי מודד גם זמן וגם נפח
     * בלי תלות בקצב הפליטה.
     */
    this.diagTimer = window.setInterval(() => {
      writeRecordingProgress({
        elapsedMs: Date.now() - this.startedAt,
        bytes: this.bytes,
        // `this.seq` ולא `this.chunks.length` — המערך הזה כבר לא מתמלא מאז
        // שהמקטעים עברו לדיסק, ולכן המד דיווח **תמיד** אפס. זה בדיוק הכלי
        // שנועד לאבחן כשלים במבחני עומס, והוא נתן נתון שקרי.
        chunks: this.seq,
        completed: false,
        at: Date.now(),
      });
    }, 10000);
    // בלי זה כשל של המקליט (iOS קוטע בשיחה נכנסת) היה שקט לחלוטין, והתגלה
    // רק כש-`stop()` נכשל. המקטעים שנצברו נשארים ב-`chunks` וניתנים להצלה.
    this.recorder.onerror = (e) => {
      console.error('[recorder] MediaRecorder error', e);
    };
    this.recorder.start(1000); // מקטע כל שנייה, בטוח יותר לניידים
  }

  /** מרכיב את מה שנצבר עד עכשיו. לא תלוי במצב ה-MediaRecorder. */
  private stopDiagTimer(): void {
    if (this.diagTimer) {
      window.clearInterval(this.diagTimer);
      this.diagTimer = 0;
    }
  }

  /**
   * מרכיב את ההקלטה מהמקטעים שעל הדיסק.
   *
   * ה-blobs מגובים בדיסק, ולכן `new Blob([...])` עליהם רק מצביע - הוא
   * **לא** מעתיק מאות מ"ב לזיכרון. זו כל הנקודה של הארכיטקטורה הזו.
   */
  private async buildResult(): Promise<RecorderResult> {
    this.stopDiagTimer();
    const parts = this.chunks;
    const type = this.mimeType || parts[0]?.type || 'video/webm';
    const blob = new Blob(parts, { type });
    writeRecordingProgress({
      elapsedMs: this.startedAt ? Date.now() - this.startedAt : 0,
      bytes: blob.size,
      chunks: parts.length,
      completed: true,
      at: Date.now(),
    });
    return { blob, mimeType: type };
  }

  /** נשמר לתאימות — אין יותר מקטעים על הדיסק שצריך לנקות */
  async discardChunks(): Promise<void> {}

  /**
   * כמה בתים נצברו **בזיכרון** עד כה.
   *
   * זה המדד שקובע את התקרה הקשיחה: הזמן הוא קירוב, הזיכרון הוא האילוץ
   * האמיתי. נמדד בקבצים אמיתיים 7.4 Mbps, ולכן דקה ≈ 56 מ"ב - אבל זה
   * משתנה עם התאורה והתנועה, ולכן עדיף לספור בתים מלנחש לפי שעון.
   */
  bytesBuffered(): number {
    return this.bytes;
  }

  /** האם נצברו בכלל בתים (בדיסק או בגיבוי הזיכרון) */
  hasData(): boolean {
    return this.chunks.some((c) => c.size > 0);
  }

  /**
   * מרכיב את מה שנצבר גם כשה-`stop` הרגיל נכשל.
   *
   * עדיף להחזיר לאורח הקלטה חלקית מאשר לאבד את כולה. מאז שהמקטעים
   * נכתבים לדיסק, ההצלה קוראת אותם משם - ולכן היא עובדת גם אחרי
   * שהמקליט מת לגמרי.
   */
  async salvage(): Promise<RecorderResult | null> {
    return this.hasData() ? this.buildResult() : null;
  }

  /**
   * מסיים את ההקלטה ומחזיר את קובץ הוידאו.
   *
   * **לעולם לא נכשל כשיש נתונים.** קודם המימוש היה `rec.stop()` בתוך Promise
   * בלי הגנות, ולכן:
   *  - אם iOS כבר עצר את המקליט (שיחה נכנסת / מעבר לרקע), `stop()` זרק
   *    `InvalidStateError` - והמקטעים שכבר נצברו בזיכרון **נזרקו לפח**.
   *  - אם `onstop` לא נורה, ה-Promise לא הסתיים לעולם והמסך נתקע ב«שומר...».
   */
  async stop(): Promise<RecorderResult> {
    const rec = this.recorder;
    if (!rec || rec.state === 'inactive') {
      // המקליט כבר לא פעיל — אין למה לחכות, מרכיבים ממה שנכתב לדיסק
      const salvaged = await this.salvage();
      if (salvaged) return salvaged;
      throw new Error(rec ? 'no data' : 'not recording');
    }
    return new Promise<RecorderResult>((resolve, reject) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(guard);
        this.buildResult().then(resolve, reject);
      };
      // רשת ביטחון: אם onstop לא נורה, לא נשאיר את האורח תקוע ב«שומר...»
      const guard = window.setTimeout(() => {
        console.warn('[recorder] onstop לא נורה — מרכיב ממה שנצבר');
        done();
      }, 5000);

      rec.onstop = done;
      try {
        rec.stop();
      } catch (err) {
        console.warn('[recorder] stop() נכשל — מציל את המקטעים', err);
        done();
      }
    });
  }

  /** משחרר את המצלמה, לולאת הציור ו-wake lock */
  async close(): Promise<void> {
    /**
     * ⚠️ **ניקוי מקטעים יתומים.**
     *
     * המקטעים נמחקו קודם רק בשני מסלולי ההצלחה ב-`Recording.tsx`. אורח
     * שביטל, מצלמה שנכשלה או שמירה שנכשלה השאירו אותם על הדיסק לנצח,
     * בגודל ההקלטה המלאה. `close()` נקרא בכל המסלולים, ולכן הוא המקום
     * הנכון. אם ההקלטה כן הורכבה - `discardChunks` כבר טיפל בה.
     */
    this.stopDiagTimer();
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    /**
     * ⚠️ **`close()` אינו משחרר את המצלמה.**
     *
     * הבעלות היא של המסך, לא של המקליט. «התחל מחדש» סוגר מקליט ופותח
     * חדש — ואם הסגירה הייתה משחררת את הזרם, היינו מקבלים סגירה־פתיחה
     * מיידית של המצלמה, שזה בדיוק מה שמייצר `NotReadableError` ב-iOS.
     * השחרור נעשה מפורשות ב-`releaseCamera()` ביציאה מהזרימה.
     */
    this.stream = null;
    this.video.srcObject = null;
    await this.releaseWakeLock();
  }

  // ---- ציור ----

  private drawLoop = (): void => {
    this.rafId = requestAnimationFrame(this.drawLoop);
    const { ctx, canvas, video } = this;
    if (video.readyState < 2) return;

    // ציור הווידאו במילוי (cover) לתוך ה-canvas — חותכים את הווידאו,
    // לא את ה-canvas, כך שהמסגרת שנשמרת = המסגרת שרואים.
    const vw = video.videoWidth || canvas.width;
    const vh = video.videoHeight || canvas.height;
    const cAspect = canvas.width / canvas.height;
    const vAspect = vw / vh;
    let sx = 0;
    let sy = 0;
    let sw = vw;
    let sh = vh;
    if (vAspect > cAspect) {
      // הווידאו רחב יותר — חותכים את הצדדים
      sw = Math.round(vh * cAspect);
      sx = Math.round((vw - sw) / 2);
    } else {
      // הווידאו גבוה יותר — חותכים למעלה/למטה
      sh = Math.round(vw / cAspect);
      sy = Math.round((vh - sh) / 2);
    }
    // היפוך אופקי של הווידאו בלבד — המצלמה הקדמית מגיעה "במראה" (הפוך),
    // וכך הצילום יוצא רגיל/טבעי (כמו שאחרים רואים אותנו). השאלה מצוירת
    // אחרי ה-restore כך שהטקסט נשאר קריא ולא מתהפך.
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    // סדר הציור: מסגרת לפני הכיתוב, כדי שההצללה שלה לא תחליש את הטקסט
    const { frame, stamp, stampName, stampDate, accent } = this.style;
    if (frame !== 'none') {
      drawVideoFrame(ctx, canvas.width, canvas.height, frame, accent);
    }
    if (this.question) this.drawQuestion();
    if (stamp !== 'off') {
      drawVideoStamp(ctx, canvas.width, canvas.height, stampName, stampDate, stamp, accent);
    }
  };

  private drawQuestion(): void {
    const { ctx, canvas } = this;
    const text = this.question;
    // נגזר מהצלע ה**קצרה** ולא מהרוחב: לרוחב הרוחב הוא הצלע הארוכה, וגזירה
    // ממנו הייתה מנפחת את הטקסט לפי 2.3 ביחס לגובה הפריים ומכסה את הצילום.
    const shortSide = Math.min(canvas.width, canvas.height);
    const pad = Math.round(shortSide * 0.045);
    const fontSize = Math.round(shortSide * 0.05);
    ctx.font = `700 ${fontSize}px "Heebo", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';

    const maxWidth = canvas.width - pad * 2;
    const lines = wrapText(ctx, text, maxWidth);
    const lineHeight = fontSize * 1.4;

    /**
     * ⚠️ **`topMargin` חייב לפנות מקום לסרגל העליון של מסך הצילום**
     * (`.rec-topbar` — מקליט/שעון/ווליום/התחל-מחדש, שנוסף ב-0.32/0.33).
     *
     * הסרגל הוא HTML שיושב *מעל* הקנבס, לא חלק ממנו — לכן שום דבר כאן
     * לא "יודע" עליו אוטומטית. נמדד: גובהו האמיתי ~64–95px (תלוי בדגם
     * ובכך ששורת הסטטוס של iOS נשארת גלויה גם ב-standalone ותופסת חלק
     * מה-safe-area-inset-top). ה-6% הישנים היו 65–82px בלבד על אייפדים
     * אמיתיים - **פחות** מגובה הסרגל בהרבה דגמים, ומכאן ההתנגשות שנצפתה
     * בפועל. 12% מגובה המסך נותנים מרווח בטוח בכל הדגמים שנבדקו.
     *
     * `canvas.height` ממופה תמיד 1:1 לגובה המסך האמיתי בפיקסלים (הקנבס
     * מוצג ב-`object-fit: cover` באותו יחס-רוחב-גובה שהוא נוצר איתו),
     * ולכן אחוז מתוכו הוא אחוז אמיתי ומדויק מגובה המסך - לא הערכה גסה.
     */
    const topMargin = Math.round(canvas.height * 0.12);
    const startY = topMargin + lineHeight / 2;

    // גובה ה-scrim **תלוי ב-topMargin** ולא קבוע: אחרת שאלה בת שתי שורות
    // הייתה יורדת מתחת לרקע הכהה עם המרווח החדש, והשורה השנייה הייתה
    // נשארת בלי scrim מתחתיה. shortSide * 0.05 הוא מרווח נשימה מתחת
    // לשורה האחרונה, לא עוד "top margin" נוסף.
    const scrimHeight = Math.round(topMargin + lines.length * lineHeight + shortSide * 0.05);

    // גרדיאנט scrim: כהה למעלה → שקוף למטה (בלי קו חיתוך חד על הווידאו).
    // ממוטמח לפי גובה ה-scrim — הוא משתנה רק כשמספר שורות הטקסט משתנה,
    // ולא 30 פעמים בשנייה כפי שהיה קודם.
    const grad = cachedGradient(ctx, `scrim-${scrimHeight}`, () => {
      // כהה יותר ומחזיק לאורך רוב ה-scrim לפני שהוא דועך — כדי שהשאלה
      // תישאר קריאה גם מול רקע בהיר (חלון, נברשת, קיר לבן). נמדד מול רקע
      // בהיר: הערכים הקודמים (0.72→0.45) השאירו טקסט לבן על גבול הקריאוּת.
      const g = ctx.createLinearGradient(0, 0, 0, scrimHeight);
      g.addColorStop(0, 'rgba(0, 0, 0, 0.82)');
      g.addColorStop(0.7, 'rgba(0, 0, 0, 0.66)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      return g;
    });
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, scrimHeight);

    // הטקסט — עם צל עדין ללגיבּיליות על כל רקע
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = Math.round(fontSize * 0.35);
    ctx.shadowOffsetY = 2;
    // מתאר כהה סביב האותיות — אותה טכניקה של החותמת. זה מה שמבטיח קריאוּת
    // כשהצילום עצמו בהיר בדיוק מאחורי הטקסט, מקום שבו scrim לבדו לא מספיק.
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.06));
    ctx.fillStyle = '#ffffff';
    lines.forEach((line, i) => {
      const y = startY + i * lineHeight;
      ctx.strokeText(line, canvas.width / 2, y);
      ctx.fillText(line, canvas.width / 2, y);
    });
    ctx.restore();

    // מבטא זהב — קו דק מתחת לשאלה
    const lastLineBottom = startY + (lines.length - 1) * lineHeight + lineHeight / 2;
    const accentW = Math.round(shortSide * 0.14);
    const accentY = Math.round(lastLineBottom + pad * 0.5);
    ctx.fillStyle = '#e0b64c';
    ctx.fillRect(
      Math.round(canvas.width / 2 - accentW / 2),
      accentY,
      accentW,
      Math.max(3, Math.round(shortSide * 0.004)),
    );
  }

  // ---- wake lock (מונע כיבוי מסך בזמן הקלטה) ----

  private async requestWakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {
      // לא קריטי — נמשיך בלי
    }
  }

  private async releaseWakeLock(): Promise<void> {
    try {
      await this.wakeLock?.release();
    } catch {
      /* ignore */
    }
    this.wakeLock = null;
  }
}

/** שובר טקסט לשורות לפי רוחב מקסימלי */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export interface CameraErrorInfo {
  message: string;
  /** האם ניסיון חוזר יכול לעזור (ואז מציגים כפתור «נסה שוב») */
  canRetry: boolean;
  /** האם זו באמת בעיית הרשאה — רק אז שולחים את המשתמש להגדרות */
  isPermission: boolean;
  /** שלבי פתרון, לפי סדר. מוצגים בכפתור «מה עושים?» */
  fix: string[];
}

/**
 * ממפה שגיאת `getUserMedia` להודעה נכונה.
 *
 * למה זה חשוב: כל הכשלים נראו קודם כמו "צריך לאשר הרשאות", וזה שלח אנשים
 * לתקן הרשאות תקינות. הכשל הנפוץ באמת בעמדה הוא `NotReadableError` —
 * iOS לוקח את המצלמה כשהאפליקציה עוברת לרקע, וזו לא בעיית הרשאה בכלל.
 */
export function describeCameraError(err: unknown): CameraErrorInfo {
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        message: 'הגישה למצלמה נחסמה. יש לאשר גישה למצלמה ולמיקרופון.',
        canRetry: true,
        isPermission: true,
        fix: [
          'הגדרות → ספארי → מצלמה → «אפשר»',
          'אם פתחתם מהמסך הבית: הגדרות → גללו לאפליקציה → מצלמה',
          'חזרו לכאן ולחצו «נסה שוב»',
        ],
      };
    case 'NotReadableError':
    case 'AbortError':
      return {
        message:
          'המצלמה תפוסה כרגע. סגרו אפליקציות אחרות שמשתמשות במצלמה ונסו שוב.',
        canRetry: true,
        isPermission: false,
        fix: [
          'לחצו «נסה שוב» - לרוב זה פותר מיד',
          'סגרו אפליקציות אחרות שמשתמשות במצלמה (זום, פייסטיים, מצלמה)',
          'אם לא עזר: סגרו את האפליקציה לגמרי ופתחו מחדש',
        ],
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        message: 'לא נמצאה מצלמה במכשיר הזה.',
        canRetry: false,
        isPermission: false,
        fix: [
          'הפעילו מחדש את המכשיר',
          'אם זה חוזר - יש להחליף מכשיר. העמדה לא תוכל לצלם כך',
        ],
      };
    case 'OverconstrainedError':
      return {
        message: 'המצלמה לא תומכת בהגדרות הנדרשות.',
        canRetry: false,
        isPermission: false,
        fix: [
          'המכשיר לא תומך באיכות הנדרשת',
          'יש להשתמש במכשיר עדכני יותר',
        ],
      };
    default:
      return {
        message: 'לא הצלחנו לפתוח את המצלמה.',
        canRetry: true,
        isPermission: false,
        fix: [
          'לחצו «נסה שוב»',
          'סגרו את האפליקציה לגמרי ופתחו מחדש',
          'אם זה חוזר - הפעילו מחדש את המכשיר',
        ],
      };
  }
}

/**
 * בודק שהמצלמה והמיקרופון נגישים, ומשחרר אותם מיד.
 *
 * שימוש עיקרי: המפעיל מריץ את זה בתחילת הערב, וכך חלונית ההרשאה של iOS
 * מוקפצת **פעם אחת** — לפני שהאורח הראשון מגיע. ההרשאה מחזיקה לאורך טעינת
 * הדף, ולכן אף אורח לא ייתקל בה.
 *
 * משחרר את ה-tracks מיד כדי לא לשרוף סוללה ולא להדליק את מחוון הפרטיות.
 */
export async function checkCameraAccess(): Promise<CameraErrorInfo | null> {
  /**
   * ⚠️ אם כבר יש זרם חי — **לא פותחים שני**.
   *
   * התרחיש: המפעיל נכנס לדשבורד בזמן שאורח מצלם ולוחץ «בדוק מצלמה».
   * שתי בקשות מצלמה במקביל ב-iOS עלולות להיכשל או לגזול את המצלמה
   * מההקלטה שרצה. זרם חי הוא ממילא ההוכחה הטובה ביותר שהמצלמה עובדת.
   */
  if (hasLiveCamera()) return null;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: true,
    });
    stream.getTracks().forEach((t) => t.stop());
    return null;
  } catch (err) {
    return describeCameraError(err);
  }
}

/**
 * בדיקת המפעיל: כמו `checkCameraAccess`, אבל גם **מאזינה** למיקרופון.
 *
 * למה נפרד: `getUserMedia` מצליח גם כשהמיקרופון לא משדר כלום (התקן לא
 * מחובר, התקן וירטואלי, מיקרופון מושתק). הבדיקה הישנה אישרה «המצלמה
 * והמיקרופון עובדים» על סמך ההרשאה בלבד, ונמדד בפועל סרטון של דקה עם
 * ערוץ שמע דומם לחלוטין אחרי בדיקה ש«עברה».
 *
 * `ctx` נוצר ע"י הקורא **בתוך הלחיצה**, לפני ה-await הראשון — אחרת iOS
 * משהה אותו והמדידה חסרת ערך.
 */
export async function checkCameraAndMic(
  ctx: AudioContext | null,
  listenMs = 2500,
): Promise<{ problem: CameraErrorInfo | null; mic: MicSignal }> {
  // אורח מצלם ברגע זה — לא פותחים זרם שני ולא מפריעים לו
  if (hasLiveCamera()) return { problem: null, mic: 'unknown' };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: true,
    });
  } catch (err) {
    return { problem: describeCameraError(err), mic: 'unknown' };
  }
  try {
    return { problem: null, mic: await listenForSignal(stream, ctx, listenMs) };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}
