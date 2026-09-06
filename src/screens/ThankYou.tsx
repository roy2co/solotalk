import { useEffect, useState } from 'react';

interface Props {
  autoResetSeconds: number;
  onReset: () => void;
}

export default function ThankYou({ autoResetSeconds, onReset }: Props) {
  const [left, setLeft] = useState(autoResetSeconds);

  useEffect(() => {
    if (left <= 0) {
      onReset();
      return;
    }
    const t = window.setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left, onReset]);

  return (
    <div className="screen">
      <div style={{ fontSize: '72px' }}>💛</div>
      <h1>תודה רבה!</h1>
      <p className="subtitle">הברכה שלכם נשמרה. איזה כיף שהייתם חלק מהיום הזה.</p>
      <button className="btn" onClick={onReset}>
        סיום ({left})
      </button>
    </div>
  );
}
