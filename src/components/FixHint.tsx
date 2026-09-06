import { useState } from 'react';
import type { ReactNode } from 'react';

interface Props {
  /** שלבי הפתרון, לפי סדר הביצוע. שורה ראשונה = מה שהכי סביר שיפתור. */
  steps: ReactNode[];
  /** תווית הכפתור. ברירת המחדל מתאימה לרוב ההקשרים. */
  label?: string;
}

/**
 * כפתור «מה עושים?» שנפתח להוראות פתרון.
 *
 * למה זה קיים: הודעת שגיאה אומרת **מה קרה**, אבל בעמדה באמצע אירוע צריך
 * לדעת **מה לעשות עכשיו** - ואין זמן לחפש. ההוראות מקופלות כברירת מחדל
 * כדי לא להעמיס את המסך, ונפתחות בלחיצה אחת.
 *
 * מקופל ולא פתוח: רוב השגיאות נפתרות בלי לקרוא (למשל «נסה שוב»), וטקסט
 * ארוך שתמיד מוצג הופך את המסך למאיים דווקא ברגע לחוץ.
 */
export default function FixHint({ steps, label = '💡 מה עושים?' }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fix-hint">
      <button
        type="button"
        className="fix-hint-btn"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? '✕ סגור' : label}
      </button>

      {open && (
        <ol className="fix-hint-body">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
