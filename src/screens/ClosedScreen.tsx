import type { AppConfig } from '../types';
import defaultLogo from '../assets/logo.png';

interface Props {
  config: AppConfig;
}

export default function ClosedScreen({ config }: Props) {
  return (
    <div className="screen closed-screen">
      <img
        className="welcome-logo small"
        src={config.logoDataUrl || defaultLogo}
        alt="לוגו"
      />
      <h2 className="gradient-text">העמדה תיפתח בקרוב 💛</h2>
    </div>
  );
}
