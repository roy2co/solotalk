// מד עוצמת מיקרופון — קורא את הזרם החי ומדווח רמה 0..1, ומזהה מיקרופון
// שלא משדר כלום.
//
// ⚠️ **הצרכן חייב לצייר את זה ב-HTML ולא על הקנבס.** כל מה שמצויר על
// הקנבס נצרב לתוך הסרטון לתמיד; המד נועד למפעיל ולמצטלם בלבד.

/** עוצר את המדידה ומשחרר את משאבי האודיו */
export type StopMeter = () => void;

/**
 * מתחת לזה = **אין אות בכלל**, לא «חדר שקט».
 *
 * מיקרופון אמיתי משדר רעש רקע גם בחדר דומם (בערך ‎-60 dB). התקן שלא
 * מחובר, התקן וירטואלי או מיקרופון מושתק משדרים אפסים מדויקים. הסף
 * (‎-80 dB) יושב בבטחה בין השניים, ולכן אורח ששותק וחושב **לא** מפעיל
 * את האזהרה — רק מקור מת.
 */
const DEAD_RMS = 1e-4;

/** כמה זמן של אפס מוחלט עד שמכריזים שהמיקרופון מת */
const DEAD_AFTER_MS = 3000;

const PROVEN_KEY = 'soloTalk.micMeterProven';

/**
 * האם המד **הוכיח את עצמו** במכשיר הזה — קלט אות אמיתי לפחות פעם אחת.
 *
 * ⚠️ בלי זה האזהרה עלולה לשקר. בדפדפנים מסוימים `AnalyserNode` מחזיר
 * אפסים גם כשהמיקרופון תקין (הקשר שמע מושהה, או צומת שלא נמשך), וזה
 * נראה בדיוק כמו מיקרופון מת. אזהרת «לא שומעים אתכם» על כל אורח באירוע
 * גרועה מאין אזהרה. לכן היא נדלקת רק במכשיר שבו המד כבר ראה אות —
 * שם אפסים הם באמת אפסים.
 */
function isProven(): boolean {
  try {
    return localStorage.getItem(PROVEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markProven(): void {
  try {
    localStorage.setItem(PROVEN_KEY, '1');
  } catch {
    /* אחסון חסום — האזהרה פשוט לא תידלק */
  }
}

/** יוצר הקשר שמע. לקרוא **מתוך לחיצה** כשאפשר — אחרת iOS עלול להשהות אותו */
export function createAudioContext(): AudioContext | null {
  type Ctor = typeof AudioContext;
  const Ctx: Ctor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    return new Ctx();
  } catch {
    return null;
  }
}

/**
 * RMS של החלון הנוכחי. **נקודה צפה ולא בתים**: ברזולוציית 8 ביט כל מה
 * שמתחת ל-‎-42 dB מתעגל לאפס, כך שחדר שקט ומיקרופון מת היו נראים זהים.
 */
function readRms(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

export interface MeterOptions {
  /**
   * נקרא כשהמיקרופון מפסיק לשדר (`true`) וכשהוא חוזר (`false`).
   * נדלק רק במכשיר שבו המד הוכיח את עצמו — ראו `isProven`.
   */
  onSilence?: (silent: boolean) => void;
}

/**
 * מתחיל למדוד את עוצמת המיקרופון של הזרם הנתון.
 *
 * `onLevel` נקרא ~16 פעמים בשנייה עם ערך 0..1 (RMS מנורמל). הפונקציה
 * **אינה מחזיקה בעלות על הזרם** — היא רק מאזינה לו, ולכן לא עוצרת
 * טראקים בסיום. הבעלות היא של `camera.ts`.
 */
export function startMicMeter(
  stream: MediaStream,
  onLevel: (level: number) => void,
  options: MeterOptions = {},
): StopMeter {
  const track = stream.getAudioTracks()[0];
  if (!track) {
    // אין ערוץ שמע בכלל — זה ודאי, בלי קשר למה שהמד מסוגל למדוד
    onLevel(0);
    options.onSilence?.(true);
    return () => undefined;
  }

  const ctx = createAudioContext();
  if (!ctx) {
    onLevel(0);
    return () => undefined;
  }

  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  // חלון קצר — המד צריך להגיב מיד, לא למצע על חצי שנייה
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);

  const buf = new Float32Array(analyser.fftSize);
  let stopped = false;
  let silent = false;
  let lastSoundAt = Date.now();

  /**
   * ⚠️ **`setInterval` ולא `requestAnimationFrame`.**
   *
   * rAF נחנק ע"י הדפדפן גם כשהטאב גלוי — נמדד 2fps במקום 60. מד עוצמה
   * שקופא הוא גרוע מאין מד בכלל: המפעיל יסיק שהמיקרופון מת. 60ms נותנות
   * ~16 דגימות בשנייה, חלק לעין ובלתי תלוי בחניקה.
   */
  const tick = () => {
    if (stopped) return;
    const rms = readRms(analyser, buf);
    // דיבור רגיל יושב סביב 0.05-0.2 RMS — מותחים לטווח שימושי לעין
    onLevel(Math.min(1, rms * 4.5));

    // הקשר מושהה מחזיר אפסים גם כשהמיקרופון תקין — לא מסיקים ממנו כלום
    if (ctx.state !== 'running') {
      lastSoundAt = Date.now();
      void ctx.resume().catch(() => undefined);
      return;
    }

    if (rms >= DEAD_RMS) {
      lastSoundAt = Date.now();
      markProven();
      if (silent) {
        silent = false;
        options.onSilence?.(false);
      }
    } else if (!silent && isProven() && Date.now() - lastSoundAt >= DEAD_AFTER_MS) {
      silent = true;
      options.onSilence?.(true);
    }
  };
  const timer = window.setInterval(tick, 60);
  tick();

  return () => {
    stopped = true;
    window.clearInterval(timer);
    try {
      source.disconnect();
      void ctx.close();
    } catch {
      /* כבר נסגר */
    }
  };
}

/** `unknown` = לא ניתן היה למדוד במכשיר הזה; אין להסיק מזה שהמיקרופון מת */
export type MicSignal = 'heard' | 'silent' | 'unknown';

/**
 * מאזין לזרם `ms` אלפיות שנייה ומדווח אם הגיע ממנו אות כלשהו.
 *
 * משמש את בדיקת המפעיל בדשבורד. בשונה מהמד שרץ בזמן צילום, כאן הצומת
 * מחובר ליציאה דרך עוצמה אפס — כך הדפדפן מושך אותו בוודאות. בזמן צילום
 * אמיתי לא נוגעים ביציאת השמע, ולכן שם זה לא נעשה.
 */
export async function listenForSignal(
  stream: MediaStream,
  ctx: AudioContext | null,
  ms: number,
): Promise<MicSignal> {
  const track = stream.getAudioTracks()[0];
  if (!track) return 'silent';
  if (!ctx) return 'unknown';

  try {
    if (ctx.state !== 'running') await ctx.resume();
  } catch {
    /* נבדק מיד למטה */
  }
  if (ctx.state !== 'running') return 'unknown';

  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(analyser);
  analyser.connect(mute);
  mute.connect(ctx.destination);

  const buf = new Float32Array(analyser.fftSize);
  let peak = 0;
  const started = Date.now();
  await new Promise<void>((resolve) => {
    const timer = window.setInterval(() => {
      peak = Math.max(peak, readRms(analyser, buf));
      // אות אמיתי = אין טעם להמשיך להאזין
      if (peak >= DEAD_RMS || Date.now() - started >= ms) {
        window.clearInterval(timer);
        resolve();
      }
    }, 60);
  });

  try {
    source.disconnect();
    analyser.disconnect();
    mute.disconnect();
  } catch {
    /* כבר נותק */
  }
  return peak >= DEAD_RMS ? 'heard' : 'silent';
}
