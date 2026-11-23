import { useEffect, useState } from 'react';
import type { StationOrientation } from '../types';
import { isPortrait } from '../lib/recorder';

interface Props {
  /** הכיוון שהוגדר בדשבורד */
  want: StationOrientation;
}

/**
 * מבקש מהמפעיל לסובב את המכשיר כשהוא לא בכיוון שנבחר לעמדה.
 *
 * למה בקשה ולא כפייה: iOS לא תומך ב-`screen.orientation.lock()` בספארי, ולכן
 * אין דרך לכפות סיבוב מקוד. הנעילה בפועל נעשית דרך נעילת הסיבוב של iOS או
 * גישה מודרכת - וזה מסך שמזכיר לעשות את זה בהתקנה.
 *
 * מוצג רק לאורחים; הגלגל של הניהול נשאר מעליו כדי שאפשר יהיה לשנות את ההגדרה.
 */
export default function RotatePrompt({ want }: Props) {
  const [portrait, setPortrait] = useState(isPortrait);

  useEffect(() => {
    const update = () => setPortrait(isPortrait());
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  if (want === 'auto') return null;
  const matches = want === 'portrait' ? portrait : !portrait;
  if (matches) return null;

  return (
    <div className="rotate-prompt" role="status">
      <div className="rotate-icon" aria-hidden>
        ⟳
      </div>
      <h2>סובבו את המכשיר</h2>
      <p className="subtitle">
        {want === 'portrait'
          ? 'העמדה מוגדרת לאורך - כך המצלמה נמצאת מעל המסך והאורח מסתכל אליה.'
          : 'העמדה מוגדרת לרוחב - כך המצלמה נמצאת מעל המסך והאורח מסתכל אליה.'}
      </p>
      <p className="step-hint">אפשר לשנות את ההגדרה בדשבורד הניהול.</p>
    </div>
  );
}
