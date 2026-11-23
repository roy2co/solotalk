import { useCallback, useEffect, useState } from 'react';
import type { AppConfig, Depth, Relationship, Screen } from './types';
import {
  BRIT_RELATIONSHIP_LABELS,
  BRIT_RELATIONSHIPS,
  FAMILY_PARENT_CATEGORY,
  FAMILY_SUBCATEGORIES,
  FRIENDS_PARENT_CATEGORY,
  FRIENDS_SUBCATEGORIES,
} from './types';
import { britDesignOf, copyFor, eventTypeOf, isBritType } from './lib/eventType';
import { Garland, NurseryDefs, Pram } from './components/NurseryArt';
import WelcomeNursery from './screens/WelcomeNursery';
import NurseryChoice from './screens/NurseryChoice';
import { DEPTH_CARD_INFO, DEPTH_ORDER } from './lib/depthCards';
import { DEPTH_LABELS } from './types';
import { selectBritQuestions } from './lib/britQuestions';
import { loadConfig, saveConfig } from './lib/config';
import { selectQuestions } from './lib/questions';
import { startUploaderAutoResume } from './lib/uploader';
import { purgeOrphanChunks } from './lib/storage';
import { releaseCamera } from './lib/camera';
import { checkCameraAccess, type CameraErrorInfo } from './lib/recorder';
import AuroraBg from './components/AuroraBg';
import FixHint from './components/FixHint';
import Welcome from './screens/Welcome';
import ClosedScreen from './screens/ClosedScreen';
import RotatePrompt from './components/RotatePrompt';
import RelationshipScreen from './screens/Relationship';
import SubCategoryScreen from './screens/SubCategory';
import DepthScreen from './screens/Depth';
import Countdown from './screens/Countdown';
import Recording from './screens/Recording';
import ThankYou from './screens/ThankYou';
import PinScreen from './screens/PinScreen';
import Admin from './screens/Admin';

export interface Session {
  relationship: Relationship[];
  depth: Depth | null;
  questions: string[];
  /** מלאי שאלות חלופיות לכפתור "להחליף שאלה" במסך הצילום */
  spares: string[];
  /** השאלה הראשונה נעולה להחלפה (פתיחת מסלול הברית) */
  fixedFirst?: boolean;
}

const EMPTY_SESSION: Session = {
  relationship: [],
  depth: null,
  questions: [],
  spares: [],
};

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [screen, setScreen] = useState<Screen>('welcome');
  const [session, setSession] = useState<Session>(EMPTY_SESSION);

  /**
   * `false` כשקריאת הקונפיג מהאחסון **נכשלה**. במצב הזה `config` הוא ברירת
   * מחדל בלבד, ולכן **אסור לכתוב אותו בחזרה** - זה ידרוס את ההגדרות האמיתיות.
   */
  const [storageOk, setStorageOk] = useState(true);

  // טעינת הקונפיג מ-IndexedDB (אסינכרוני)
  useEffect(() => {
    loadConfig().then((r) => {
      setStorageOk(r.storageOk);
      setConfig(r.config);
    });
  }, []);

  // החלת ערכת הצבע על root - בכל שינוי, לא רק בטעינה.
  // כך בחירת ערכה (במסך הפתיחה או בדשבורד) נכנסת לתוקף מיד.
  useEffect(() => {
    document.documentElement.dataset.theme = config?.theme || 'gold';
  }, [config?.theme]);

  /**
   * עיצוב «צבעי מים» של מסלול ברית/בריתה. `null` = המראה הרגיל.
   *
   * חל **רק על מסכי האורח ורק בזמן אירוע**: הדשבורד ומסך הקוד נשארים
   * במראה שהמפעיל מכיר, ומסך הצילום נשאר כהה תמיד - שם הצילום הוא הרקע.
   */
  const design = config?.activeEvent ? britDesignOf(config) : null;
  const nursery =
    design && design !== 'classic' && !['recording', 'admin', 'pin'].includes(screen)
      ? design
      : null;

  // בהירות התצוגה - ציר נפרד מערכת הצבע, ולכן תכונה נפרדת.
  // עיצוב צבעי המים בנוי על המצב הבהיר, ולכן הוא מדליק אותו בעצמו.
  /**
   * ברית/בריתה = **בהיר גם בדשבורד ובמסך הקוד**, וגם במסך «העמדה תיפתח
   * בקרוב» שלפני האירוע. רועי ביקש שהמעבר לסוג האירוע הזה ייראה מיד:
   * שחור הוא המראה של החתונות. רק העיצוב «קלאסי» משאיר את מסכי האורח
   * כהים, ומסך הצילום כהה תמיד.
   */
  const britEvent = !!config && isBritType(eventTypeOf(config));
  const lightForBrit =
    britEvent && (screen === 'admin' || screen === 'pin' || !config?.activeEvent);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.mode =
      nursery || lightForBrit ? 'light' : config?.displayMode || 'dark';
    if (nursery) root.dataset.skin = 'nursery';
    else delete root.dataset.skin;
    // קובע את הצבע המשלים באיורים: כחול מאובק לברית, אפרסק לבריתה
    root.dataset.gender = config && eventTypeOf(config) === 'brita' ? 'f' : 'm';
  }, [nursery, lightForBrit, config]);

  /**
   * שמירת קונפיג ל-IndexedDB כשהוא משתנה.
   *
   * `storageOk` הוא שסתום בטיחות ולא בדיקה פורמלית: בלעדיו תקלת קריאה רגעית
   * אחת גררה **דריסה** של ההגדרות האמיתיות בברירות מחדל, כי הטעינה הראשונה
   * מפעילה את ה-effect הזה בעצמה.
   */
  useEffect(() => {
    if (config && storageOk) {
      saveConfig(config);
    }
  }, [config, storageOk]);

  // שכבה 1: מפעיל את מעלה-הרקע (מנקה תור פתוח מאירוע קודם, מתחדש בחזרת רשת)
  useEffect(() => {
    startUploaderAutoResume();
    /**
     * מקטעים של הקלטות שלא הושלמו. בלי הניקוי הזה הם נשארים על הדיסק
     * לנצח בגודל ההקלטה המלאה, ומצטברים עד שהאייפד מתמלא באמצע אירוע.
     */
    void purgeOrphanChunks();
  }, []);

  const reset = useCallback(() => {
    /**
     * ⚠️ **חובה לשחרר את המצלמה כאן.**
     *
     * מסך הספירה פותח זרם לתצוגה המקדימה. אורח שמבטל שם לא מגיע למסך
     * הצילום, ולכן `close()` של המקליט לעולם לא ירוץ - והמצלמה הייתה
     * נשארת פתוחה עם הנורה דולקת עד לרענון הדף.
     */
    releaseCamera();
    setSession(EMPTY_SESSION);
    setScreen('welcome');
  }, []);

  /**
   * מוודא גישה למצלמה **לפני** שהאורח מתחיל, ומשחרר מיד.
   *
   * בלי זה הכשל התגלה רק במסך הצילום - אחרי שהאורח כבר עבר שלושה מסכים.
   * ההרשאה נשמרת לאורך טעינת הדף, ולכן זה עולה חלונית אחת לכל היותר
   * (ובדרך כלל אפס, כי המפעיל הריץ «בדיקת מצלמה» בתחילת הערב).
   * משחררים מיד כדי לא לשרוף סוללה ולא להדליק את מחוון הפרטיות לשווא.
   */
  const [startError, setStartError] = useState<CameraErrorInfo | null>(null);
  const [starting, setStarting] = useState(false);
  const startFlow = async () => {
    setStarting(true);
    const problem = await checkCameraAccess();
    setStarting(false);
    if (problem) {
      setStartError(problem);
      return;
    }
    setStartError(null);
    setScreen('relationship');
  };


  // כניסה לניהול: כפתור גלגל דיסקרטי או לחיצה ארוכה (1.2 שנ') בפינה - שניהם פותחים מסך קוד
  const [pressTimer, setPressTimer] = useState<number | null>(null);
  const startAdminPress = () => {
    const t = window.setTimeout(() => setScreen('pin'), 1200);
    setPressTimer(t);
  };
  const cancelAdminPress = () => {
    if (pressTimer) window.clearTimeout(pressTimer);
    setPressTimer(null);
  };

  // מונע תפריט הקשר בלחיצה ארוכה (למצב קיוסק)
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    document.addEventListener('contextmenu', block);
    return () => document.removeEventListener('contextmenu', block);
  }, []);

  /**
   * המסך הבא אחרי הבחירה: חברים → משפחה → עומק.
   *
   * מאז שהמסך הראשי הוא **בחירה יחידה**, «חברים» ו«משפחה» הן זו או זו,
   * ולכן רק תת-מסך אחד יופיע בפועל. השרשור נשאר כי הוא נכון גם כך ולא
   * מזיק - הוא פשוט לא ייכנס לתרחיש השני.
   */
  const nextAfter = (rel: Relationship[], done: 'main' | 'friends') => {
    if (done === 'main' && rel.includes(FRIENDS_PARENT_CATEGORY)) {
      return 'friendsSub' as const;
    }
    if (rel.includes(FAMILY_PARENT_CATEGORY)) return 'familySub' as const;
    return 'depth' as const;
  };

  const chooseRelationship = (relationship: Relationship[]) => {
    setSession((s) => ({ ...s, relationship }));
    setScreen(nextAfter(relationship, 'main'));
  };

  /** תת-הקטגוריה **מתווספת** לבחירה, כדי שהסינון הקיים יעבוד בלי שינוי */
  const chooseFriendsSub = (subs: Relationship[]) => {
    const merged = Array.from(new Set([...session.relationship, ...subs]));
    setSession((s) => ({ ...s, relationship: merged }));
    setScreen(nextAfter(merged, 'friends'));
  };

  const chooseFamilySub = (subs: Relationship[]) => {
    setSession((s) => ({
      ...s,
      relationship: Array.from(new Set([...s.relationship, ...subs])),
    }));
    setScreen('depth');
  };

  /** מסלול ברית: מסך קרבה אחד, ומשם ישר לעומק - בלי תת-מסכים */
  const chooseBritRelationship = (relationship: Relationship[]) => {
    setSession((s) => ({ ...s, relationship }));
    setScreen('depth');
  };

  const chooseDepth = (depth: Depth) => {
    if (!config) return;
    const select = isBritType(eventTypeOf(config))
      ? selectBritQuestions
      : selectQuestions;
    const { questions, spares, fixedFirst } = select(
      config,
      session.relationship,
      depth,
    );
    setSession((s) => ({ ...s, depth, questions, spares, fixedFirst }));
    setScreen('countdown');
  };

  // מסך המתנה קצר עד שהקונפיג נטען מ-IndexedDB
  if (!config) {
    return <div className="screen splash" />;
  }

  const brit = isBritType(eventTypeOf(config));
  const copy = copyFor(eventTypeOf(config));
  // ילד ראשון = אין אחים, והאפשרות יורדת מהמסך (נקבע בדשבורד)
  const britRelationships = BRIT_RELATIONSHIPS.filter(
    (rel) => rel !== 'אחים ואחיות' || config.britHasSiblings !== false,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', position: 'relative' }}>
      {/* רקע חי - Aurora מאחורי כל המסכים */}
      <AuroraBg />

      {nursery && <NurseryDefs />}
      {/* איור קטן במסך התודה. מסך הפתיחה ומסכי הבחירה מציירים את האיורים
          שלהם בעצמם, ובספירה לאחור המצלמה צריכה את כל תשומת הלב. */}
      {nursery && screen === 'thankyou' &&
        (nursery === 'garland' ? (
          <Garland className="nd-art nd-garland" />
        ) : (
          <Pram className="nd-art nd-pram" />
        ))}

      {/*
        האחסון לא נקרא - מוצג בכל מסך, כולל לאורחים.
        בלי החיווי הזה העמדה נראית פשוט «סגורה» וההגדרות נראות כאילו נמחקו,
        בזמן שהן שלמות על הדיסק ורק לא נטענו. רענון פותר; המשך עבודה במצב
        הזה היה דורס אותן.
      */}
      {!storageOk && (
        <div className="storage-warning" role="alert">
          ⚠️ לא הצלחנו לקרוא את ההגדרות מהמכשיר. <b>ההגדרות לא נמחקו</b> - הן
          פשוט לא נטענו, והשמירה מושבתת כדי לא לדרוס אותן.
          <FixHint
            steps={[
              'לחצו «רענון»',
              'אם זה חוזר: סגרו טאבים אחרים של האפליקציה - טאב פתוח נוסף חוסם את מסד הנתונים',
              'אל תגדירו הכל מחדש לפני שהרענון הצליח - ההגדרות במקומן והשמירה מושבתת בכוונה',
            ]}
          />
          <button className="btn secondary" onClick={() => location.reload()}>
            רענון
          </button>
        </div>
      )}

      {screen !== 'admin' && screen !== 'recording' && screen !== 'pin' && (
        <>
          <div
            className="admin-hotspot"
            onPointerDown={startAdminPress}
            onPointerUp={cancelAdminPress}
            onPointerLeave={cancelAdminPress}
          />
          <button
            className="gear-btn"
            aria-label="ניהול"
            onClick={() => setScreen('pin')}
          >
            ⚙
          </button>
        </>
      )}

      {/*
        בקשת סיבוב - רק לאורחים, לא חוסמת את הניהול.

        **ולא בזמן צילום.** ה-overlay הוא `z-index: 40` מול `.rec-bottom`
        שהוא `6`, ולכן הוא כיסה את כפתור «סיום הקלטה»: אורח שהאייפד הסתובב
        אצלו באמצע צילום נתקע מאחורי שכבה עד שתקרת 7 הדקות סיימה במקומו.
        ממילא אין מה לתקן שם - גודל ה-canvas ננעל כשהמצלמה נפתחה, וסיבוב
        באמצע לא משנה את הפריים שנשמר.
      */}
      {screen !== 'admin' && screen !== 'pin' && screen !== 'recording' && (
        <RotatePrompt want={config.orientation ?? 'auto'} />
      )}

      {/* כשל מצלמה בכניסה לזרימה - נעצרים כאן במקום שלושה מסכים קדימה */}
      {startError && (
        <div className="screen camera-block">
          <h2>רגע לפני שמתחילים</h2>
          <p className="subtitle">{startError.message}</p>
          <FixHint steps={startError.fix} />
          <div className="footer">
            {startError.canRetry && (
              <button className="btn" onClick={startFlow} disabled={starting}>
                {starting ? 'בודק…' : '🎥 נסה שוב'}
              </button>
            )}
            <button className="btn secondary" onClick={() => setStartError(null)}>
              חזרה
            </button>
          </div>
        </div>
      )}

      {screen === 'welcome' &&
        !startError &&
        (config.activeEvent ? (
          nursery ? (
            <WelcomeNursery config={config} design={nursery} onStart={startFlow} />
          ) : (
            <Welcome
              config={config}
              onStart={startFlow}
              onThemeChange={(theme) => setConfig({ ...config, theme })}
            />
          )
        ) : (
          <ClosedScreen config={config} />
        ))}
      {screen === 'relationship' && !brit && (
        <RelationshipScreen onNext={chooseRelationship} onBack={reset} />
      )}
      {screen === 'relationship' && brit && nursery && (
        <NurseryChoice
          design={nursery}
          title={copy.relationshipTitle}
          subtitle={copy.relationshipSubtitle}
          columns={2}
          options={britRelationships.map((rel) => ({
            key: rel,
            label: BRIT_RELATIONSHIP_LABELS[rel] ?? rel,
          }))}
          onChoose={(rel) => chooseBritRelationship([rel as Relationship])}
          onBack={reset}
        />
      )}
      {screen === 'relationship' && brit && !nursery && (
        <SubCategoryScreen
          title={copy.relationshipTitle}
          subtitle={copy.relationshipSubtitle}
          options={britRelationships}
          labels={BRIT_RELATIONSHIP_LABELS}
          withOther={false}
          onNext={chooseBritRelationship}
          onBack={reset}
        />
      )}
      {screen === 'friendsSub' && (
        <SubCategoryScreen
          title="איך אתם מכירים אותם?"
          options={FRIENDS_SUBCATEGORIES}
          onNext={chooseFriendsSub}
          onBack={() => setScreen('relationship')}
        />
      )}
      {screen === 'familySub' && (
        <SubCategoryScreen
          title="מה הקרבה המשפחתית?"
          options={FAMILY_SUBCATEGORIES}
          onNext={chooseFamilySub}
          // חזרה למסך הקודם בשרשרת, לא תמיד למסך הראשי
          onBack={() =>
            setScreen(
              session.relationship.includes(FRIENDS_PARENT_CATEGORY)
                ? 'friendsSub'
                : 'relationship',
            )
          }
        />
      )}
      {screen === 'depth' && nursery && (
        <NurseryChoice
          design={nursery}
          title="כמה בא לכם לשתף?"
          subtitle="בחרו את מה שמתאים לכם"
          columns={1}
          options={DEPTH_ORDER.map((depth) => ({
            key: depth,
            label: DEPTH_LABELS[depth],
            hint: DEPTH_CARD_INFO[depth].hint,
            tag: DEPTH_CARD_INFO[depth].tag,
          }))}
          onChoose={(depth) => chooseDepth(depth as Depth)}
          onBack={() => setScreen('relationship')}
        />
      )}
      {screen === 'depth' && !nursery && (
        <DepthScreen
          onNext={chooseDepth}
          onBack={() =>
            setScreen(
              // במסלול ברית אין תת-מסכים, גם כשהקרבה שנבחרה היא «משפחה»
              brit
                ? 'relationship'
                : session.relationship.includes(FAMILY_PARENT_CATEGORY)
                  ? 'familySub'
                  : session.relationship.includes(FRIENDS_PARENT_CATEGORY)
                    ? 'friendsSub'
                    : 'relationship',
            )
          }
        />
      )}
      {screen === 'countdown' && (
        <Countdown
          onDone={() => setScreen('recording')}
          onCancel={reset}
        />
      )}
      {screen === 'recording' && session.depth && (
        <Recording
          config={config}
          session={session}
          onFinish={() => setScreen('thankyou')}
          onCancel={reset}
          onQuestionsSwapped={(texts) =>
            setConfig((prev) => {
              if (!prev) return prev;
              const stats = { ...(prev.skipStats ?? {}) };
              for (const t of texts) stats[t] = (stats[t] ?? 0) + 1;
              return { ...prev, skipStats: stats };
            })
          }
        />
      )}
      {screen === 'thankyou' && (
        <ThankYou
          message={copy.thankYou}
          autoResetSeconds={config.autoResetSeconds}
          onReset={reset}
        />
      )}
      {screen === 'pin' && (
        <PinScreen
          expectedPin={config.adminPin}
          onSuccess={() => setScreen('admin')}
          onCancel={reset}
        />
      )}
      {screen === 'admin' && (
        <Admin
          config={config}
          onSave={setConfig}
          onExit={() => setScreen('welcome')}
        />
      )}
    </div>
  );
}
