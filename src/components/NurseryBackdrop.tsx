import type { BritDesign } from '../types';
import {
  Balloons,
  Bow,
  BowPattern,
  Cloud,
  Garland,
  HotAirBalloon,
  Pram,
  ScallopOval,
  Sparkles,
} from './NurseryArt';

interface Props {
  design: BritDesign;
  /**
   * `welcome` - מסך הפתיחה, עם המסגרת המלאה של העיצוב.
   * `choice` - מסכי הבחירה: אותו רקע ואותם איורים, אבל מאחורי התוכן לוח
   * לבן פשוט. מסגרת אובלית צרה מדי לשתי עמודות של כפתורים.
   */
  mode: 'welcome' | 'choice';
}

/**
 * שכבת הרקע והאיורים של כל עיצוב - כל מה שאינו טקסט או כפתור.
 *
 * הרכיב מצויר **מאחורי** התוכן (`.nb` ב-CSS) ואינו קולט לחיצות. המיקומים
 * כולם ב-`em` יחסית ל-`.nw`, ולכן אותה שכבה משרתת גם את המסך המלא וגם
 * את התצוגה הממוזערת בדשבורד.
 */
export default function NurseryBackdrop({ design, mode }: Props) {
  const choice = mode === 'choice';

  switch (design) {
    case 'garland':
      return (
        <div className="nb" aria-hidden>
          <Garland className="nw-clothesline" />
        </div>
      );

    case 'pram':
      // במסך הפתיחה העגלה חלק מהתוכן (ליד התמונה), ולכן כאן רק במסכי הבחירה
      return choice ? (
        <div className="nb" aria-hidden>
          <Pram className="nw-pram-corner" />
        </div>
      ) : null;

    case 'balloon':
      return (
        <div className="nb nb-balloon" aria-hidden>
          <div className={`nb-arch ${choice ? 'white' : 'beige'}`} />
          <Cloud className="nb-cloud a" />
          <Cloud className="nb-cloud b" />
          <HotAirBalloon className="nb-hot big" teddy />
          <HotAirBalloon className="nb-hot small" />
        </div>
      );

    case 'bow':
      return (
        <div className="nb nb-bow" aria-hidden>
          <BowPattern className="nb-pattern" />
          {choice ? <div className="nb-arch white" /> : <ScallopOval className="nb-oval" />}
          <Bow className="nb-ribbon" />
        </div>
      );

    case 'gingham':
      return (
        <div className="nb nb-gingham" aria-hidden>
          <div className="nb-checks" />
          <div className="nb-arch white raised" />
          <Cloud className="nb-cloud a" />
          <HotAirBalloon className="nb-hot corner" />
        </div>
      );

    case 'clouds':
      return (
        <div className="nb nb-clouds" aria-hidden>
          <Cloud className="nb-cloud a" />
          <Cloud className="nb-cloud b" />
          <Cloud className="nb-cloud c" />
          <Sparkles className="nb-sparks a" />
          <Sparkles className="nb-sparks b" />
          <HotAirBalloon className="nb-hot small" />
          {!choice && <Balloons className="nb-balloons" />}
        </div>
      );
  }
}
