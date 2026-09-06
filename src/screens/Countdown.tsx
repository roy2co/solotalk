import { useEffect, useRef, useState } from 'react';
import { acquireCamera } from '../lib/camera';

interface Props {
  onDone: () => void;
  onCancel: () => void;
}

/**
 * 10 שניות ולא 5.
 *
 * באירוע הראשון נצפה שאורחים נמוכים או שעומדים רחוק מדי מגלים את זה רק
 * אחרי שההקלטה כבר רצה. עשר שניות עם תצוגה מקדימה נותנות זמן אמיתי
 * לתקן זווית ומרחק — ומי שמוכן פשוט לוחץ «דלג».
 */
const START = 10;

export default function Countdown({ onDone, onCancel }: Props) {
  const [count, setCount] = useState(START);
  const [camError, setCamError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  /**
   * תצוגה מקדימה חיה.
   *
   * ⚠️ **הזרם מגיע מ-`camera.ts` ואינו נסגר כאן.** מסך הצילום מקבל את
   * אותו זרם בדיוק, וסגירה־ופתיחה ביניהם הייתה מייצרת «המצלמה תפוסה».
   * השחרור קורה רק ביציאה מהזרימה.
   */
  useEffect(() => {
    let cancelled = false;
    acquireCamera()
      .then((stream) => {
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        return videoRef.current.play().catch(() => undefined);
      })
      .catch(() => {
        // התצוגה המקדימה היא נוחות, לא תנאי. מסך הצילום יציג את השגיאה
        // המדויקת עם כפתור «מה עושים?» אם המצלמה באמת לא נפתחת.
        if (!cancelled) setCamError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (count <= 0) {
      onDone();
      return;
    }
    const t = window.setTimeout(() => setCount((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [count, onDone]);

  return (
    <div className="screen countdown-screen">
      <p className="subtitle">
        {count > 3 ? 'התארגנו — ככה תיראו בסרטון' : count > 0 ? 'חייכו! 😃' : 'מצלמים! 🎬'}
      </p>

      <div className="cd-preview">
        {camError ? (
          <div className="cd-preview-fallback">📷</div>
        ) : (
          <video ref={videoRef} playsInline muted autoPlay />
        )}
        <div className="cd-ring" aria-hidden />
        <div className="countdown-num" key={count}>
          {count > 0 ? count : '🎬'}
        </div>
      </div>

      <p className="step-hint cd-note">
        אין צורך להקריא את השאלה — היא מופיעה בסרטון
      </p>

      <div className="cd-actions">
        <button className="btn" onClick={onDone}>
          מוכנים — התחילו
        </button>
        <button className="btn ghost" onClick={onCancel}>
          ביטול
        </button>
      </div>
    </div>
  );
}
