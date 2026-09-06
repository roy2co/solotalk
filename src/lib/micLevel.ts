// מד עוצמת מיקרופון — קורא את הזרם החי ומדווח רמה 0..1.
//
// ⚠️ **הצרכן חייב לצייר את זה ב-HTML ולא על הקנבס.** כל מה שמצויר על
// הקנבס נצרב לתוך הסרטון לתמיד; המד נועד למפעיל ולמצטלם בלבד.

/** עוצר את המדידה ומשחרר את משאבי האודיו */
export type StopMeter = () => void;

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
): StopMeter {
  const track = stream.getAudioTracks()[0];
  if (!track) {
    // אין אודיו — מדווחים אפס פעם אחת כדי שהמד יציג מצב «אין קול»
    onLevel(0);
    return () => undefined;
  }

  type Ctor = typeof AudioContext;
  const Ctx: Ctor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
  if (!Ctx) {
    onLevel(0);
    return () => undefined;
  }

  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  // חלון קצר — המד צריך להגיב מיד, לא למצע על חצי שנייה
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);

  const buf = new Uint8Array(analyser.fftSize);
  let stopped = false;

  /**
   * ⚠️ **`setInterval` ולא `requestAnimationFrame`.**
   *
   * rAF נחנק ע"י הדפדפן גם כשהטאב גלוי — נמדד 2fps במקום 60. מד עוצמה
   * שקופא הוא גרוע מאין מד בכלל: המפעיל יסיק שהמיקרופון מת. 60ms נותנות
   * ~16 דגימות בשנייה, חלק לעין ובלתי תלוי בחניקה.
   */
  const tick = () => {
    if (stopped) return;
    analyser.getByteTimeDomainData(buf);
    // RMS סביב אמצע הטווח (128 = שקט)
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    // דיבור רגיל יושב סביב 0.05-0.2 RMS — מותחים לטווח שימושי לעין
    onLevel(Math.min(1, rms * 4.5));
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
