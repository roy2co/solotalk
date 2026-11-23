import { useEffect, useState } from 'react';

interface Props {
  expectedPin?: string;
  onSuccess: () => void;
  onCancel: () => void;
  /** ברירת המחדל היא שער הכניסה לדשבורד; שערים פנימיים מגדירים כותרת משלהם */
  title?: string;
  subtitle?: string;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export default function PinScreen({
  expectedPin,
  onSuccess,
  onCancel,
  // «קוד ניהול» ולא «קוד מנהל» - זה השם שמופיע בשדה שקובע אותו בהגדרות
  // («קוד ניהול (PIN) - לכניסה לדשבורד»). שני שמות לאותו קוד הם מה שגרם
  // לבלבול עם קודי הארכיון. ברירת המחדל משמשת רק את שער הכניסה ב-App.
  title = 'קוד ניהול',
  subtitle = 'הזינו את הקוד שהגדרתם כדי להיכנס לדשבורד',
}: Props) {
  const [entered, setEntered] = useState('');
  const [error, setError] = useState(false);
  const len = (expectedPin ?? '').length || 4;

  // אם לא הוגדר קוד - נכנסים ישר
  useEffect(() => {
    if (!expectedPin) onSuccess();
  }, [expectedPin, onSuccess]);

  const press = (key: string) => {
    if (key === '⌫') {
      setEntered((e) => e.slice(0, -1));
      return;
    }
    if (!key) return;
    setError(false);
    const next = (entered + key).slice(0, len);
    setEntered(next);
    if (next.length === len) {
      if (next === expectedPin) {
        onSuccess();
      } else {
        setError(true);
        setTimeout(() => {
          setEntered('');
          setError(false);
        }, 600);
      }
    }
  };

  return (
    <div className="screen">
      <h2>{title}</h2>
      <p className="subtitle">{subtitle}</p>
      <div className={`pin-dots ${error ? 'error' : ''}`}>
        {Array.from({ length: len }).map((_, i) => (
          <span key={i} className={`pin-dot ${i < entered.length ? 'filled' : ''}`} />
        ))}
      </div>

      <div className="pin-pad">
        {KEYS.map((key, i) => (
          <button
            key={i}
            className={`pin-key glass ${!key ? 'empty' : ''}`}
            onClick={() => press(key)}
            disabled={!key}
          >
            {key}
          </button>
        ))}
      </div>

      <button className="btn ghost" onClick={onCancel}>
        ביטול
      </button>
    </div>
  );
}
