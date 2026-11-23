import { useEffect, useRef, useState } from 'react';
import type { AppConfig, SessionMeta } from '../types';
import {
  copyFor,
  depthSettingsOf,
  displayName,
  eventTypeOf,
  isBritType,
} from '../lib/eventType';
import type { Session } from '../App';
import {
  QuestionRecorder,
  isRecordingSupported,
  describeCameraError,
  type CameraErrorInfo,
} from '../lib/recorder';
import { recordingStore } from '../lib/storage';
import FixHint from '../components/FixHint';
import { enqueue, setRecordingActive } from '../lib/uploader';
import { startMicMeter } from '../lib/micLevel';
import { releaseCamera } from '../lib/camera';

interface Props {
  config: AppConfig;
  session: Session;
  onFinish: () => void;
  onCancel: () => void;
  /** מדווח אילו שאלות הוחלפו - נקרא פעם אחת בסיום, אחרי שההקלטה נעצרה */
  onQuestionsSwapped: (texts: string[]) => void;
}

/**
 * תקרת זמן הקלטה. ההקלטה נצברת כולה בזיכרון עד לשמירה.
 *
 * ⚠️ **נמדד בפועל על קבצים אמיתיים: 7.4 Mbps** - כפול ממה שביקשנו
 * מהדפדפן, שמתעלם מ-`videoBitsPerSecond`. כלומר דקה ≈ 56 מ"ב.
 *
 * **הורדה מ-7 ל-5 דקות** אחרי שהקלטה של 7 דקות (389 מ"ב) גררה בשדה
 * תקיעה ב«שומר...» ומסך קפוא. 5 דקות ≈ 277 מ"ב - עדיין הרבה, אבל
 * רחוק יותר מהקצה שבו ספארי נחנק.
 */
/**
 * תקרת ההקלטה, **נגזרת מהעומק**.
 *
 * בפריסטייל הזמן הוא המגבלה היחידה (אין מכסת שאלות), ולכן התקרה שם היא
 * ההגדרה מהדשבורד - 4 דקות כברירת מחדל. בשאר העומקים נשארת התקרה
 * הגלובלית של 5 דקות כרשת ביטחון מפני הקלטה שנשכחה.
 */
const HARD_MAX_MS = 5 * 60 * 1000;
/** מתי להתריע שהזמן עומד להיגמר */
const WARN_BEFORE_MS = 30 * 1000;

/** mm:ss לטיימר המפעיל */
function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function Recording({
  config,
  session,
  onFinish,
  onCancel,
  onQuestionsSwapped,
}: Props) {
  const maxRecordingMs =
    session.depth === 'many'
      ? Math.min(
          HARD_MAX_MS,
          Math.round(depthSettingsOf(config).freestyleMinutes * 60 * 1000),
        )
      : HARD_MAX_MS;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<QuestionRecorder | null>(null);
  const lastTakeRef = useRef<{ blob: Blob; meta: SessionMeta } | null>(null);
  const [qIndex, setQIndex] = useState(0);
  // השאלות הן state (ולא קבוע מה-session) כי "להחליף שאלה" מחליפה שאלה במקומה
  const [questions, setQuestions] = useState<string[]>(session.questions);
  const [spares, setSpares] = useState<string[]>(session.spares);
  // נצבר מקומית ומדווח פעם אחת בסיום - כדי לא לכתוב לאחסון באמצע הקלטה
  const [swappedOut, setSwappedOut] = useState<string[]>([]);
  const [error, setError] = useState<CameraErrorInfo | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  /** עוצמת המיקרופון 0..1 - לתצוגה בלבד, לעולם לא על הקנבס */
  const [micLevel, setMicLevel] = useState(0);
  /**
   * המיקרופון לא משדר כלום. `ref` לצד ה-state כי `finish` קורא את הערך
   * אחרי כמה `await`, ושם ה-state של הרינדור שבו הוא נוצר כבר ישן.
   */
  const [micDead, setMicDead] = useState(false);
  const micDeadRef = useRef(false);
  const onMicSilence = (silent: boolean) => {
    micDeadRef.current = silent;
    setMicDead(silent);
  };
  /** מזהה שמאלץ הרכבה מחדש של ההקלטה כשלוחצים «התחל מחדש» */
  const [takeId, setTakeId] = useState(0);
  const [showHint, setShowHint] = useState(true);
  // מתי ההקלטה התחילה בפועל (null עד שהמצלמה נפתחה) + כמה זמן עבר
  const [recStartedAt, setRecStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  // מונע סיום כפול (טיימר + לחיצה של האורח באותו רגע)
  const stopMeterRef = useRef<(() => void) | null>(null);
  /**
   * `true` כשהמסך באמת נעזב (סיום / ביטול), `false` כשזו רק הרכבה מחדש
   * של «התחל מחדש». זה מה שקובע אם לכבות את המצלמה.
   */
  const leavingRef = useRef(true);
  const finishingRef = useRef(false);
  // ref ל-finish כדי שהטיימר יקרא לגרסה העדכנית ולא ל-closure ישן
  const finishRef = useRef<() => void>(() => {});

  // רמז "הביטו למצלמה" - נעלם אחרי כמה שניות
  useEffect(() => {
    const t = window.setTimeout(() => setShowHint(false), 3500);
    return () => window.clearTimeout(t);
  }, []);

  // תקרת זמן - מסיים ושומר מסודר. האורח לא מאבד דבר; מה שהוקלט נשמר.
  useEffect(() => {
    if (recStartedAt == null) return;
    const id = window.setInterval(() => {
      const passed = Date.now() - recStartedAt;
      setElapsedMs(passed);
      if (passed >= maxRecordingMs) {
        window.clearInterval(id);
        finishRef.current();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [recStartedAt, maxRecordingMs]);

  const isLast = qIndex >= questions.length - 1;
  // ריק במסלול ברית - שם השאלה הסוגרת מדברת בעד עצמה
  const closingLabel = copyFor(eventTypeOf(config)).closingLabel;
  // השאלה האחרונה היא תמיד הברכה - ואסור להחליף אותה.
  // בלי התנאי הזה כפתור «להחליף שאלה» היה מוצג גם על הברכה,
  // ולחיצה עליו הייתה מוחקת אותה מההקלטה לגמרי.
  // במסלול ברית גם הראשונה נעולה: «מי אתם בשבילי» היא מה שהופך את
  // הסרטון למובן בעוד שנים, ולכן אסור שתוחלף בשאלה אחרת.
  const isFixedFirst = !!session.fixedFirst && qIndex === 0;
  const canSwap = spares.length > 0 && !isLast && !isFixedFirst;

  /**
   * פותח את המצלמה ומתחיל להקליט. מופרד מה-effect כדי ש«נסה שוב» יוכל
   * לקרוא לו - קריאה ל-getUserMedia **מתוך לחיצה** היא מה שמקפיץ מחדש את
   * חלונית ההרשאה של iOS.
   */
  const startCamera = async (cancelledRef?: { current: boolean }) => {
    // סוגרים מקליט קודם לפני ניסיון חוזר - אחרת נשארים tracks תלויים
    // וה-NotReadableError פשוט יחזור על עצמו.
    if (recorderRef.current) await recorderRef.current.close();

    const recorder = new QuestionRecorder(canvasRef.current!);
    recorderRef.current = recorder;
    // מה שנצרב לקובץ. נקבע לפני `start()` כי הוא חלק מהפריים עצמו.
    // הצבע נקרא מהערכה הפעילה, כך ש«לפי הערכה» עובד לכל שש הערכות.
    const rootStyle = getComputedStyle(document.documentElement);
    // במסלול ברית הצבע שנצרב בסרטון (הקו מתחת לשאלה, תאריך החותמת) הוא
    // צבע העיצוב שנבחר. בחתונה `--brit-video` לא מוגדר והכול נשאר זהב.
    const britVideo = isBritType(eventTypeOf(config))
      ? rootStyle.getPropertyValue('--brit-video').trim()
      : '';
    recorder.setVideoStyle({
      frame: config.videoFrame ?? 'none',
      stamp: config.videoStamp ?? 'off',
      stampName: displayName(config),
      stampDate: (config.activeEvent?.date || config.eventDate || '').trim(),
      accent: britVideo || rootStyle.getPropertyValue('--ac').trim() || '#C9A84C',
      ...(britVideo ? { underline: britVideo } : {}),
    });
    try {
      await recorder.openCamera();
      if (cancelledRef?.current) {
        await recorder.close();
        return;
      }
      recorder.setQuestion(questions[qIndex] ?? '');
      recorder.start();
      setRecStartedAt(Date.now());
      setError(null);
      // מד המיקרופון מאזין לזרם החי. `startMicMeter` אינו הבעלים של הזרם
      // ולכן לא יעצור טראקים - הבעלות נשארת ב-`camera.ts`.
      const stream = recorder.getStream?.();
      if (stream) {
        stopMeterRef.current?.();
        stopMeterRef.current = startMicMeter(stream, setMicLevel, {
          onSilence: onMicSilence,
        });
      }
    } catch (e) {
      console.error('camera failed', e);
      if (!cancelledRef?.current) setError(describeCameraError(e));
    }
  };

  const retryCamera = async () => {
    setRetrying(true);
    await startCamera();
    setRetrying(false);
  };

  // אתחול המצלמה וההקלטה
  useEffect(() => {
    if (!isRecordingSupported()) {
      setError({
        message: 'הדפדפן הזה לא תומך בהקלטת וידאו. נסו בספארי / כרום מעודכן.',
        canRetry: false,
        isPermission: false,
        fix: [
          'יש לפתוח את העמדה ב**ספארי** - כרום באייפון/אייפד לא תומך בהקלטה',
          'בספארי: שיתוף → «הוסף למסך הבית», ולפתוח משם',
        ],
      });
      return;
    }
    const cancelledRef = { current: false };
    // ברירת המחדל: הניקוי הבא הוא יציאה. `restartTake` מבטל זאת נקודתית.
    leavingRef.current = true;
    // עוצר את מעלה-הרקע כל עוד מסך ההקלטה פתוח. ראו `setRecordingActive`:
    // קריאת blobs גדולים מ-IndexedDB בזמן צילום פוגעת במקודד.
    setRecordingActive(true);
    void startCamera(cancelledRef);

    return () => {
      cancelledRef.current = true;
      stopMeterRef.current?.();
      stopMeterRef.current = null;
      // ביציאה מהמסך - בכל מסלול, כולל כשל - המעלה חוזר לעבוד
      setRecordingActive(false);
      recorderRef.current?.close();
      /**
       * המצלמה משוחררת **רק כשעוזבים את המסך באמת**, ולא בכל הרכבה
       * מחדש. `takeId` משתנה ב«התחל מחדש» ומפעיל את הניקוי הזה - ולכן
       * הוא בודק אם המסך עדיין חי לפני שהוא מכבה את המצלמה.
       */
      if (leavingRef.current) releaseCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takeId]);

  /**
   * מוחק את מה שצולם ומתחיל מיד מחדש - **עם אותן שאלות**.
   *
   * לא חוזרים לבחירת קרבה ועומק: האורח כבר בחר, והוא רק רוצה טייק שני.
   * `close()` עוצר את המקליט ומנקה מקטעים; העלאת `takeId` מרכיבה את
   * אפקט המצלמה מחדש, וכך נפתחת הקלטה נקייה. המצלמה עצמה נשארת פתוחה
   * דרך `camera.ts`, ולכן אין פתיחה כפולה.
   */
  const restartTake = async () => {
    if (saving) return;
    // ההרכבה הבאה היא טייק חדש ולא יציאה - המצלמה נשארת פתוחה
    leavingRef.current = false;
    stopMeterRef.current?.();
    stopMeterRef.current = null;
    await recorderRef.current?.close();
    recorderRef.current = null;
    lastTakeRef.current = null;
    setQIndex(0);
    setRecStartedAt(null);
    setElapsedMs(0);
    setMicLevel(0);
    onMicSilence(false);
    setSaveError(false);
    setTakeId((n) => n + 1);
  };

  const nextQuestion = () => {
    const next = qIndex + 1;
    setQIndex(next);
    recorderRef.current?.setQuestion(questions[next] ?? '');
  };

  /**
   * מחליף את השאלה הנוכחית בשאלה מהרזרבה - **במקומה**, בלי לשנות את אורך
   * הרשימה. כך האורח עדיין עונה על אותה כמות שאלות שבחר; רק הוצגו לו יותר.
   */
  const swapQuestion = () => {
    if (spares.length === 0) return;
    // הגנה כפולה על הברכה: גם אם הכפתור ייחשף בעתיד בטעות, הלוגיקה
    // עצמה מסרבת להחליף את השאלה האחרונה.
    if (isLast || isFixedFirst) return;
    const [replacement, ...rest] = spares;
    const removed = questions[qIndex];
    setQuestions((prev) => {
      const updated = [...prev];
      updated[qIndex] = replacement;
      return updated;
    });
    setSpares(rest);
    if (removed) setSwappedOut((prev) => [...prev, removed]);
    recorderRef.current?.setQuestion(replacement);
  };

  // שומר את ההקלטה ומאמת שהיא נקראת ולא ריקה (שכבת בטיחות 0)
  //
  // מגבלות הזמן חיות ב-`storage.ts` עצמו, ולכן כשל כאן מגיע כשגיאה ולא
  // כהמתנה אינסופית. זה מה שהחזיר את «שומר...» מתקיעה ללא מוצא למסך
  // שחזור עם ההקלטה עדיין בזיכרון.
  const persist = async (blob: Blob, meta: SessionMeta) => {
    const id = await recordingStore.save(blob, meta);
    const check = await recordingStore.get(id);
    if (!check || check.size === 0) {
      throw new Error('integrity check failed');
    }
    enqueue(); // שכבה 1: מפעיל העלאה לענן ברקע (אם מוגדר)
    return id;
  };

  const finish = async () => {
    if (finishingRef.current) return; // כבר בתהליך - טיימר ולחיצה יחד
    finishingRef.current = true;
    const recorder = recorderRef.current;
    if (!recorder) return onFinish();
    setSaving(true);
    setSaveError(false);
    try {
      /**
       * ⚠️ **אין לתקן כאן את המשך בכותרת. זה שובר את הקובץ.**
       *
       * היה כאן `fixMp4Duration` שכתב `duration` ל-`mvhd`/`mdhd` כדי
       * ש-QuickTime לא יציג משך אבסורדי. התוצאה הייתה הרסנית: הקובץ
       * שמיוצר הוא **fragmented MP4**, ובו טבלאות הדגימות (`stts`,
       * `stsz`, `stco`) ריקות - הנתונים חיים במקטעי `moof`/`mdat`.
       * `duration = 0` הוא מה שאומר לנגן «סרוק את המקטעים».
       *
       * ברגע שנכתב משך, macOS מתייחס לקובץ כ-MP4 רגיל, מחפש דגימות
       * בטבלאות הריקות ולא מוצא כלום: **אין תמונה ממוזערת, והנגן קופא
       * על הפריים הראשון.** נמדד: קבצים ללא התיקון יצרו תמונה ממוזערת
       * 4 מתוך 4; קבצים עם התיקון - אפס.
       *
       * משך שמוצג מוזר הוא מטרד. קובץ שלא נפתח הוא אובדן המזכרת.
       */
      const { blob } = await recorder.stop();
      // ההקלטה כבר נעצרה - מכאן בטוח לכתוב לאחסון בלי לפגוע בפריימים
      if (swappedOut.length) onQuestionsSwapped(swappedOut);
      const meta: SessionMeta = {
        eventName: config.activeEvent?.name || config.eventName,
        eventId: config.activeEvent?.id,
        eventType: eventTypeOf(config),
        ...(micDeadRef.current ? { micSilent: true } : {}),
        relationship: session.relationship,
        depth: session.depth!,
        timestamp: Date.now(),
        questions,
        ...(swappedOut.length ? { swappedOut } : {}),
      };
      lastTakeRef.current = { blob, meta }; // שומרים בזיכרון עד שמאומת
      await persist(blob, meta);
      // ההקלטה נשמרה כרשומה שלמה - המקטעים על הדיסק כבר מיותרים
      await recorder.discardChunks();
      await recorder.close();
      onFinish();
    } catch (e) {
      console.error('save failed', e);
      /**
       * ניסיון הצלה אחרון: אם הכשל היה **ב-`recorder.stop()` עצמו**,
       * `lastTakeRef` עדיין ריק - ואז מסך השחזור היה מבטיח «ההקלטה עדיין
       * אצלנו» בזמן שאין לו כלום, ושני הכפתורים שלו לא היו עושים דבר.
       * `salvage()` מרכיב את המקטעים שכבר נצברו בזיכרון.
       */
      if (!lastTakeRef.current) {
        const salvaged = await recorder.salvage();
        if (salvaged) {
          lastTakeRef.current = {
            blob: salvaged.blob,
            meta: {
              eventName: config.activeEvent?.name || config.eventName,
              eventId: config.activeEvent?.id,
              eventType: eventTypeOf(config),
              ...(micDeadRef.current ? { micSilent: true } : {}),
              relationship: session.relationship,
              depth: session.depth!,
              timestamp: Date.now(),
              questions,
              ...(swappedOut.length ? { swappedOut } : {}),
            },
          };
        }
      }
      // לא מאבדים את ההקלטה - נשארים במסך ומאפשרים ניסיון חוזר
      finishingRef.current = false;
      setSaving(false);
      setSaveError(true);
    }
  };
  finishRef.current = finish;

  const retrySave = async () => {
    const take = lastTakeRef.current;
    if (!take) return onFinish();
    setSaving(true);
    setSaveError(false);
    try {
      await persist(take.blob, take.meta);
      await recorderRef.current?.discardChunks();
      await recorderRef.current?.close();
      onFinish();
    } catch (e) {
      console.error('retry save failed', e);
      setSaving(false);
      setSaveError(true);
    }
  };

  const downloadTake = () => {
    const take = lastTakeRef.current;
    if (!take) return;
    const url = URL.createObjectURL(take.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solotalk_recovery_${take.meta.timestamp}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  if (error) {
    return (
      <div className="screen">
        <h2>אופס</h2>
        <p className="subtitle">{error.message}</p>
        <FixHint steps={error.fix} />
        <div className="footer">
          {error.canRetry && (
            <button className="btn" onClick={retryCamera} disabled={retrying}>
              {retrying ? 'פותח מצלמה…' : '🎥 נסה שוב'}
            </button>
          )}
          <button className="btn secondary" onClick={onCancel}>
            חזרה
          </button>
        </div>
      </div>
    );
  }

  if (saveError) {
    // אסור להבטיח «ההקלטה אצלנו» בלי לבדוק - הכפתורים תלויים בדיוק בזה.
    const hasTake = lastTakeRef.current != null;
    return (
      <div className="screen">
        <h2>רגע - לא הצלחנו לשמור</h2>
        <p className="subtitle">
          {hasTake
            ? 'ההקלטה עדיין אצלנו ולא אבדה. נסו לשמור שוב, או הורידו אותה כגיבוי.'
            : 'ההקלטה הופסקה לפני שנשמרה. אפשר לצלם שוב - זה ייקח רגע.'}
        </p>
        <FixHint
          steps={
            hasTake
              ? [
                  'לחצו «נסה לשמור שוב»',
                  'אם נכשל שוב - «הורדה כגיבוי» שומרת את הסרטון למכשיר, ואפשר להעלות אותו ידנית אחר כך',
                  'אל תצאו מהמסך עד שאחת מהפעולות הצליחה - ההקלטה חיה בזיכרון בלבד',
                ]
              : [
                  'אפשר לצלם שוב - ההקלטה לא הגיעה לשלב השמירה',
                  'אם זה חוזר: ייתכן שהאחסון במכשיר מלא. בדשבורד אפשר למחוק הקלטות שכבר גובו לענן',
                ]
          }
        />
        <div className="footer">
          {hasTake ? (
            <>
              <button className="btn" onClick={retrySave} disabled={saving}>
                {saving ? 'שומר...' : 'נסה לשמור שוב'}
              </button>
              <button className="btn secondary" onClick={downloadTake}>
                הורדה כגיבוי
              </button>
            </>
          ) : (
            <button className="btn" onClick={onCancel}>
              חזרה למסך הפתיחה
            </button>
          )}
        </div>
      </div>
    );
  }

  const remainingMs = Math.max(0, maxRecordingMs - elapsedMs);
  const showTimeLeft = recStartedAt != null && remainingMs <= WARN_BEFORE_MS;

  return (
    <div className="recording-screen">
      <canvas ref={canvasRef} className="recording-canvas" />

      {/*
        טיימר למפעיל. **HTML ולא קנבס** - ולכן הוא לא נצרב לקובץ ולא מגיע
        לזוג. כל מה שמצויר על הקנבס נכנס לסרטון; רק שכבת ה-HTML לא.
      */}
      {/**
        * סרגל עליון - **כל מה שאינו חלק מהסרטון גר כאן**.
        *
        * הוא יושב על ה-scrim הכהה שכבר קיים מעל השאלה הצרובה, ולכן לא
        * נדרש שינוי במה שנצרב לקובץ. קודם הווליום וההתחלה־מחדש היו
        * מרחפים על השאלה עצמה ומסתירים אותה.
        */}
      <div className="rec-topbar">
        <div className="rec-status">
          <span className="rec-stat rec-live">
            <span className="rec-dot" />
            מקליט
          </span>

      {/*
        זמן ההקלטה למפעיל, בפינה הנגדית לתג «מקליט».
        **HTML ולא קנבס** - ולכן לא נצרב לקובץ ולא מגיע לזוג.

        ⚠️ **אלמנט אחד לשני המצבים.** קודם היו כאן שני אלמנטים באותו
        מיקום בדיוק, והתראת «נותרו X שניות» נערמה על השעון במקום להחליף
        אותו - שתי שורות טקסט אחת על השנייה.
      */}
          {recStartedAt != null && (
            <span className={`rec-stat rec-time ${showTimeLeft ? 'warn' : ''}`} role="timer">
              {showTimeLeft
                ? `נותרו ${Math.ceil(remainingMs / 1000)}`
                : formatElapsed(elapsedMs)}
            </span>
          )}

          {/* מד המיקרופון. HTML בלבד - ראו `micLevel.ts`. */}
          <span className="rec-stat rec-vol" title="עוצמת המיקרופון">
            <span className="rec-bars" aria-hidden>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                const on = micLevel * 7 > i;
                return (
                  <b
                    key={i}
                    className={on ? (micLevel < 0.18 ? 'low' : 'ok') : ''}
                    style={{ height: `${8 + i * 3}px` }}
                  />
                );
              })}
            </span>
          </span>
        </div>

        {/**
          * «התחל מחדש» - פעולה **הרסנית**, ולכן בצד הנגדי, בלי מילוי,
          * ורחוקה מאשכול הפעולות התחתון. מחיקה בטעות באמצע ברכה היא
          * נזק שאין לו תיקון.
          */}
        <button
          className="rec-restart"
          onClick={restartTake}
          disabled={saving}
        >
          ↺ התחל מחדש
        </button>
      </div>

      {showHint && !isLast && !micDead && (
        <div className="look-hint">👆 הביטו למצלמה</div>
      )}

      {/*
        המיקרופון לא משדר. **HTML ולא קנבס** - לא נצרב לסרטון.
        האורח לא יכול לתקן את זה, ולכן ההודעה שולחת אותו למפעיל במקום
        להמשיך לצלם סרטון אילם.
      */}
      {micDead && (
        <div className="rec-mic-dead" role="alert">
          <b>🎤 לא שומעים אתכם</b>
          <span>המיקרופון לא קולט קול - קראו למפעיל העמדה</span>
        </div>
      )}

      {/* מסך הברכה מסומן במפורש - כך אין ספק שזו הסגירה ולא שאלה שנדדה */}
      {isLast && questions.length > 1 && closingLabel && (
        <div className="rec-closing" role="status">
          {closingLabel}
        </div>
      )}

      <div className="rec-bottom">
        <button
          className="btn danger rec-finish"
          onClick={finish}
          disabled={saving}
        >
          {saving ? 'שומר...' : 'סיום הקלטה'}
        </button>
        {!isLast && (
          <button className="btn rec-next" onClick={nextQuestion} disabled={saving}>
            לשאלה הבאה ›{' '}
            {/* הברכה לא נספרת - «עד 8 שאלות» צריך להציג 1/8 ולא 1/9 */}
            {questions.length > 2 && (
              <span className="rec-next-count">
                {qIndex + 1}/{questions.length - 1}
              </span>
            )}
          </button>
        )}

        {canSwap && (
          <button
            className="btn ghost rec-swap"
            onClick={swapQuestion}
            disabled={saving}
          >
            <span className="rec-swap-icon" aria-hidden>
              ⟳
            </span>{' '}
            החלף
          </button>
        )}
      </div>
    </div>
  );
}
