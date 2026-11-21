import { useEffect, useRef, useState } from 'react';
import type {
  ActiveEvent,
  AppConfig,
  DepthSettings,
  DisplayMode,
  EventType,
  Question,
  RecordingInfo,
  StationOrientation,
  VideoFrameStyle,
  VideoStampPos,
} from '../types';
import {
  BRIT_RELATIONSHIP_LABELS,
  BRIT_RELATIONSHIPS,
  DEFAULT_BRIT_DEPTH_SETTINGS,
  DEPTH_LABELS,
  DISPLAY_MODES,
  EVENT_TYPE_OPTIONS,
  ORIENTATION_OPTIONS,
  VIDEO_FRAME_OPTIONS,
  VIDEO_STAMP_OPTIONS,
} from '../types';
import { saveConfig } from '../lib/config';
import { DEFAULT_GENERIC } from '../lib/questions';
import {
  DEFAULT_BRIT,
  DEFAULT_BRIT_BLESSING,
  DEFAULT_BRIT_INTRO,
} from '../lib/britQuestions';
import { displayName, eventTypeOf, isBritType } from '../lib/eventType';
import { downscaleImage } from '../lib/image';
import { csvToQuestions, templateCsv } from '../lib/csv';
import { recordingStore } from '../lib/storage';
import { isCloudConfigured } from '../lib/firebase';
import { getLastUploadError, onUploadChange, processQueue, setExportActive } from '../lib/uploader';
import {
  startEvent,
  formatEventDate,
  pushPastEvent,
  recoverableEvents,
} from '../lib/event';
import { buildZip, splitBySize } from '../lib/zip';
import { repairSampleDurations } from '../lib/mp4Repair';
import { specificRelationship, safeSegment } from '../lib/naming';
import FixHint from '../components/FixHint';
import { DEFAULT_DEPTH_SETTINGS } from '../types';
import {
  listCloudEvents,
  downloadCloudFile,
  deleteCloudEvent,
  cloudFileUrl,
  CloudArchiveError,
  type CloudEvent,
} from '../lib/cloudArchive';
import {
  getCaptureDiagnostics,
  getRecordingProgress,
  checkCameraAccess,
  drawVideoFrame,
  drawVideoStamp,
  type CameraErrorInfo,
} from '../lib/recorder';
import QuestionEditor from '../components/QuestionEditor';
import PinScreen from './PinScreen';

/**
 * גודל מרבי לארכיון בודד — **תלוי מכשיר**.
 *
 * הפיצול נועד ל-iOS: תוסף השיתוף שם מוגבל בזיכרון, וכישלון באמצע ערב יקר.
 * אבל על **מחשב** הוא גרם נזק אמיתי: אירוע אחד התפצל ל-4 קבצים, והדפדפן
 * חוסם הורדות אוטומטיות רצופות (ההרשאה «אתר זה מבקש להוריד כמה קבצים»).
 * התוצאה — ירד `part1of4` בלבד, כלומר **רבע מהאירוע**, בלי שום שגיאה.
 *
 * קובץ יחיד עוקף את ההרשאה הזו לגמרי. הוא גם לא יקר יותר בזיכרון:
 * `buildZip` מחזיר Blob שמצביע על ה-blobs המקוריים ולא מעתיק אותם.
 * 3.9 ג"ב הוא בדיוק מתחת לסף ZIP64 שאינו נתמך כאן.
 */
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const ZIP_PART_MAX_BYTES = IS_IOS ? 500 * 1024 * 1024 : 3.9 * 1024 * 1024 * 1024;

interface Props {
  config: AppConfig;
  onSave: (config: AppConfig) => void;
  onExit: () => void;
}

function extForMime(mime: string): string {
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  return 'video';
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * מוריד כמה ארכיונים **ברצף, עם השהיה ביניהם**.
 *
 * ⚠️ קודם היה כאן `files.forEach(download)` - כל ההורדות נורו באותו tick.
 * הדפדפן מקבץ הורדות רצופות ומבטל את כל מה שאחרי הראשונה, ולכן אירוע
 * שנארז לשני חלקים הציג «אורז 2/2» אבל **הוריד קובץ אחד בלבד** - חצי
 * מהסרטונים של הזוג נעלמו בלי שום שגיאה.
 *
 * 600ms הוא אותו מרווח שכבר הוכח במסלול אריזת הענן.
 */
async function downloadAll(files: File[]): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    download(files[i], files[i].name);
    // eslint-disable-next-line no-await-in-loop
    if (i < files.length - 1) await new Promise((r) => setTimeout(r, 600));
  }
}

/**
 * שם הקובץ שהזוג רואה.
 *
 * `<שם הזוג> - <תאריך> - <מספר>.mp4`
 *
 * קודם היה כאן `soloTalk_<ASCII>_<תאריך>_<שעה>_<שייר מזהה>` - סינון
 * ה-ASCII מחק את השם העברי (נשאר «4» מתוך «בדיקה לייב 4»), והשעה והשייר
 * היו רעש שנועד רק למנוע התנגשות. מספר סידורי עושה את אותה עבודה
 * וקריא לאדם.
 */
function filenameFor(rec: RecordingInfo, index: number): string {
  const d = new Date(rec.meta.timestamp);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
  const name = (rec.meta.eventName || 'soloTalk')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  // הקרבה והעומק בסוף ולא בהתחלה: כך המיון בתיקייה נשאר לפי סדר הערב, והזוג
  // עדיין רואה מי מדבר בלי לפתוח. הקלטה ישנה בלי קרבה פשוט לא מקבלת את החלק הזה.
  const rel = specificRelationship(rec.meta.relationship);
  const relPart = rel ? ` - ${safeSegment(rel)}` : '';
  const depthPart = ` - ${safeSegment(DEPTH_LABELS[rec.meta.depth])}`;
  return `${name} - ${date} - ${p(index + 1)}${relPart}${depthPart}.${extForMime(rec.mimeType)}`;
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} שע׳ ${m} דק׳` : `${m} דק׳`;
}

/**
 * שלבי פתרון לפי **קוד השגיאה** של Firebase.
 *
 * קוד גולמי כמו `storage/unauthorized` לא אומר כלום למפעיל באמצע ערב.
 * המיפוי הזה הופך אותו לפעולה.
 */
function uploadFixSteps(code: string): string[] {
  const c = String(code);
  if (c.includes('unauthorized')) {
    return [
      'כללי ה-Storage חוסמים את ההעלאה',
      'בקונסול Firebase → Storage → Rules — לוודא ש-create מותר למשתמש מאומת',
      'ההקלטות במכשיר בטוחות. אל תמחקו כלום עד שהגיבוי חוזר לעבוד',
    ];
  }
  if (c.includes('unauthenticated')) {
    return [
      'ההתחברות ל-Firebase נכשלה',
      'בקונסול Firebase → Authentication — לוודא ש-Anonymous מופעל',
      'רעננו את הדף אחרי התיקון',
    ];
  }
  if (c.includes('quota') || c.includes('exceeded')) {
    return [
      'חרגתם ממכסת האחסון או מהתקציב בענן',
      'בדקו את מצב החיוב ב-Google Cloud',
      'ההקלטות במכשיר בטוחות — אל תמחקו אותן',
    ];
  }
  if (c.includes('timeout') || c.includes('retry') || c.includes('network')) {
    return [
      'הרשת איטית או מנותקת',
      'בדקו חיבור — ההעלאה מתחדשת לבד כשהרשת חוזרת',
      'אין צורך לעשות כלום חוץ מלוודא שהאייפד מחובר',
    ];
  }
  return [
    'רעננו את הדף — התור מתחדש אוטומטית',
    'ודאו שהאייפד מחובר לאינטרנט',
    'ההקלטות במכשיר בטוחות. אל תמחקו כלום כל עוד הגיבוי לא הושלם',
  ];
}

/** שלבי פתרון לשגיאות קריאה מארכיון הענן */
function cloudFixSteps(msg: string): string[] {
  const m = String(msg);
  if (m.includes('הרשאת קריאה')) {
    return [
      'בקונסול Firebase → Storage → Rules',
      'לוודא ש-read מותר למשתמש מאומת על recordings/',
      'לפרסם (Publish) ולחזור לכאן',
    ];
  }
  if (m.includes('Anonymous') || m.includes('ההתחברות')) {
    return ['בקונסול Firebase → Authentication → Sign-in method', 'להפעיל Anonymous', 'לרענן את הדף'];
  }
  if (m.includes('CORS')) {
    return [
      'צפייה והורדה בודדת עובדות — רק אריזת ZIP חסומה',
      'נדרשת הגדרת CORS על ה-bucket (מ-Cloud Shell בקונסול)',
      'לחלופין: להוריד את הסרטונים אחד-אחד',
    ];
  }
  if (m.includes('לא הסתיימה בזמן')) {
    return ['לחצו «רענן»', 'בדקו את חיבור האינטרנט', 'אם חוזר — נסו מהמחשב במקום מהאייפד'];
  }
  return ['לחצו «רענן»', 'בדקו חיבור לאינטרנט', 'אם חוזר — בדקו הרשאות Storage בקונסול'];
}

const UPLOAD_BADGE: Record<string, { label: string; cls: string }> = {
  uploaded: { label: '✓ בענן', cls: 'ok' },
  uploading: { label: '⬆ מעלה…', cls: 'busy' },
  failed: { label: '✗ נכשל', cls: 'fail' },
  pending: { label: '⏳ ממתין', cls: 'wait' },
};

/**
 * פריטי התפריט, לפי תדירות השימוש.
 *
 * הדשבורד גדל לדף אחד ארוך, וכל פיצ'ר חדש דחף משהו מתחת לקו הגלילה — הארכיונים
 * ישבו ~1,100px למטה ונראו כאילו נעלמו. תפריט מנתק את המיקום מהאורך: כל דבר
 * הוא הקלקה אחת, גם כשייווספו עוד מסכים.
 */
const NAV_ITEMS = [
  { key: 'main', icon: '🎬', label: 'מסך ראשי' },
  { key: 'welcome', icon: '🎨', label: 'מסך פתיחה' },
  { key: 'archive', icon: '🗂', label: 'ארכיון' },
  { key: 'questions', icon: '❓', label: 'שאלות' },
  { key: 'settings', icon: '🔐', label: 'הגדרות' },
] as const;

type NavKey = (typeof NAV_ITEMS)[number]['key'];

export default function Admin({ config, onSave, onExit }: Props) {
  const [draft, setDraft] = useState<AppConfig>(config);
  const [recordings, setRecordings] = useState<RecordingInfo[]>([]);
  const [status, setStatus] = useState('');
  const [showEndModal, setShowEndModal] = useState(false);
  // null = סגור · 'pin' = שער הקוד · 'list' = הארכיון פתוח
  const [archiveStep, setArchiveStep] = useState<'pin' | 'list' | null>(null);
  // האירוע שממתין לאישור מחיקה
  const [deleteTarget, setDeleteTarget] = useState<ActiveEvent | null>(null);
  const [cameraCheck, setCameraCheck] = useState<
    | { state: 'idle' }
    | { state: 'checking' }
    | { state: 'ok' }
    | { state: 'fail'; info: CameraErrorInfo }
  >({ state: 'idle' });
  // ---- ארכיון המנהל (ענן) ----
  const [cloudStep, setCloudStep] = useState<'pin' | 'list' | null>(null);
  const [cloudEvents, setCloudEvents] = useState<CloudEvent[]>([]);
  const [cloudBusy, setCloudBusy] = useState(false);
  /**
   * מקום פנוי במכשיר.
   *
   * למה זה נדרש: אירוע של 25 הקלטות שוקל כ-2.9 ג"ב, ולא הייתה שום דרך
   * לדעת **לפני** האירוע אם יש מקום. כשהאחסון נגמר באמצע ערב ההקלטה
   * נכשלת, והאורח מקבל «לא הצלחנו לשמור» — כשל שאפשר למנוע בבדיקה אחת.
   */
  const [storageInfo, setStorageInfo] = useState<{
    usage: number;
    quota: number;
  } | null>(null);
  const [cloudStatus, setCloudStatus] = useState('');
  const [cloudError, setCloudError] = useState('');
  const [cloudDeleteTarget, setCloudDeleteTarget] = useState<CloudEvent | null>(null);
  /**
   * אריזת ZIP דורשת CORS על ה-bucket, ואי אפשר לדעת מראש אם הוא מוגדר.
   * לכן הכפתור פעיל עד שניסיון אמיתי נכשל — ואז הוא מושבת עם הסבר, במקום
   * להישאר כפתור שנלחץ ולא קורה כלום.
   */
  const [zipAvailable, setZipAvailable] = useState(true);
  /** האירוע שרשימת הסרטונים שלו פתוחה */
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  /** קישורים ישירים לסרטונים, לפי מזהה אירוע. נטענים בפתיחה בלבד. */
  const [eventUrls, setEventUrls] = useState<Record<string, string[]>>({});

  /**
   * פותח את רשימת הסרטונים של אירוע וטוען קישורים ישירים.
   *
   * **זה הנתיב שעובד בלי CORS.** נמדד מול הענן: `fetch` על הקובץ נחסם
   * (ולכן אריזת ZIP בלתי אפשרית), אבל אותו קישור **נטען כמדיה** בלי בעיה.
   * כלומר גם היום, בלי שום הגדרה ב-Firebase, אפשר לפתוח כל סרטון ולשמור
   * אותו דרך תפריט השיתוף של הדפדפן.
   */
  const toggleEventFiles = async (ev: CloudEvent) => {
    if (openEvent === ev.id) {
      setOpenEvent(null);
      return;
    }
    setOpenEvent(ev.id);
    if (eventUrls[ev.id]) return;
    try {
      const urls = await Promise.all(ev.files.map((f) => cloudFileUrl(f)));
      setEventUrls((m) => ({ ...m, [ev.id]: urls }));
    } catch {
      setCloudError('לא הצלחנו לקבל קישורים לסרטונים של האירוע הזה');
    }
  };
  const [now, setNow] = useState(Date.now());
  const [showPrevEvents, setShowPrevEvents] = useState(false);
  /** פריט התפריט הפעיל. «מסך ראשי» כברירת מחדל — זה מה שהעובד צריך. */
  const [nav, setNav] = useState<NavKey>('main');
  /** בנק השאלות המלא מכווץ כברירת מחדל — הוא ארוך במאות שורות */
  const [bankOpen, setBankOpen] = useState(false);
  /** אישור פתיחת אירוע כשהמצלמה לא נבדקה — **מזהיר, לא חוסם** */
  const [confirmStart, setConfirmStart] = useState(false);
  /**
   * שער הקוד ל«הגדרות». נפתח פעם אחת לכל כניסה לדשבורד, ולא בכל מעבר בתפריט —
   * מסך שדורש קוד בכל הקלקה הוא מסך שמפסיקים להיכנס אליו.
   */
  const [settingsUnlocked, setSettingsUnlocked] = useState(false);
  /** ריק = תקין. מלא = הקריאה נכשלה, ואסור להציג «אין הקלטות» */
  const [recordingsError, setRecordingsError] = useState('');

  useEffect(() => {
    // `estimate()` לא נתמך בכל דפדפן — נכשל בשקט ופשוט לא מציג את השורה
    navigator.storage
      ?.estimate?.()
      .then((e) => {
        if (e.usage != null && e.quota != null) {
          setStorageInfo({ usage: e.usage, quota: e.quota });
        }
      })
      .catch(() => undefined);
  }, [recordings.length]);
  /** הקלטות שלא נכללו בארכיון האחרון כי לא ניתן היה לקרוא אותן */
  const [exportWarning, setExportWarning] = useState<string[]>([]);
  const [recordingsLoaded, setRecordingsLoaded] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const framePreviewRef = useRef<HTMLCanvasElement>(null);

  /** מעבר בין פריטי התפריט מחזיר את הגלילה לראש — אחרת נוחתים באמצע מסך חדש */
  const goto = (key: NavKey) => {
    setNav(key);
    bodyRef.current?.scrollTo({ top: 0 });
  };

  /**
   * תצוגה מקדימה של מה שייצרב לסרטון.
   *
   * משתמשת **באותן פונקציות** שהמקליט משתמש בהן (`drawVideoFrame`/
   * `drawVideoStamp`) ולא בחיקוי שלהן — חיקוי היה מתנתק מהמציאות בשינוי
   * הראשון, ואז המפעיל היה מאשר מסגרת אחת ומקבל אחרת. וזה נצרב לתמיד.
   */
  const previewStampName = displayName(draft);
  useEffect(() => {
    if (nav !== 'welcome') return;
    const cv = framePreviewRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const w = cv.width;
    const h = cv.height;
    const accent =
      getComputedStyle(document.documentElement)
        .getPropertyValue('--ac')
        .trim() || '#C9A84C';
    const stampName = previewStampName;
    const stampDate = (draft.activeEvent?.date || draft.eventDate || '').trim();

    const paint = (photo?: HTMLImageElement) => {
      ctx.clearRect(0, 0, w, h);
      if (photo) {
        // cover — בדיוק כמו drawLoop, כדי שהיחס בתצוגה יהיה אמיתי
        const va = photo.width / photo.height;
        const ca = w / h;
        let sw = photo.width;
        let sh = photo.height;
        let sx = 0;
        let sy = 0;
        if (va > ca) {
          sw = Math.round(photo.height * ca);
          sx = Math.round((photo.width - sw) / 2);
        } else {
          sh = Math.round(photo.width / ca);
          sy = Math.round((photo.height - sh) / 2);
        }
        ctx.drawImage(photo, sx, sy, sw, sh, 0, 0, w, h);
      } else {
        // בלי תמונת זוג — רקע ניטרלי שמראה את המסגרת על בהיר וכהה גם יחד
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#6b6f76');
        g.addColorStop(0.5, '#3a3d42');
        g.addColorStop(1, '#8a8f97');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = `600 ${Math.round(Math.min(w, h) * 0.045)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('תצוגה מקדימה', w / 2, h / 2);
      }
      drawVideoFrame(ctx, w, h, draft.videoFrame ?? 'none', accent);
      drawVideoStamp(ctx, w, h, stampName, stampDate, draft.videoStamp ?? 'off', accent);
    };

    if (draft.couplePhotoDataUrl) {
      const img = new Image();
      img.onload = () => paint(img);
      img.onerror = () => paint();
      img.src = draft.couplePhotoDataUrl;
    } else {
      paint();
    }
  }, [
    nav,
    draft.videoFrame,
    draft.videoStamp,
    draft.couplePhotoDataUrl,
    previewStampName,
    draft.eventDate,
    draft.activeEvent,
    draft.theme,
  ]);

  // שעון חי לחישוב משך האירוע (מתעדכן כל 30 שנ')
  useEffect(() => {
    if (!draft.activeEvent) return;
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, [draft.activeEvent?.id]);

  /**
   * ⚠️ **חייב `catch`.** בלעדיו כשל קריאה השאיר את `recordings` ריק, וכרטיס
   * הגיבוי (שמותנה ב-`recordings.length > 0`) נעלם - כלומר המסך הציג
   * «אפס סרטונים, אין מידע על הענן» בזמן ש-16 הקלטות ישבו בדיסק.
   * במבחן אמיתי זה נראה בדיוק כמו אובדן כל החומר.
   *
   * שקר על אובדן חומר גרוע מכל שגיאה, ולכן כשל נחשף במפורש ולא נבלע.
   */
  const refreshRecordings = () => {
    recordingStore
      .list()
      .then((r) => {
        setRecordings(r);
        setRecordingsError('');
        setRecordingsLoaded(true);
      })
      .catch((e) => {
        console.error('list recordings failed', e);
        setRecordingsError(
          String(e).includes('timeout')
            ? 'קריאת ההקלטות מהמכשיר לא הסתיימה. ההקלטות לא נמחקו — נסו לרענן.'
            : 'לא הצלחנו לקרוא את ההקלטות מהמכשיר. הן לא נמחקו — נסו לרענן.',
        );
        setRecordingsLoaded(true);
      });
  };

  useEffect(() => {
    refreshRecordings();
    // רענון חי של סטטוסי הגיבוי
    const off = onUploadChange(refreshRecordings);
    return off;
  }, []);

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(''), 2500);
  };

  const formatMB = (bytes: number) =>
    bytes >= 1024 ** 3
      ? `${(bytes / 1024 ** 3).toFixed(1)} ג"ב`
      : `${Math.round(bytes / 1024 ** 2)} מ"ב`;

  const loadCloud = async () => {
    setCloudBusy(true);
    setCloudError('');
    setCloudStatus('טוען מהענן…');
    try {
      setCloudEvents(await listCloudEvents());
    } catch (e) {
      setCloudEvents([]);
      setCloudError(
        e instanceof CloudArchiveError ? e.message : 'שגיאה בקריאה מהענן',
      );
    } finally {
      setCloudBusy(false);
      setCloudStatus('');
    }
  };

  /**
   * מוריד אירוע שלם מהענן כ-ZIP.
   *
   * **הבתים עוברים דרך זיכרון הדפדפן**, ולכן אירוע גדול על אייפד עלול להפיל
   * את הטאב. `splitBySize` הקיים חותך לחלקים, והאזהרה למטה מכוונת את הפעולה
   * למחשב — שם ממילא נוח יותר לשלוח לזוג.
   */
  const downloadCloudEvent = async (ev: CloudEvent) => {
    if (IS_IOS && ev.totalBytes > 400 * 1024 * 1024) {
      flash('אירוע גדול — עדיף להוריד מהמחשב');
    }
    setCloudBusy(true);
    setCloudError('');
    try {
      const entries: { name: string; blob: Blob }[] = [];
      for (let i = 0; i < ev.files.length; i++) {
        setCloudStatus(`מוריד ${i + 1} מתוך ${ev.files.length}…`);
        const raw = await downloadCloudFile(ev.files[i]);
        // אותו תיקון כמו בייצוא מהמכשיר — ראו `repairSampleDurations`
        const rep = await repairSampleDurations(raw);
        entries.push({ name: ev.files[i].name, blob: rep.blob });
      }
      const parts = splitBySize(entries, ZIP_PART_MAX_BYTES);
      /**
       * `safeName` מסנן ל-ASCII, ולכן «אלעד ושיר» הפך למחרוזת ריקה והארכיון
       * ירד בשם `soloTalk_event` - אי אפשר לדעת של איזה זוג הוא. שומרים
       * עברית בשם הארכיון, בדיוק כמו בייצוא מהמכשיר.
       */
      const label = (ev.coupleName || '')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 40);
      const base = `soloTalk_${label || 'event'}${ev.date ? `_${ev.date.replace(/\./g, '-')}` : ''}`;
      for (let i = 0; i < parts.length; i++) {
        const zip = await buildZip(parts[i], (pr) => {
          const pct = pr.totalBytes
            ? Math.min(99, Math.floor((pr.bytes / pr.totalBytes) * 100))
            : 0;
          setCloudStatus(
            parts.length > 1
              ? `אורז חלק ${i + 1} מתוך ${parts.length} · ${pct}%`
              : `אורז · ${pct}%`,
          );
        });
        download(
          zip,
          parts.length > 1 ? `${base}_part${i + 1}of${parts.length}.zip` : `${base}.zip`,
        );
        await new Promise((r) => setTimeout(r, 600));
      }
      flash(`הורדו ${ev.files.length} סרטונים ✓`);
    } catch (e) {
      const msg = e instanceof CloudArchiveError ? e.message : 'האריזה נכשלה';
      if (msg.includes('CORS')) setZipAvailable(false);
      setCloudError(msg);
    } finally {
      setCloudBusy(false);
      setCloudStatus('');
    }
  };

  const confirmCloudDelete = async (ev: CloudEvent) => {
    setCloudDeleteTarget(null);
    setCloudBusy(true);
    try {
      await deleteCloudEvent(ev);
      flash('נמחק מהענן ✓');
      await loadCloud();
    } catch {
      setCloudError('המחיקה נכשלה');
    } finally {
      setCloudBusy(false);
    }
  };

  const onLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const url = await downscaleImage(file, { maxDim: 600, mime: 'image/png' });
        setDraft((d) => ({ ...d, logoDataUrl: url }));
        flash('לוגו נטען — לחצו "שמור"');
      } catch {
        flash('שגיאה בטעינת הלוגו');
      }
    }
    e.target.value = '';
  };

  const onCoupleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const url = await downscaleImage(file, {
          maxDim: 1000,
          mime: 'image/jpeg',
          quality: 0.85,
        });
        setDraft((d) => ({ ...d, couplePhotoDataUrl: url }));
        flash('תמונת זוג נטענה — לחצו "שמור"');
      } catch {
        flash('שגיאה בטעינת התמונה');
      }
    }
    e.target.value = '';
  };

  const persistConfig = async (next: AppConfig, msg: string) => {
    setDraft(next);
    try {
      await saveConfig(next);
      onSave(next);
      flash(msg);
    } catch {
      onSave(next);
      flash('נשמר לשימוש מיידי, אך השמירה הקבועה נכשלה — נסו תמונה קטנה יותר');
    }
  };

  const save = async () => {
    await persistConfig(draft, 'נשמר ✓');
  };


  const doStartEvent = () => {
    const name = draft.eventName.trim();
    const date = (draft.eventDate ?? '').trim();
    setConfirmStart(false);
    persistConfig(
      { ...draft, activeEvent: startEvent(name, date, draft.eventType ?? 'wedding') },
      `אירוע "${name}" התחיל 🎬`,
    );
  };

  /**
   * פתיחת אירוע, דרך הצ'קליסט.
   *
   * שמות+תאריך **חוסמים** (הכפתור מושבת בלעדיהם). בדיקת המצלמה רק **מזהירה**:
   * גייט קשיח היה תוקע את העובד בדיוק כשאורחים מחכים — למשל אם הבדיקה נכשלת
   * רגעית — וזה גרוע מהבעיה שהוא בא למנוע.
   */
  const handleStartEvent = () => {
    const name = draft.eventName.trim();
    const date = (draft.eventDate ?? '').trim();
    if (!name || !date) {
      flash('צריך למלא שמות ותאריך כדי להתחיל אירוע');
      return;
    }
    if (cameraCheck.state !== 'ok') {
      setConfirmStart(true);
      return;
    }
    doStartEvent();
  };

  const confirmEndEvent = () => {
    // מנקים שמות+תאריך בסיום — כדי שהאירוע הבא יחייב הזנה מחדש (השדות ריקים
    // וכפתור "התחל אירוע חדש" מושבת עד שממלאים אותם שוב).
    // האירוע עצמו **נשמר בהיסטוריה** ולא נמחק, כדי שאפשר יהיה לחזור אליו.
    persistConfig(
      {
        ...draft,
        activeEvent: null,
        pastEvents: draft.activeEvent
          ? pushPastEvent(draft.pastEvents, draft.activeEvent)
          : draft.pastEvents,
        eventName: '',
        eventDate: '',
        // כמו התמונה למטה: שם התינוק של האירוע הקודם אסור שיופיע באירוע הבא
        babyName: '',
        /**
         * ⚠️ **גם התמונה.**
         *
         * בלי זה תמונת הזוג הקודם נשארת, ומופיעה במסך הפתיחה של האירוע
         * הבא — כלומר אורחים של זוג אחד רואים את התמונה של זוג אחר.
         * השמות והתאריך כבר התאפסו כאן; התמונה פשוט נשכחה.
         */
        couplePhotoDataUrl: undefined,
      },
      'האירוע הסתיים ✓ — אפשר לחזור אליו מהרשימה',
    );
    setShowEndModal(false);
  };

  /**
   * חוזר לאירוע שהסתיים. משחזר את **אותו `id`**, ולכן הקלטות חדשות ממשיכות
   * לאותה תיקיית ענן של האירוע המקורי.
   */
  const reopenEvent = (event: ActiveEvent) => {
    persistConfig(
      {
        ...draft,
        activeEvent: event,
        pastEvents: (draft.pastEvents ?? []).filter((e) => e.id !== event.id),
        eventName: event.name,
        eventDate: event.date,
        // אירוע שנפתח לפני שהיה סוג אירוע = חתונה
        eventType: event.type ?? 'wedding',
      },
      `חזרת לאירוע "${event.name}" 🎬`,
    );
  };

  /**
   * מסיר אירוע מהמכשיר: הערך בהיסטוריה **וגם** ההקלטות המקומיות שלו.
   *
   * למה שניהם: `recoverableEvents` נגזר גם מ-`meta.eventId` של ההקלטות, ולכן
   * מחיקת הערך בלבד הייתה מחזירה את האירוע לרשימה מיד. מעבר לכך, מה שתופס
   * מקום אמיתי הוא ההקלטות — הערך עצמו הוא כמה עשרות בתים.
   *
   * **הענן לא נוגע.** Firebase הוא שכבת הגיבוי; מחיקה מקומית לא משמידה אותה.
   */
  const deleteEventFromDevice = async (event: ActiveEvent) => {
    const ids = recordings
      .filter((r) => r.meta.eventId === event.id)
      .map((r) => r.id);
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      await recordingStore.delete(id);
    }
    persistConfig(
      {
        ...draft,
        pastEvents: (draft.pastEvents ?? []).filter((e) => e.id !== event.id),
      },
      `"${event.name}" הוסר מהמכשיר${ids.length ? ` (${ids.length} הקלטות)` : ''}`,
    );
    refreshRecordings();
    setDeleteTarget(null);
  };

  /**
   * בודק מצלמה ומיקרופון לפני האירוע.
   *
   * זו הנקודה החשובה: **אין אישור קבוע לדף אינטרנט** — אבל ההרשאה מחזיקה
   * לאורך טעינת הדף. לחיצה אחת כאן בתחילת הערב מקפיצה את חלונית iOS פעם
   * אחת, וכל האורחים אחריה לא יראו אותה בכלל.
   */
  const runCameraCheck = async () => {
    setCameraCheck({ state: 'checking' });
    const problem = await checkCameraAccess();
    setCameraCheck(
      problem
        ? { state: 'fail', info: problem }
        : { state: 'ok' },
    );
  };

  const triggerUpload = () => {
    flash(
      navigator.onLine === false
        ? 'אין חיבור לאינטרנט — יעלה אוטומטית כשהרשת תחזור'
        : 'מעלה לענן…',
    );
    void processQueue();
  };

  const downloadTemplate = () => {
    download(
      new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' }),
      'soloTalk_questions_template.csv',
    );
  };

  const onCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = csvToQuestions(await file.text());
      if (!parsed.length) {
        flash('לא נמצאו שאלות בקובץ — ודאו שהוא נשמר כ-CSV UTF-8');
      } else {
        setDraft((d) => ({
          ...d,
          customQuestions: parsed,
          useCustomQuestions: true,
        }));
        flash(`יובאו ${parsed.length} שאלות — לחצו "שמור"`);
      }
    } catch {
      flash('שגיאה בקריאת הקובץ — ודאו שהוא בפורמט CSV');
    }
    if (csvRef.current) csvRef.current.value = '';
  };

  const restoreGeneric = () => {
    setDraft((d) => ({ ...d, genericQuestions: DEFAULT_GENERIC }));
    flash('בנק השאלות שוחזר לברירת המחדל');
  };

  const setGeneric = (genericQuestions: Question[]) =>
    setDraft((d) => ({ ...d, genericQuestions }));
  const setCustom = (customQuestions: Question[]) =>
    setDraft((d) => ({ ...d, customQuestions }));
  const setHardcore = (hardcoreQuestions: Question[]) =>
    setDraft((d) => ({ ...d, hardcoreQuestions }));

  const downloadRecording = async (rec: RecordingInfo) => {
    const blob = await recordingStore.get(rec.id);
    if (!blob) return;
    // הורדה בודדת — אין הקשר של רשימה, ולכן משתמשים בשעה כמזהה ייחודי
    download(blob, filenameFor(rec, new Date(rec.meta.timestamp).getMinutes()));
  };

  const deleteRecording = async (id: string) => {
    await recordingStore.delete(id);
    refreshRecordings();
  };

  /**
   * אורז את הקלטות האירוע לארכיוני ZIP.
   *
   * **מסונן לאירוע הפעיל.** חזרה לאירוע נועדה בדיוק כדי למשוך את הסרטונים
   * שלו שוב — ארכיון שמכיל גם סרטונים מאירועים אחרים הוא לא גיבוי, הוא בלגן.
   * בלי אירוע פעיל אין למה לסנן, ואז נארז כל מה שבמכשיר.
   *
   * הסינון מכוון ל-`activeEvent` ולא לתצוגה: גיבוי צריך להיות צפוי, ולא
   * להשתנות לפי מתג "הצג אירועים קודמים" שמישהו שכח פתוח.
   *
   * למה ZIP: קודם כל קובץ הורד בנפרד — 25 הקלטות = 25 דיאלוגים ב-iOS, וגם
   * שיתוף של 25 קבצים בבת אחת נכשל בתוסף של Drive. פריט אחד עובד.
   */
  const buildArchives = async (): Promise<File[] | null> => {
    // עוצר את מעלה-הרקע לכל אורך האריזה — שניהם קוראים את אותם blobs
    setExportActive(true);
    try {
      return await buildArchivesInner();
    } finally {
      setExportActive(false);
      setStatus('');
    }
  };

  const buildArchivesInner = async (): Promise<File[] | null> => {
    const source =
      activeEvent && !ignoreEventFilter
        ? recordings.filter((r) => r.meta.eventId === activeEvent.id)
        : recordings;
    if (source.length === 0) return null;
    const entries: { name: string; blob: Blob; modified: number }[] = [];
    /**
     * הקלטות שלא ניתן היה לקרוא מהמכשיר.
     *
     * ⚠️ **קודם הן פשוט דולגו בשקט** — `if (blob)` בלי `else`. המפעיל היה
     * מקבל ארכיון עם 5 סרטונים במקום 6 ולא היה לו שום סימן שמשהו חסר,
     * ולא איזה סרטון. זה בדיוק סוג הכשל שמגלים חודש אחרי האירוע.
     */
    const unreadable: string[] = [];
    /** כמה משכים פגומים תוקנו — מדווח למפעיל בסיום */
    let repaired = 0;
    for (const rec of source) {
      /**
       * ⚠️ החלק הזה היה **שקט לחלוטין**, והוא הארוך ביותר: קריאת אירוע
       * מלא מ-IndexedDB היא כ-1.7 ג"ב. המפעיל לחץ «ייצוא» וראה מסך קפוא
       * עשרות שניות לפני שהופיע «אורז חלק 1», והסיק שהאפליקציה נתקעה.
       */
      setStatus(`קורא סרטון ${entries.length + 1} מתוך ${source.length}…`);
      let blob: Blob | undefined;
      try {
        // eslint-disable-next-line no-await-in-loop
        blob = await recordingStore.get(rec.id);
      } catch (e) {
        console.error('קריאת הקלטה נכשלה', rec.id, e);
      }
      if (blob && blob.size > 0) {
        /**
         * מתקן משך דגימה פגום לפני האריזה.
         *
         * ספארי פולט לעיתים דגימה אחת עם `0xFFFFFFFF`, ואז הנגן מציג
         * **1,988 שעות** במקום 4:58. הסריקה קוראת רק את קופסאות ה-`moof`
         * ולכן היא זולה (נמדד 65ms על קובץ של 281 מ"ב), והתוצאה נבנית
         * מ-slices ולכן אינה מעתיקה את הווידאו.
         */
        const rep = await repairSampleDurations(blob);
        if (rep.fixed > 0) repaired += rep.fixed;
        entries.push({
          name: filenameFor(rec, entries.length),
          blob: rep.blob,
          modified: rec.meta.timestamp,
        });
      } else {
        unreadable.push(
          `${rec.meta.relationship.join(', ') || 'הקלטה'} · ${new Date(
            rec.meta.timestamp,
          ).toLocaleTimeString('he-IL')}`,
        );
      }
    }

    if (unreadable.length) {
      // חוסם בכוונה: ארכיון חסר שנשלח לזוג הוא נזק בלתי הפיך
      setExportWarning(unreadable);
    }
    if (entries.length === 0) return null;
    if (repaired > 0) console.info(`[export] תוקנו ${repaired} משכי דגימה פגומים`);

    const groups = splitBySize(entries, ZIP_PART_MAX_BYTES);
    // שם האירוע בעברית נמחק בסינון ה-ASCII, ולכן החותמת כוללת גם שעה —
    // אחרת שני אירועים באותו יום היו מקבלים בדיוק אותו שם ארכיון.
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
    /**
     * שם הזוג בשם הארכיון.
     *
     * `safeName` מסנן ל-ASCII, ולכן שם עברי נמחק לגמרי והארכיונים יצאו
     * `soloTalk_<תאריך>` בלבד - אי אפשר לדעת איזה ארכיון שייך לאיזה זוג
     * כשיש כמה אירועים בתיקיית ההורדות. לכן משאירים גם עברית בשם הארכיון
     * (שמות הקבצים **בתוכו** נשארים ASCII).
     */
    const rawName = (draft.activeEvent?.name ?? draft.eventName ?? '').trim();
    const eventLabel = rawName
      .replace(/[\\/:*?"<>|]+/g, '_')  // תווים אסורים בשמות קבצים
      .replace(/\s+/g, '_')
      .slice(0, 40);
    const base = `soloTalk_${eventLabel ? `${eventLabel}_` : ''}${stamp}`;
    const files: File[] = [];
    for (let i = 0; i < groups.length; i++) {
      const label =
        groups.length > 1 ? `${base}__חלק_${i + 1}_מתוך_${groups.length}` : base;
      // eslint-disable-next-line no-await-in-loop
      const zip = await buildZip(groups[i], (pr) => {
        /**
         * קודם הוצג «אורז חלק 3/4 — 3/4»: שני מספרים זהים שמשמעותם שונה
         * לגמרי (חלק מתוך סך החלקים, מול סרטון מתוך סרטוני החלק). אי אפשר
         * היה לדעת מה מתקדם. עכשיו: מילים לחלק, ואחוז **רציף** שזז גם
         * באמצע סרטון של 280 מ"ב.
         */
        const pct = pr.totalBytes
          ? Math.min(99, Math.floor((pr.bytes / pr.totalBytes) * 100))
          : 0;
        const partLabel =
          groups.length > 1 ? `אורז חלק ${i + 1} מתוך ${groups.length}` : 'אורז';
        setStatus(`${partLabel} · ${pct}% · סרטון ${Math.min(pr.done + 1, pr.total)}/${pr.total}`);
      });
      files.push(new File([zip], `${label}.zip`, { type: 'application/zip' }));
    }
    setStatus('');
    return files;
  };

  /** כמה הקלטות ייכללו בייצוא — מוצג בתווית כדי שלא יהיה ספק מה נארז */
  const exportCount = draft.activeEvent
    ? recordings.filter((r) => r.meta.eventId === draft.activeEvent!.id).length
    : recordings.length;

  /**
   * הקלטות שקיימות במכשיר אך **לא** ייכללו בייצוא, כי הן שייכות לאירוע אחר.
   *
   * למה זה מוצג: הסינון לאירוע הפעיל היה שקט לגמרי, ולכן מצב שבו האירוע
   * הפעיל לא תואם להקלטות נראה כמו «הייצוא מאבד סרטונים». עדיף להגיד
   * במפורש כמה נשארו בחוץ ולתת דרך לייצא הכל בכל זאת.
   */
  const excludedCount = recordings.length - exportCount;
  /** מייצא את **כל** מה שבמכשיר, בלי סינון לאירוע */
  const [ignoreEventFilter, setIgnoreEventFilter] = useState(false);

  const exportAll = async () => {
    try {
      const files = await buildArchives();
      if (!files) return flash('אין הקלטות לייצוא');
      await downloadAll(files);
      flash(
        `הורדו ${files.length} ארכיונים · ${exportCount} סרטונים${
          activeEvent ? ` מ"${activeEvent.name}"` : ''
        }`,
      );
    } catch (e) {
      console.error('zip export failed', e);
      flash(e instanceof Error ? e.message : 'האריזה נכשלה');
    }
  };

  // שכבה 2: ייצוא דרך share sheet של iOS (שמירה ל-Drive/USB/AirDrop)
  const shareAllRecordings = async () => {
    let files: File[] | null;
    try {
      files = await buildArchives();
    } catch (e) {
      console.error('zip export failed', e);
      return flash(e instanceof Error ? e.message : 'האריזה נכשלה');
    }
    if (!files) return flash('אין הקלטות לייצוא');

    const nav = navigator as Navigator & {
      canShare?: (d: { files: File[] }) => boolean;
    };
    if (nav.canShare && nav.canShare({ files })) {
      try {
        // ⚠️ בלי `title`. iOS הופך אותו ל**קובץ טקסט נפרד** בשיתוף, וכך
        // נחת «הקלטות.txt» מסתורי בדרייב לצד הארכיונים.
        await navigator.share({ files });
      } catch {
        /* המשתמש ביטל */
      }
    } else {
      flash('שיתוף קבצים לא נתמך כאן — מוריד במקום');
      await downloadAll(files);
    }
  };

  /**
   * מעתיק את קישורי ההורדה הישירים מהענן.
   * לשימוש המפעיל — לא הערוץ למסירה לזוג: תעבורת Firebase מוגבלת ויקרה,
   * והמסירה עוברת דרך תיקיית Drive משותפת (ראו README).
   */
  const copyCloudLinks = async () => {
    const withUrl = recordings.filter((r) => r.remoteUrl);
    if (withUrl.length === 0) {
      flash('אין עדיין קישורי ענן — ההעלאה טרם הסתיימה');
      return;
    }
    const text = withUrl
      .map((r, i) => `${filenameFor(r, i)}\n${r.remoteUrl}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      flash(`הועתקו ${withUrl.length} קישורים`);
    } catch {
      flash('ההעתקה נכשלה — יש לאשר גישה ללוח');
    }
  };

  const failedCount = recordings.filter(
    (r) => r.uploadStatus === 'failed',
  ).length;

  // ספירות ומשך מיוחדים לאירוע הפעיל
  const activeEvent = draft.activeEvent;
  // הסוג בפועל: האירוע הפעיל גובר על הבורר, בדיוק כמו אצל האורחים
  const eventType = eventTypeOf(draft);
  const brit = isBritType(eventType);
  const eventTypeLabel =
    EVENT_TYPE_OPTIONS.find((o) => o.value === eventType)?.label ?? '';
  // כל מסלול שומר כמות שאלות משלו, כך שכוונון לברית לא משנה את החתונות
  const depthKey = brit ? 'britDepthSettings' : 'depthSettings';
  const depthDefaults = brit ? DEFAULT_BRIT_DEPTH_SETTINGS : DEFAULT_DEPTH_SETTINGS;
  const depthNow = { ...depthDefaults, ...(draft[depthKey] ?? {}) };
  const setDepth = (patch: Partial<DepthSettings>) =>
    setDraft((d) => ({
      ...d,
      [depthKey]: { ...depthDefaults, ...(d[depthKey] ?? {}), ...patch },
    }));
  const captureDiag = getCaptureDiagnostics();
  const recProgress = getRecordingProgress();
  // כל האירועים שהמכשיר מכיר: ההיסטוריה השמורה ממוזגת עם אירועים שנגזרים
  // מההקלטות — כך אירוע ניתן לשחזור גם אם הקונפיג אבד. האירוע הפעיל נכלל
  // ומוצג בראש, מסומן, כדי שהרשימה תשקף את המצב האמיתי במכשיר.
  const archiveList = recoverableEvents(
    [
      ...(activeEvent ? [activeEvent] : []),
      ...(draft.pastEvents ?? []),
    ],
    recordings,
  );
  const eventRecs = activeEvent
    ? recordings.filter((r) => r.meta.eventId === activeEvent.id)
    : [];
  const eventTotal = eventRecs.length;
  const eventUploaded = eventRecs.filter(
    (r) => r.uploadStatus === 'uploaded',
  ).length;
  const eventAllBackedUp = eventTotal > 0 && eventUploaded === eventTotal;
  const eventDurationMs = activeEvent ? now - activeEvent.startedAt : 0;

  // כרטיס הגיבוי הראשי — מתייחס לאירוע הפעיל אם יש, אחרת לכל ההקלטות
  const heroTotal = activeEvent ? eventTotal : recordings.length;
  const heroUploaded = activeEvent
    ? eventUploaded
    : recordings.filter((r) => r.uploadStatus === 'uploaded').length;
  const heroAllUp = heroTotal > 0 && heroUploaded === heroTotal;

  // רשימת הקלטות: כברירת מחדל רק האירוע הנוכחי (לא מציגים אירועים קודמים)
  const visibleRecordings =
    activeEvent && !showPrevEvents ? eventRecs : recordings;
  // הקלטות מאירועים קודמים שעדיין לא גובו לענן — רק אלה רלוונטיות להצגה.
  // אם הכל מאירועים קודמים כבר בענן, אין צורך להציג אותן (מוסתר, פחות עומס).
  const prevPending = activeEvent
    ? recordings.filter(
        (r) => r.meta.eventId !== activeEvent.id && r.uploadStatus !== 'uploaded',
      ).length
    : 0;
  const visUploaded = visibleRecordings.filter(
    (r) => r.uploadStatus === 'uploaded',
  ).length;
  const visAllBackedUp =
    visibleRecordings.length > 0 && visUploaded === visibleRecordings.length;
  const visTotalMB = (
    visibleRecordings.reduce((s, r) => s + r.size, 0) /
    (1024 * 1024)
  ).toFixed(1);
  const uploadErr = getLastUploadError();

  /**
   * צ'קליסט פתיחת האירוע.
   *
   * **מנחה, לא כולא.** רק השורה הראשונה חוסמת בפועל (הכפתור מושבת בלעדיה);
   * השאר מסמנות ✓ ומקשרות למסך שבו מטפלים בהן. עובד שממהר חייב להיות מסוגל
   * להתקדם — אירוע תקוע כשהאורחים מחכים גרוע מכל פריט שלא סומן.
   */
  const checklist: {
    done: boolean;
    label: string;
    hint: string;
    blocking?: boolean;
  }[] = [
    {
      done: !!draft.eventName.trim() && !!(draft.eventDate ?? '').trim(),
      label: brit ? 'שם המשפחה ותאריך האירוע' : 'שמות הזוג ותאריך האירוע',
      hint: 'חובה — בלי זה לא ניתן לפתוח אירוע',
      blocking: true,
    },
    {
      done: cameraCheck.state === 'ok',
      label: 'בדיקת מצלמה ומיקרופון',
      hint: 'מקפיצה את חלונית ההרשאה פעם אחת, כדי שאף אורח לא ייתקל בה',
    },
  ];
  const checkDone = checklist.filter((c) => c.done).length;

  return (
    <div className="admin">
      <div className="admin-topbar">
        <button className="btn" onClick={save}>
          שמור
        </button>
        <button className="btn secondary" onClick={onExit}>
          יציאה
        </button>
        {status && <span className="step-hint">{status}</span>}
      </div>

      <div className="admin-shell">
        {/* תפריט צד: המיקום קבוע, ולכן שום דבר לא "נקבר" ככל שהדשבורד גדל */}
        <nav className="admin-nav" aria-label="ניווט בדשבורד">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`admin-nav-item ${nav === item.key ? 'active' : ''}`}
              aria-current={nav === item.key ? 'page' : undefined}
              onClick={() => goto(item.key)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}

          {/*
            גרסה — מתחת לפריט האחרון בתפריט.
            קיים כדי שאפשר יהיה לוודא **על האייפד עצמו** איזו גרסה רצה,
            בלי מחשב. חותמת הבנייה מבדילה בין שתי בניות של אותה גרסה,
            וזה בדיוק מה שהיה חסר כשלא היה ברור אם פריסה תפסה.
          */}
          {/*
            **חותמת הבנייה למעלה, הגרסה מתחת.**
            מספר הגרסה ידני ולכן עלול לפגר - וזה כבר קרה. החותמת משתנה
            בכל בנייה מעצמה, ולכן היא המזהה שמוכיח שפריסה תפסה.
          */}
          <div className="admin-version">
            <span className="build-id">בנייה {__BUILD_ID__}</span>
            v{__APP_VERSION__}
          </div>
        </nav>

        <div className="admin-body" ref={bodyRef}>

      {nav === 'main' && (
        <>
      {/* ---- צ'קליסט פתיחת אירוע (רק כשאין אירוע פעיל) ---- */}
      {!activeEvent && (
        <div className="admin-section start-checklist">
          <h2>
            לפני שפותחים אירוע
            <span className={`check-count ${checkDone === checklist.length ? 'ok' : ''}`}>
              {checkDone}/{checklist.length} ✓
            </span>
          </h2>
          <ol className="start-list">
            {checklist.map((item) => (
              <li key={item.label} className={item.done ? 'done' : ''}>
                <span className="start-mark">{item.done ? '✓' : '○'}</span>
                <span className="start-text">
                  <b>{item.label}</b>
                  {item.blocking && !item.done && (
                    <span className="start-required"> · חובה</span>
                  )}
                  <span className="meta">{item.hint}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ---- אירוע (התחלה/סיום) ---- */}
      <div className="admin-section">
        <h2>אירוע</h2>
        {activeEvent ? (
          <div className="event-banner">
            <div>
              <span className="live-dot" /> אירוע פעיל: <b>{activeEvent.name}</b>
              <span className="meta"> · {eventTypeLabel}</span>
              <div className="meta">
                {formatEventDate(activeEvent.date)} · התחיל{' '}
                {new Date(activeEvent.startedAt).toLocaleTimeString('he-IL', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                · פתוח {formatDuration(eventDurationMs)}
              </div>
              {/*
                ⚠️ **אסור להציג מספרים כשהקריאה נכשלה.** «0 סרטונים · 0/0 בענן»
                הוא בדיוק המסך שנראה כמו אובדן כל החומר, בזמן שההקלטות שלמות
                בדיסק. מספר שגוי על גיבוי מסוכן יותר מהיעדר מספר.
              */}
              <div className="meta event-stats">
                {recordingsError ? (
                  <span className="stat-warn">🎥 לא ניתן לקרוא כרגע — ראו למטה</span>
                ) : !recordingsLoaded ? (
                  <span>🎥 טוען…</span>
                ) : (
                  <>
                    🎥 {eventTotal} סרטונים
                    {isCloudConfigured() && (
                      <span className={eventAllBackedUp ? 'stat-ok' : 'stat-warn'}>
                        {' '}
                        · ☁️ {eventUploaded}/{eventTotal} בענן
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
            <button className="btn danger" onClick={() => setShowEndModal(true)}>
              ■ סיים אירוע
            </button>
            {/*
              שם התינוק/ת ניתן לעדכון **באמצע האירוע** — בברית הוא מוכרז רק
              בטקס, כשהעמדה כבר פתוחה. נשמר מיד, בלי לגעת במזהה האירוע.
            */}
            {brit && (
              <div className="field baby-name-field">
                <label>{eventType === 'brita' ? 'שם התינוקת' : 'שם התינוק'} (אחרי ההכרזה)</label>
                <div className="baby-name-row">
                  <input
                    value={draft.babyName ?? ''}
                    placeholder="יופיע במסך הפתיחה ובחותמת הסרטון"
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, babyName: e.target.value }))
                    }
                  />
                  <button
                    className="mini-btn"
                    onClick={() =>
                      persistConfig(
                        { ...draft, babyName: (draft.babyName ?? '').trim() },
                        'השם עודכן ✓',
                      )
                    }
                  >
                    עדכן שם
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <p className="step-hint" style={{ marginBottom: 12 }}>
              הגדירו שמות ותאריך כדי לפתוח את העמדה. עד שמתחילים אירוע — מסך
              הפתיחה סגור לאורחים.
            </p>
            <div className="field">
              <label>סוג האירוע</label>
              <div className="orientation-picker">
                {EVENT_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`orient-btn ${
                      (draft.eventType ?? 'wedding') === opt.value ? 'selected' : ''
                    }`}
                    onClick={() =>
                      setDraft((d) => ({ ...d, eventType: opt.value as EventType }))
                    }
                  >
                    <span className="orient-label">{opt.label}</span>
                    <span className="orient-hint">{opt.hint}</span>
                  </button>
                ))}
              </div>
              <span className="step-hint">
                קובע את מסך הפתיחה, את בחירת הקרבה ואת מאגר השאלות. ננעל
                כשהאירוע מתחיל.
              </span>
            </div>
            <div className="field">
              <label>{brit ? 'שם המשפחה *' : 'שמות החוגגים *'}</label>
              <input
                value={draft.eventName}
                // שם אחר מברירת המחדל בכוונה: כשהשניים היו זהים, שדה מלא
                // נראה בדיוק כמו שדה ריק.
                placeholder={brit ? 'למשל: משפחת כהן' : 'למשל: דנה & יוסי'}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, eventName: e.target.value }))
                }
              />
            </div>
            <div className="field">
              <label>תאריך האירוע *</label>
              <input
                type="date"
                value={
                  draft.eventDate
                    ? (() => {
                        const parts = draft.eventDate.split('/');
                        if (parts.length === 3) {
                          const [day, month, year] = parts;
                          return `${year}-${month}-${day}`;
                        }
                        return draft.eventDate;
                      })()
                    : ''
                }
                onChange={(e) => {
                  const isoDate = e.target.value;
                  if (isoDate) {
                    const [year, month, day] = isoDate.split('-');
                    const formatted = `${day}/${month}/${year}`;
                    setDraft((d) => ({ ...d, eventDate: formatted }));
                  } else {
                    setDraft((d) => ({ ...d, eventDate: '' }));
                  }
                }}
                style={{ direction: 'ltr' }}
              />
            </div>
            {brit && (
              <div className="field">
                <label>
                  {eventType === 'brita' ? 'שם התינוקת' : 'שם התינוק'} (לא חובה)
                </label>
                <input
                  value={draft.babyName ?? ''}
                  placeholder="אפשר להשאיר ריק ולהוסיף אחרי ההכרזה בטקס"
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, babyName: e.target.value }))
                  }
                />
                <span className="step-hint">
                  עד שממלאים — מסך הפתיחה מציג את שם המשפחה.
                </span>
              </div>
            )}
            <button
              className="btn"
              disabled={!draft.eventName.trim() || !(draft.eventDate ?? '').trim()}
              onClick={handleStartEvent}
            >
              ▶ התחל אירוע חדש
            </button>
          </>
        )}
      </div>

      {/* ---- מקום פנוי במכשיר ---- */}
      {storageInfo && (() => {
        const free = Math.max(0, storageInfo.quota - storageInfo.usage);
        const gb = (b: number) => (b / 1073741824).toFixed(2);
        /**
         * גודל הקלטה ממוצע — נמדד מההקלטות שבמכשיר, ולא מקובע.
         * נפילה ל-120 מ"ב כשאין עדיין הקלטות (נמדד בשדה: 117 מ"ב לממוצע).
         */
        /**
         * ⚠️ **רצפה של 60 מ"ב על הממוצע.**
         *
         * בלעדיה, מכשיר שיש בו רק הקלטת בדיקה קצרה נותן ממוצע זעיר
         * והמד הציג «מספיק לעוד 666,452 הקלטות» - מספר שמרגיע בדיוק
         * כשצריך להזהיר. 60 מ"ב הוא כמחצית מהממוצע שנמדד בשדה (117),
         * ולכן ההערכה נשארת שמרנית גם בהקלטות קצרות.
         */
        const measured =
          recordings.length > 0
            ? recordings.reduce((a, r) => a + r.size, 0) / recordings.length
            : 120 * 1024 * 1024;
        const avg = Math.max(measured, 60 * 1024 * 1024);
        const room = Math.floor(free / avg);
        const tight = room < 30;
        return (
          <div className={`admin-section storage-meter ${tight ? 'warn' : ''}`}>
            <h2>💾 מקום במכשיר</h2>
            <div className="meta">
              בשימוש <strong>{gb(storageInfo.usage)} ג"ב</strong> · פנוי{' '}
              <strong>{gb(free)} ג"ב</strong>
            </div>
            <div className="meta">
              {tight ? '⚠️ ' : '✓ '}
              מספיק לעוד <strong>~{room} הקלטות</strong> בקצב הנוכחי
              {tight && ' — מומלץ למחוק הקלטות שכבר גובו בענן'}
            </div>
          </div>
        );
      })()}

      {/* ---- בדיקת מצלמה לפני האירוע ---- */}
      <div className="admin-section camera-check">
        <h2>בדיקת מצלמה</h2>
        <p className="step-hint" style={{ marginBottom: 12 }}>
          להריץ פעם אחת בתחילת הערב. חלונית ההרשאה של iOS תקפוץ כאן — וכל
          האורחים אחריה לא יראו אותה. <b>אין אישור קבוע לדף אינטרנט</b>,
          וההרשאה מחזיקה עד לסגירת האפליקציה.
        </p>
        <div className="camera-check-row">
          <button
            className="btn"
            onClick={runCameraCheck}
            disabled={cameraCheck.state === 'checking'}
          >
            {cameraCheck.state === 'checking' ? 'בודק…' : '🎥 בדוק מצלמה'}
          </button>
          {cameraCheck.state === 'ok' && (
            <span className="camera-ok">✓ המצלמה והמיקרופון עובדים</span>
          )}
          {cameraCheck.state === 'fail' && (
            <span className="camera-fail">✗ {cameraCheck.info.message}</span>
          )}
        </div>
        {cameraCheck.state === 'fail' && cameraCheck.info.isPermission && (
          <p className="step-hint camera-settings-hint">
            אם החלונית לא קופצת — הגדרות → ספארי → מצלמה ומיקרופון → «אפשר»
          </p>
        )}

        {/* אבחון איכות: מה המצלמה באמת נותנת על המכשיר הזה. יושב כאן בכוונה —
            בודקים שהמצלמה עובדת, ומיד רואים מה היא מספקת בפועל. */}
        {captureDiag && (
          <div className="capture-diag">
            <div className="meta">
              מצלמה: <strong>{captureDiag.camera}</strong> · נצרב לקובץ:{' '}
              <strong>{captureDiag.canvas}</strong>
            </div>
            <div className="meta">
              {captureDiag.camera.startsWith('1080')
                ? '✓ המצלמה נותנת פורטרט מלא — אין חיתוך צדדים ואין מתיחה.'
                : 'המצלמה מחזירה לרוחב, ולכן הצדדים נחתכים. עדיין 1080p, אך פחות פיקסלים אמיתיים בפריים.'}
            </div>
          </div>
        )}

        {/*
          מד ההקלטה האחרונה. קיים בשביל מבחן העומס: ההקלטה נצברת בזיכרון,
          ואם הטאב נופל אין דרך לדעת מתי ובאיזה נפח. המד נכתב כל 10 שניות
          תוך כדי ההקלטה, ולכן הוא שורד קריסה ומספר איפה בדיוק היא קרתה.
        */}
        {recProgress && (
          <div className={`capture-diag ${recProgress.completed ? '' : 'rec-diag-warn'}`}>
            <div className="meta">
              הקלטה אחרונה: <strong>{formatDuration(recProgress.elapsedMs)}</strong> ·{' '}
              <strong>{formatMB(recProgress.bytes)}</strong> · {recProgress.chunks} מקטעים
            </div>
            <div className="meta">
              {recProgress.completed
                ? '✓ הסתיימה כשורה ונשמרה.'
                : '⚠️ לא הגיעה לסיום — הטאב כנראה נפל או ההקלטה נקטעה. זה הנפח שבו זה קרה.'}
            </div>
            {!recProgress.completed && (
              <FixHint
                steps={[
                  'בדקו ברשימת ההקלטות אם הקובץ נשמר בכל זאת — לרוב כן',
                  'לפני האורח הבא: סגרו את האפליקציה ופתחו מחדש, כדי לשחרר זיכרון',
                  'אם זה חוזר על הקלטות ארוכות — קצרו את זמן ההקלטה',
                ]}
              />
            )}
          </div>
        )}
      </div>

      {/* ארכיון שיצא חסר — חייב להיאמר, ולא להישאר בקונסול */}
      {exportWarning.length > 0 && (
        <div className="admin-section storage-read-error">
          <h2>⚠️ הארכיון יצא חסר</h2>
          <p className="step-hint">
            <b>{exportWarning.length} הקלטות לא נכללו</b> — לא הצלחנו לקרוא אותן
            מהמכשיר. אל תשלחו את הארכיון לזוג לפני שתבדקו אותן בארכיון הענן.
          </p>
          <FixHint
            steps={[
              'פתחו «ארכיון מנהל» ובדקו אם ההקלטות החסרות נמצאות בענן',
              'אם הן בענן — הורידו אותן משם, הארכיון שלכן תקין',
              'אם הן לא בענן — אל תמחקו את האירוע מהמכשיר בשום אופן',
              'נסו «ייצוא» שוב אחרי רענון הדף',
            ]}
          />
          <ul className="step-hint" style={{ marginTop: 8 }}>
            {exportWarning.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <button className="btn secondary" onClick={() => setExportWarning([])}>
            הבנתי
          </button>
        </div>
      )}

      {/* קריאת ההקלטות נכשלה — הדבר הכי חשוב להגיד, ובאדום */}
      {nav === 'main' && recordingsError && (
        <div className="admin-section storage-read-error">
          <h2>⚠️ לא הצלחנו לקרוא את ההקלטות</h2>
          <p className="step-hint">
            <b>ההקלטות שבמכשיר לא נמחקו.</b> {recordingsError}
          </p>
          <FixHint
            steps={[
              'לחצו «רענן» — ברוב המקרים זה נפתר מיד',
              'סגרו טאבים אחרים של האפליקציה — טאב נוסף חוסם את מסד הנתונים',
              'אם לא עזר: סגרו את האפליקציה לגמרי ופתחו מחדש',
              'אל תמחקו כלום ואל תסיימו את האירוע עד שהרשימה נטענת — ההקלטות במקומן',
            ]}
          />
          <button className="btn secondary" onClick={refreshRecordings}>
            ↻ נסה לקרוא שוב
          </button>
        </div>
      )}

      {/* ---- כרטיס גיבוי ענק (הדבר הכי חשוב לעובד) ---- */}
      {isCloudConfigured() &&
        !recordingsError &&
        recordingsLoaded &&
        (activeEvent || recordings.length > 0) && (
        <div
          className={`backup-hero ${
            heroAllUp ? 'safe' : heroTotal > heroUploaded ? 'warn' : ''
          }`}
        >
          <div className="hero-num">
            {heroUploaded}/{heroTotal}
          </div>
          <div className="hero-label">
            {heroTotal === 0
              ? 'אין עדיין סרטונים'
              : heroAllUp
                ? '✓ כל הסרטונים גובו בענן — אפשר לפרק בבטחה'
                : `עוד עולה לענן… (${heroTotal - heroUploaded} נותרו)`}
          </div>
          {heroTotal > heroUploaded && (
            <button className="btn" onClick={triggerUpload}>
              ⬆ העלה מה שנותר
            </button>
          )}
          {recordings.length > 0 && (
            <>
              {/* אף פעם לא לסנן בשקט: אם יש סרטונים שלא ייכללו, לומר את זה */}
              {excludedCount > 0 && (
                <div className="export-warn">
                  <b>
                    {exportCount === 0
                      ? `⚠️ אף סרטון לא ישוייך לאירוע הזה`
                      : `⚠️ ${excludedCount} סרטונים לא ייכללו`}
                  </b>
                  <div className="meta">
                    במכשיר יש {recordings.length} סרטונים, אבל רק {exportCount}{' '}
                    שייכים לאירוע "{activeEvent?.name}". השאר מאירועים אחרים.
                  </div>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={ignoreEventFilter}
                      onChange={(e) => setIgnoreEventFilter(e.target.checked)}
                    />
                    <span>ייצא את כל {recordings.length} הסרטונים שבמכשיר</span>
                  </label>
                </div>
              )}
              <div className="hero-actions">
                {heroUploaded > 0 && (
                  <button className="mini-btn" onClick={copyCloudLinks}>
                    📋 העתק את כל הקישורים
                  </button>
                )}
                <button className="mini-btn outline" onClick={shareAllRecordings}>
                  📤 ייצוא {ignoreEventFilter ? recordings.length : exportCount}{' '}
                  סרטונים (Drive/USB)
                </button>
              </div>
            </>
          )}
        </div>
      )}

        </>
      )}

      {/* ================== ארכיון ================== */}
      {nav === 'archive' && (
        <div className="admin-section">
          <div className="archive-launch">
            <button className="mini-btn outline" onClick={() => setArchiveStep('pin')}>
              🗂 ארכיון אירועים במכשיר
            </button>
            <span className="step-hint" style={{ margin: 0 }}>
              האירועים שצולמו כאן — חזרה לאירוע ומחיקה
            </span>
          </div>
        </div>
      )}

      {/* ================== הגדרות: שער קוד ================== */}
      {nav === 'settings' && !settingsUnlocked && (
        <div className="admin-section settings-gate">
          <PinScreen
            expectedPin={draft.managerPin ?? '0000'}
            onSuccess={() => setSettingsUnlocked(true)}
            onCancel={() => goto('main')}
            title="קוד הגדרות"
            subtitle="כאן משנים קודים ומוחקים מהענן לצמיתות"
          />
        </div>
      )}

      {/* ================== הגדרות: זהות המכשיר ================== */}
      {nav === 'settings' && settingsUnlocked && (
      <div className="admin-section">
        <h2>שם המכשיר הזה</h2>
        <p className="step-hint" style={{ marginBottom: 12 }}>
          לפי השם הזה תזהה את המכשיר ב<b>ארכיון המנהל</b>. למשל «iPad של roy».
          השם ניתן לשינוי בכל רגע ולא מפצל את התיקייה בענן.
        </p>
        <div className="field">
          <input
            value={draft.deviceName ?? ''}
            placeholder="למשל: iPad של roy"
            onChange={(e) =>
              setDraft((d) => ({ ...d, deviceName: e.target.value }))
            }
          />
        </div>
        {!(draft.deviceName ?? '').trim() && (
          <p className="step-hint">
            בלי שם, המכשיר יופיע בארכיון לפי המזהה שלו ({draft.deviceId}).
          </p>
        )}
      </div>
      )}

      {/* ================== שאלות: כמות לכל עומק ================== */}
      {nav === 'questions' && (
      <div className="admin-section">
        <h2>כמה שאלות בכל מסלול{brit ? ` — ${eventTypeLabel}` : ''}</h2>
        {brit ? (
          <p className="step-hint" style={{ marginBottom: 14 }}>
            כל אורח מתחיל ב«מי אתם בשבילי» ומסיים במסר האישי. ביניהם הוא מקבל
            שאלות <b>לפי סדר המאגר</b> — עתיד, איחול, טיפ להורים, טיפ לחיים.
            4 שאלות = אחת מכל נושא.
          </p>
        ) : (
          <p className="step-hint" style={{ marginBottom: 14 }}>
            באירוע הראשון חציון ההקלטות היה <b>44 שניות</b> ו-52% היו מתחת
            ל-45 שניות — האורחים עצרו הרבה לפני 8 שאלות. אפשר לכוונן כאן בין
            אירועים בלי גרסה חדשה.
          </p>
        )}
        <div className="depth-settings">
          <div className="field">
            <label>«כמה שאלות» — מספר השאלות</label>
            <input
              type="number"
              min={1}
              max={20}
              value={depthNow.fewCount}
              onChange={(e) =>
                setDepth({
                  fewCount: Math.max(1, Math.min(20, Number(e.target.value) || 1)),
                })
              }
            />
            <span className="step-hint">
              {brit
                ? 'הפתיחה והמסר הסוגר נוספים מעל המספר הזה'
                : 'הברכה הסוגרת נוספת מעל המספר הזה'}
            </span>
          </div>
          <div className="field">
            <label>«פריסטייל» — תקרת דקות</label>
            <input
              type="number"
              min={1}
              max={5}
              value={depthNow.freestyleMinutes}
              onChange={(e) =>
                setDepth({
                  freestyleMinutes: Math.max(1, Math.min(5, Number(e.target.value) || 1)),
                })
              }
            />
            <span className="step-hint">
              {brit
                ? 'בפריסטייל מוצגות עד 8 שאלות (שתיים מכל נושא). מקסימום 5 דקות.'
                : 'שם אין מכסת שאלות — הזמן הוא המגבלה. מקסימום 5 דקות.'}
            </span>
          </div>
        </div>
      </div>
      )}

      {/* ================== שאלות: מסלול ברית/בריתה ================== */}
      {nav === 'questions' && brit && (
      <div className="admin-section">
        <h2>שאלות — {eventTypeLabel}</h2>
        <p className="step-hint" style={{ marginBottom: 20 }}>
          השאלות כתובות <b>בקול של {eventType === 'brita' ? 'התינוקת' : 'התינוק'}</b>,
          ופונות לאורחים ברבים. כדי ששאלה תתאים גם לברית וגם לבריתה כותבים{' '}
          <span dir="ltr">{'{בן|בת}'}</span> — החלק הראשון מוצג בברית והשני
          בבריתה.
        </p>

        <div className="field">
          <label>השאלה הפותחת — תמיד ראשונה</label>
          <input
            value={draft.britIntroPrompt ?? ''}
            placeholder={DEFAULT_BRIT_INTRO}
            onChange={(e) =>
              setDraft((d) => ({ ...d, britIntroPrompt: e.target.value }))
            }
          />
          <p className="step-hint">
            אי אפשר להחליף אותה בזמן הצילום: מי שיצפה בסרטון בעוד שנים צריך
            לדעת מי מדבר אליו.
          </p>
        </div>

        <div className="field">
          <label>המסר הסוגר — תמיד אחרון</label>
          <input
            value={draft.britBlessingPrompt ?? ''}
            placeholder={DEFAULT_BRIT_BLESSING}
            onChange={(e) =>
              setDraft((d) => ({ ...d, britBlessingPrompt: e.target.value }))
            }
          />
          <p className="step-hint">
            במסלול «רק לברך» האורח מקבל רק את הפתיחה ואת המסר הזה.
          </p>
        </div>

        <div className="admin-toolbar" style={{ margin: '20px 0 4px' }}>
          <button
            className="mini-btn outline"
            onClick={() => setDraft((d) => ({ ...d, britQuestions: DEFAULT_BRIT }))}
          >
            ↺ שחזר מאגר ברירת מחדל
          </button>
        </div>
        <p className="step-hint" style={{ marginBottom: 8 }}>
          <b>סדר השורות הוא סדר ההופעה בסרטון.</b> שאלה חדשה נוספת לסוף,
          כלומר לנושא האחרון.
        </p>
        <QuestionEditor
          value={draft.britQuestions ?? []}
          onChange={(britQuestions) => setDraft((d) => ({ ...d, britQuestions }))}
          skipStats={draft.skipStats}
          relationships={BRIT_RELATIONSHIPS}
          labels={BRIT_RELATIONSHIP_LABELS}
        />
      </div>
      )}

      {/* ================== מסך פתיחה: מצב תצוגה ================== */}
      {nav === 'welcome' && (
      <div className="admin-section">
        <h2>מצב תצוגה</h2>
        <p className="step-hint" style={{ marginBottom: 12 }}>
          משפיע על מסכי האורח ועל הדשבורד. <b>מסך הצילום נשאר כהה תמיד</b> —
          שם הצילום עצמו הוא הרקע. גם הכיתוב הנצרב בסרטון לא משתנה.
        </p>
        <div className="orientation-picker">
          {DISPLAY_MODES.map((opt) => (
            <button
              key={opt.value}
              className={`orient-btn ${
                (draft.displayMode ?? 'dark') === opt.value ? 'selected' : ''
              }`}
              onClick={() =>
                // מוחל מיד על ה-root כדי שאפשר יהיה לראות את המצב לפני שמירה
                persistConfig(
                  { ...draft, displayMode: opt.value as DisplayMode },
                  `מצב ${opt.value === 'light' ? 'בהיר' : 'כהה'} ✓`,
                )
              }
            >
              <span className="orient-label">{opt.label}</span>
              <span className="orient-hint">{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>
      )}

      {/* ================== מסך פתיחה: עיצוב הסרטון ================== */}
      {nav === 'welcome' && (
      <div className="admin-section">
        <h2>🎬 עיצוב הסרטון</h2>
        <p className="step-hint burn-warn">
          ⚠️ <b>נצרב לתוך קובץ הווידאו ובלתי הפיך.</b> מה שמופיע כאן יופיע גם
          על המסך שהאורח רואה — זה אותו קנבס. סרטונים שכבר צולמו לא ישתנו.
        </p>

        <div className="video-style-row">
          <div className="video-style-controls">
            <div className="field">
              <label>מסגרת</label>
              <div className="frame-picker">
                {VIDEO_FRAME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`frame-btn ${
                      (draft.videoFrame ?? 'none') === opt.value ? 'selected' : ''
                    }`}
                    title={opt.hint}
                    onClick={() =>
                      persistConfig(
                        { ...draft, videoFrame: opt.value as VideoFrameStyle },
                        `מסגרת: ${opt.label} ✓`,
                      )
                    }
                  >
                    <span
                      className="frame-swatch"
                      style={
                        opt.swatch
                          ? { background: opt.swatch }
                          : { background: 'transparent' }
                      }
                      aria-hidden
                    >
                      {opt.value === 'none' ? '∅' : ''}
                    </span>
                    <span className="frame-label">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>שם הזוג + תאריך בסרטון</label>
              <div className="frame-picker">
                {VIDEO_STAMP_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`frame-btn ${
                      (draft.videoStamp ?? 'off') === opt.value ? 'selected' : ''
                    }`}
                    title={opt.hint}
                    onClick={() =>
                      persistConfig(
                        { ...draft, videoStamp: opt.value as VideoStampPos },
                        `חותמת: ${opt.label} ✓`,
                      )
                    }
                  >
                    <span className="frame-label">{opt.label}</span>
                  </button>
                ))}
              </div>
              <p className="step-hint">
                הגובה קבוע <b>מעל שורת הכפתורים</b> — שלוש הפינות התחתונות
                תפוסות על המסך, וחותמת מתחתן הייתה נחבאת מאחורי כפתור.
              </p>
            </div>
          </div>

          <div className="video-preview">
            <canvas ref={framePreviewRef} width={360} height={480} />
            <span className="meta">כך ייראה הסרטון</span>
          </div>
        </div>
      </div>
      )}

      {/* ================== הגדרות: שלושת הקודים ================== */}
      {nav === 'settings' && settingsUnlocked && (
      <div className="admin-section">
        <h2>קודי גישה</h2>
        <div className="field">
          <label>קוד ניהול (PIN) — לכניסה לדשבורד</label>
          <input
            inputMode="numeric"
            placeholder="למשל 1234 (ריק = ללא קוד)"
            value={draft.adminPin ?? ''}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                adminPin: e.target.value.replace(/\D/g, ''),
              }))
            }
          />
        </div>
        <div className="field">
          <label>קוד ארכיון המכשיר</label>
          <input
            inputMode="numeric"
            placeholder="0000"
            value={draft.eventsPin ?? ''}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                eventsPin: e.target.value.replace(/\D/g, ''),
              }))
            }
          />
        </div>
        <div className="field">
          <label>קוד ארכיון המנהל — כל המכשירים</label>
          <input
            inputMode="numeric"
            placeholder="0000"
            value={draft.managerPin ?? ''}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                managerPin: e.target.value.replace(/\D/g, ''),
              }))
            }
          />
          <p className="step-hint">
            הקוד הזה שומר גם על המסך הנוכחי. <b>אם תשכח אותו לא תוכל להיכנס
            להגדרות</b> — השחזור היחיד הוא מחיקת נתוני האתר במכשיר.
          </p>
        </div>
      </div>
      )}

      {/* ================== הגדרות: ארכיון המנהל (ענן) ================== */}
      {nav === 'settings' && settingsUnlocked && (
      <div className="admin-section">
        <h2>ארכיון אירועים - מנהל</h2>
        <p className="step-hint" style={{ marginBottom: 16 }}>
          כל האירועים מכל המכשירים, ישירות מהענן — עם הורדת ZIP לשליחה לזוג
          ומחיקה לצמיתות.
        </p>
        <button
          className="btn secondary"
          onClick={() => {
            setCloudStep('list');
            loadCloud();
          }}
        >
          ☁️ פתח את ארכיון המנהל
        </button>
      </div>
      )}

      {/* ================== מסך פתיחה: מיתוג ותוכן ================== */}
      {nav === 'welcome' && (
      <div className="admin-section">
        <h2>מסך הפתיחה</h2>

        <div className="upload-grid">
          <div className="field">
            <label>{brit ? 'תמונת התינוק/ת' : 'תמונת הזוג'} (מוצגת במרכז)</label>
            {draft.couplePhotoDataUrl && (
              <img
                src={draft.couplePhotoDataUrl}
                alt="תצוגת תמונת זוג"
                className="admin-preview couple"
              />
            )}
            <div className="admin-toolbar" style={{ marginBottom: 0 }}>
              <label className="mini-btn" style={{ cursor: 'pointer' }}>
                {draft.couplePhotoDataUrl ? 'החלפת תמונה' : 'העלאת תמונה'}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={onCoupleFile}
                />
              </label>
              {draft.couplePhotoDataUrl && (
                <button
                  className="mini-btn danger"
                  onClick={() =>
                    setDraft((d) => ({ ...d, couplePhotoDataUrl: undefined }))
                  }
                >
                  הסרה
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <label>לוגו (מומלץ PNG שקוף)</label>
            {draft.logoDataUrl && (
              <img
                src={draft.logoDataUrl}
                alt="תצוגת לוגו"
                className="admin-preview"
              />
            )}
            <div className="admin-toolbar" style={{ marginBottom: 0 }}>
              <label className="mini-btn" style={{ cursor: 'pointer' }}>
                {draft.logoDataUrl ? 'החלפת לוגו' : 'העלאת לוגו'}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={onLogoFile}
                />
              </label>
              {draft.logoDataUrl && (
                <button
                  className="mini-btn danger"
                  onClick={() =>
                    setDraft((d) => ({ ...d, logoDataUrl: undefined }))
                  }
                >
                  הסרה
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="field">
          <label>טקסט פתיחה</label>
          <textarea
            value={draft.welcomeText}
            onChange={(e) =>
              setDraft((d) => ({ ...d, welcomeText: e.target.value }))
            }
          />
        </div>
        <div className="field">
          <label>שניות עד איפוס אוטומטי (מסך תודה)</label>
          <input
            type="number"
            min={2}
            max={60}
            value={draft.autoResetSeconds}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                autoResetSeconds: Number(e.target.value) || 8,
              }))
            }
          />
        </div>
      </div>
      )}

      {/* ================== מסך פתיחה: כיוון העמדה ================== */}
      {nav === 'welcome' && (
      <div className="admin-section">
        <h2>כיוון העמדה</h2>
        <p className="step-hint" style={{ marginBottom: 12 }}>
          בוחרים לפי <b>מיקום המצלמה במכשיר</b>, כדי שהאורח יסתכל למצלמה בזמן
          שהוא קורא את השאלה. iOS לא מאפשר לכפות סיבוב מהאפליקציה — אם המכשיר
          לא בכיוון שנבחר, תוצג בקשה לסובב אותו.
        </p>
        <div className="orientation-picker">
          {ORIENTATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`orient-btn ${
                (draft.orientation ?? 'auto') === opt.value ? 'selected' : ''
              }`}
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  orientation: opt.value as StationOrientation,
                }))
              }
            >
              <span className="orient-label">{opt.label}</span>
              <span className="orient-hint">{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>
      )}

      {/* ================== שאלות (חתונה) ================== */}
      {nav === 'questions' && !brit && (
      <div className="admin-section">
        <h2>שאלות</h2>
        <p className="step-hint" style={{ marginBottom: 20 }}>
          לכל שאלה בוחרים למי היא מתאימה (לפי הקרבה שהאורח בוחר). העומק שהאורח בוחר
          קובע כמה שאלות יוצגו — הבחירה אקראית מבין המתאימות.
        </p>

        <div className="field">
          <label>טקסט למצב "רק לברך"</label>
          <input
            value={draft.blessingPrompt}
            onChange={(e) =>
              setDraft((d) => ({ ...d, blessingPrompt: e.target.value }))
            }
          />
          <p className="step-hint">
            זו גם <b>השאלה האחרונה של כל אורח</b>, בכל רמת עומק.
          </p>
        </div>

        <label className="checkbox-row" style={{ marginTop: 24 }}>
          <input
            type="checkbox"
            checked={draft.useCustomQuestions}
            onChange={(e) =>
              setDraft((d) => ({ ...d, useCustomQuestions: e.target.checked }))
            }
          />
          <span>שאלות מותאמות אישית</span>
        </label>
        {draft.useCustomQuestions && (
          <>
            <div className="csv-box">
              <p className="step-hint" style={{ margin: 0 }}>
                אפשר להעלות שאלות מקובץ CSV/אקסל. הורידו את התבנית, מלאו בעמודה
                "שאלה" את השאלות, וסמנו "כן" בעמודת הקרבה המתאימה. שמרו כ-CSV UTF-8
                והעלו.
              </p>
              <div className="admin-toolbar" style={{ margin: '12px 0 0' }}>
                <button className="mini-btn outline" onClick={downloadTemplate}>
                  ⬇ הורדת תבנית CSV
                </button>
                <label className="mini-btn" style={{ cursor: 'pointer' }}>
                  ⬆ העלאת CSV
                  <input
                    ref={csvRef}
                    type="file"
                    accept=".csv,text/csv"
                    style={{ display: 'none' }}
                    onChange={onCsvFile}
                  />
                </label>
              </div>
            </div>
            <QuestionEditor
              value={draft.customQuestions}
              onChange={setCustom}
              skipStats={draft.skipStats}
            />
          </>
        )}

        <label className="checkbox-row" style={{ marginTop: 24 }}>
          <input
            type="checkbox"
            checked={draft.useHardcoreQuestions ?? false}
            onChange={(e) =>
              setDraft((d) => ({ ...d, useHardcoreQuestions: e.target.checked }))
            }
          />
          <span>🌶️ שאלות ומשימות חריפות</span>
        </label>
        <p className="step-hint hardcore-warn">
          <b>כבוי כברירת מחדל בכוונה.</b> יש כאן פריטים שעלולים לפגוע — הודעות
          מבהילות לזוג, אקסים, כסף על מצלמה, ומשימות שמערבות אורחים שלא
          הסכימו להשתתף. הדליקו רק אם אתם מכירים את הקהל.
        </p>
        {draft.useHardcoreQuestions && (
          <QuestionEditor
            value={draft.hardcoreQuestions ?? []}
            onChange={setHardcore}
            skipStats={draft.skipStats}
          />
        )}

        {/* בנק השאלות המלא — מכווץ. הוא ארוך במאות שורות, ולכן פתוח כברירת
            מחדל היה קובר את כל מה שמעליו. */}
        <div className={`bank-block ${bankOpen ? 'open' : ''}`}>
          <button
            className="bank-toggle"
            onClick={() => setBankOpen((v) => !v)}
            aria-expanded={bankOpen}
          >
            <span>
              📚 כל השאלות מהבנק
              <span className="meta"> ({draft.genericQuestions.length})</span>
            </span>
            <span className="bank-chevron">{bankOpen ? '▲' : '▼'}</span>
          </button>

          {bankOpen && (
            <div className="bank-body">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={draft.useGenericQuestions}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      useGenericQuestions: e.target.checked,
                    }))
                  }
                />
                <span>הפעל את שאלות הבנק</span>
              </label>
              {draft.useGenericQuestions && (
                <>
                  <div className="admin-toolbar" style={{ margin: '8px 0 4px' }}>
                    <button className="mini-btn outline" onClick={restoreGeneric}>
                      ↺ שחזר בנק ברירת מחדל
                    </button>
                  </div>
                  <QuestionEditor
                    value={draft.genericQuestions}
                    onChange={setGeneric}
                    skipStats={draft.skipStats}
                  />
                </>
              )}
              {/* בלי זה, סגירת הרשימה מחייבת לגלול מאות שורות חזרה למעלה */}
              <button
                className="mini-btn outline bank-close"
                onClick={() => {
                  setBankOpen(false);
                  bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                ▲ סגור את הרשימה וחזור למעלה
              </button>
            </div>
          )}
        </div>
      </div>
      )}

      {/* ================== ארכיון: כל ההקלטות במכשיר ================== */}
      {nav === 'archive' && (
      <div className="admin-section">
        <h2>
          {activeEvent && !showPrevEvents ? 'הקלטות האירוע' : 'כל ההקלטות'} (
          {visibleRecordings.length}) · {visTotalMB}MB
        </h2>

        {/* פאנל גיבוי חי */}
        {visibleRecordings.length > 0 && (
          <div className={`backup-panel ${visAllBackedUp ? 'safe' : ''}`}>
            {isCloudConfigured() ? (
              <>
                <div className="backup-headline">
                  {visAllBackedUp
                    ? '✓ כל ההקלטות מגובות בענן'
                    : `גיבוי לענן: ${visUploaded}/${visibleRecordings.length}`}
                  {failedCount > 0 && ` · ${failedCount} נכשלו`}
                </div>
                <button className="mini-btn" onClick={triggerUpload}>
                  ⬆ העלה הכל עכשיו
                </button>
              </>
            ) : (
              <div className="backup-headline">
                גיבוי ענן לא מוגדר עדיין — ההקלטות שמורות על המכשיר. הגדירו Firebase
                כדי להפעיל גיבוי אוטומטי.
              </div>
            )}
          </div>
        )}

        {/* שגיאת העלאה אחרונה — לאבחון */}
        {isCloudConfigured() && failedCount > 0 && uploadErr && (
          <div className="upload-error">
            שגיאת העלאה: <code>{uploadErr}</code>
            <FixHint steps={uploadFixSteps(uploadErr)} />
          </div>
        )}

        {visibleRecordings.length > 0 && (
          <div className="admin-toolbar" style={{ marginBottom: 16 }}>
            <button className="mini-btn" onClick={shareAllRecordings}>
              📤 ייצוא {ignoreEventFilter ? recordings.length : exportCount} סרטונים (Drive/USB)
            </button>
            <button className="mini-btn outline" onClick={exportAll}>
              הורדת {ignoreEventFilter ? recordings.length : exportCount} סרטונים
            </button>
            <button className="mini-btn outline" onClick={refreshRecordings}>
              רענון
            </button>
          </div>
        )}

        {/* מעבר לאירועים קודמים — מוצג רק אם יש הקלטות ישנות שעדיין לא גובו
            (כשהכל מגובה אין צורך להראות אותן, פחות עומס על העובד). */}
        {activeEvent && (showPrevEvents || prevPending > 0) && (
          <button
            className={`mini-btn ${prevPending > 0 && !showPrevEvents ? 'warn' : 'outline'}`}
            style={{ marginBottom: 12 }}
            onClick={() => setShowPrevEvents((v) => !v)}
          >
            {showPrevEvents
              ? '↩ הצג רק את האירוע הנוכחי'
              : `⚠ ${prevPending} הקלטות מאירועים קודמים לא גובו — הצג`}
          </button>
        )}

        {visibleRecordings.length === 0 && (
          <p className="step-hint">עדיין אין הקלטות באירוע הזה</p>
        )}
        {visibleRecordings.map((rec) => {
          const badge = UPLOAD_BADGE[rec.uploadStatus ?? 'pending'];
          return (
            <div className="rec-row" key={rec.id}>
              <div>
                <div>
                  {rec.meta.relationship.join(', ') || 'ללא'}
                  {isCloudConfigured() && badge && (
                    <span className={`up-badge ${badge.cls}`}>{badge.label}</span>
                  )}
                </div>
                <div className="meta">
                  {DEPTH_LABELS[rec.meta.depth]} ·{' '}
                  {new Date(rec.meta.timestamp).toLocaleString('he-IL')} ·{' '}
                  {(rec.size / (1024 * 1024)).toFixed(1)}MB
                </div>
              </div>
              <div className="row-actions">
                {rec.remoteUrl && (
                  <a
                    className="mini-btn"
                    href={rec.remoteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ☁️ צפייה
                  </a>
                )}
                <button
                  className="mini-btn"
                  onClick={() => downloadRecording(rec)}
                >
                  הורדה
                </button>
                <button
                  className="mini-btn danger"
                  onClick={() => deleteRecording(rec.id)}
                >
                  מחיקה
                </button>
              </div>
            </div>
          );
        })}
      </div>
      )}

        </div>
      </div>

      {/* ---- אישור פתיחת אירוע כשהמצלמה לא נבדקה — מזהיר, לא חוסם ---- */}
      {confirmStart && (
        <div
          className="event-modal-overlay"
          onClick={() => setConfirmStart(false)}
        >
          <div className="event-modal" onClick={(e) => e.stopPropagation()}>
            <h2>המצלמה עדיין לא נבדקה</h2>
            <p className="step-hint">
              {cameraCheck.state === 'fail'
                ? `הבדיקה האחרונה נכשלה: ${cameraCheck.info.message}`
                : 'בדיקה אחת בתחילת הערב מקפיצה את חלונית ההרשאה כאן — כך אף אורח לא ייתקל בה באמצע צילום.'}
            </p>
            <div className="footer">
              <button
                className="btn"
                onClick={() => {
                  setConfirmStart(false);
                  void runCameraCheck();
                }}
              >
                🎥 בדוק עכשיו
              </button>
              <button className="btn secondary" onClick={doStartEvent}>
                התחל בכל זאת
              </button>
              <button
                className="btn secondary"
                onClick={() => setConfirmStart(false)}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- מודל סיום אירוע ---- */}
      {showEndModal && (
        <div
          className="event-modal-overlay"
          onClick={() => setShowEndModal(false)}
        >
          <div className="event-modal" onClick={(e) => e.stopPropagation()}>
            <h2>סיום אירוע</h2>

            {/* סיכום האירוע */}
            <div className="event-summary">
              <span>⏱ העמדה הייתה פתוחה {formatDuration(eventDurationMs)}</span>
              <span>🎥 צולמו {eventTotal} סרטונים</span>
              {isCloudConfigured() && (
                <span className={eventAllBackedUp ? 'stat-ok' : 'stat-warn'}>
                  ☁️ {eventUploaded}/{eventTotal} בענן
                </span>
              )}
            </div>

            <p className="step-hint">לפני שמסיימים — עברו על הצ׳קליסט:</p>

            <div className="checklist">
              <div className={`check-row ${eventAllBackedUp ? 'ok' : 'warn'}`}>
                <span>
                  {!isCloudConfigured()
                    ? '☁️ גיבוי ענן לא מוגדר — ודאו שהורדתם הכל'
                    : eventAllBackedUp
                      ? '✓ כל הסרטונים גובו בענן'
                      : `⚠️ עוד לא הכל עלה לענן — ${eventUploaded}/${eventTotal}`}
                </span>
                {isCloudConfigured() && !eventAllBackedUp && eventTotal > 0 && (
                  <button className="mini-btn" onClick={triggerUpload}>
                    העלה מה שנותר
                  </button>
                )}
              </div>

              <div className="check-row">
                <span>⬇️ הורדת גיבוי למכשיר (Drive/USB)</span>
                <button
                  className="mini-btn"
                  onClick={shareAllRecordings}
                  disabled={recordings.length === 0}
                >
                  הורד הכל
                </button>
              </div>

              <div className="check-row">
                <span>
                  🗑️ מחקו הקלטות מיותרות ברשימה למטה (רק אחרי שווידאתם שהכל גובה)
                </span>
              </div>
            </div>

            <p className="farewell">
              קחו את הציוד בזהירות, ונסיעה טובה הביתה 💛🚗
            </p>

            <div className="footer">
              <button className="btn danger" onClick={confirmEndEvent}>
                סיים אירוע
              </button>
              <button
                className="btn secondary"
                onClick={() => setShowEndModal(false)}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ארכיון המנהל כבר יושב מאחורי קוד ההגדרות — שער שני עם אותו קוד רק מעצבן */}
      {cloudStep === 'list' && (
        <div className="archive-overlay">
          <div className="archive-panel">
            <div className="archive-head">
              <h2>ארכיון אירועים - מנהל</h2>
              <div className="admin-toolbar">
                <button className="mini-btn" onClick={loadCloud} disabled={cloudBusy}>
                  ↻ רענן
                </button>
                <button className="mini-btn outline" onClick={() => setCloudStep(null)}>
                  סגירה
                </button>
              </div>
            </div>

            {cloudBusy && <p className="step-hint">{cloudStatus || 'טוען מהענן…'}</p>}
            {cloudError && (
              <>
                <p className="step-hint archive-warn">{cloudError}</p>
                <FixHint steps={cloudFixSteps(cloudError)} />
              </>
            )}
            {!cloudBusy && !cloudError && cloudEvents.length === 0 && (
              <div className="archive-empty">
                <span className="archive-empty-icon">☁️</span>
                <b>אין עדיין סרטונים בענן</b>
                <span className="meta">
                  כל סרטון שמצולם עולה לכאן אוטומטית בזמן האירוע.
                </span>
              </div>
            )}

            {cloudEvents.length > 0 && (
              <div className="cloud-summary">
                {cloudEvents.length} אירועים ·{' '}
                {cloudEvents.reduce((s, e) => s + e.files.length, 0)} סרטונים ·{' '}
                {formatMB(cloudEvents.reduce((s, e) => s + e.totalBytes, 0))}
              </div>
            )}

            {cloudEvents.map((ev) => (
              <div key={ev.id} className="archive-group">
                <div className="archive-card">
                  <span className="archive-icon">💍</span>
                  <div className="archive-info">
                    <div className="archive-name">{ev.coupleName}</div>
                    <div className="meta">
                      {ev.date && `${ev.date} · `}
                      {ev.files.length} סרטונים · {formatMB(ev.totalBytes)}
                    </div>
                  </div>
                  <div className="archive-actions">
                    <button
                      className="mini-btn outline"
                      onClick={() => void toggleEventFiles(ev)}
                    >
                      {openEvent === ev.id ? '▲ סגור' : `▾ הסרטונים (${ev.files.length})`}
                    </button>
                    <button
                      className="mini-btn"
                      disabled={cloudBusy || ev.files.length === 0 || !zipAvailable}
                      title={
                        zipAvailable
                          ? undefined
                          : 'דורש הגדרת CORS על ה-bucket ב-Firebase'
                      }
                      onClick={() => downloadCloudEvent(ev)}
                    >
                      ⬇ הורד ZIP
                    </button>
                    <button
                      className="mini-btn danger"
                      disabled={cloudBusy}
                      onClick={() => setCloudDeleteTarget(ev)}
                    >
                      🗑 מחק מהענן
                    </button>
                  </div>
                </div>

                {openEvent === ev.id && (
                  <div className="cloud-files">
                    {!eventUrls[ev.id] && <p className="step-hint">טוען קישורים…</p>}
                    {eventUrls[ev.id]?.map((url, i) => (
                      <a
                        key={ev.files[i].name}
                        className="cloud-file"
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span className="cloud-file-num">{i + 1}</span>
                        <span className="cloud-file-name">
                          {ev.files[i].name}
                          <span className="meta">
                            {formatMB(ev.files[i].size)} ·{' '}
                            {new Date(ev.files[i].createdAt).toLocaleString('he-IL')}
                          </span>
                        </span>
                        <span className="cloud-file-open">▶ פתח</span>
                      </a>
                    ))}
                    {eventUrls[ev.id] && (
                      <p className="step-hint cloud-files-hint">
                        לחיצה פותחת את הסרטון. לשמירה: תפריט השיתוף של הדפדפן →
                        «שמור וידאו». <b>עובד בלי CORS</b> — בניגוד לאריזת ה-ZIP.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* מחיקה מהענן היא בלתי הפיכה — לכן אישור מפורש, לא לחיצה אחת */}
      {cloudDeleteTarget && (
        <div className="event-modal-backdrop">
          <div className="event-modal">
            <h2>למחוק מהענן?</h2>
            <p className="step-hint">
              <b>{cloudDeleteTarget.coupleName}</b> · {cloudDeleteTarget.files.length}{' '}
              סרטונים
            </p>
            <ul className="checklist">
              <li>הסרטונים יימחקו מ-Firebase <b>לצמיתות</b></li>
              <li>אין דרך לשחזר אותם אחרי המחיקה</li>
              <li>הקלטות ששמורות מקומית במכשיר לא ייגעו</li>
            </ul>
            <div className="admin-toolbar">
              <button
                className="btn danger"
                onClick={() => confirmCloudDelete(cloudDeleteTarget)}
              >
                מחק לצמיתות
              </button>
              <button
                className="btn secondary"
                onClick={() => setCloudDeleteTarget(null)}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {archiveStep === 'pin' && (
        <div className="archive-overlay">
          {/*
            חובה להעביר כותרת. בלעדיה המסך נפל לברירת המחדל של PinScreen
            («קוד מנהל» + «כדי להיכנס להגדרות») — שתי שורות שקריות כאן: השער
            מצפה ל-`eventsPin` ולא ל-`adminPin`, והוא פותח את ארכיון המכשיר
            ולא את ההגדרות. מסך שאמר «קוד מנהל» ודחה את קוד המנהל.
            הנוסח מיושר לתווית בהגדרות, כדי שהשדה והשער ייקראו אותו דבר.
          */}
          <PinScreen
            expectedPin={draft.eventsPin ?? '0000'}
            onSuccess={() => setArchiveStep('list')}
            onCancel={() => setArchiveStep(null)}
            title="קוד ארכיון המכשיר"
            subtitle="ההקלטות ששמורות במכשיר הזה"
          />
        </div>
      )}

      {archiveStep === 'list' && (
        <div className="archive-overlay">
          <div className="archive-panel">
            <div className="archive-head">
              <h2>ארכיון אירועים</h2>
              <button
                className="mini-btn outline"
                onClick={() => setArchiveStep(null)}
              >
                סגירה
              </button>
            </div>

            {activeEvent && (
              <p className="step-hint archive-warn">
                האירוע <b>{activeEvent.name}</b> פעיל כרגע. כדי לחזור לאירוע אחר
                יש לסיים אותו תחילה.
              </p>
            )}

            {archiveList.length === 0 && (
              <div className="archive-empty">
                <span className="archive-empty-icon">🗂</span>
                <b>עדיין אין אירועים במכשיר הזה</b>
                <span className="meta">
                  אירוע נכנס לכאן ברגע שמסיימים אותו — ואפשר לחזור אליו בכל רגע.
                </span>
              </div>
            )}

            {archiveList.map((ev) => {
              const count = recordings.filter(
                (r) => r.meta.eventId === ev.id,
              ).length;
              const isActive = ev.id === activeEvent?.id;
              return (
                <div
                  className={`archive-card ${isActive ? 'archive-active' : ''}`}
                  key={ev.id}
                >
                  <span className="archive-icon">{isActive ? '🔴' : '💍'}</span>
                  <div className="archive-info">
                    <div className="archive-name">
                      {ev.name}
                      {isActive && (
                        <span className="archive-badge">פעיל עכשיו</span>
                      )}
                    </div>
                    <div className="meta">
                      {ev.date
                        ? formatEventDate(ev.date)
                        : new Date(ev.startedAt).toLocaleDateString('he-IL')}
                      {count > 0 && ` · ${count} הקלטות במכשיר`}
                    </div>
                  </div>
                  {!isActive && (
                    <div className="archive-actions">
                      <button
                        className="mini-btn"
                        disabled={!!activeEvent}
                        onClick={() => {
                          reopenEvent(ev);
                          setArchiveStep(null);
                        }}
                      >
                        ↩ חזור לאירוע
                      </button>
                      <button
                        className="mini-btn danger"
                        onClick={() => setDeleteTarget(ev)}
                      >
                        🗑 מחק
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

          </div>
        </div>
      )}

      {/* ---- אישור מחיקת אירוע מהמכשיר ---- */}
      {deleteTarget &&
        (() => {
          const evRecs = recordings.filter(
            (r) => r.meta.eventId === deleteTarget.id,
          );
          const notBackedUp = evRecs.filter(
            (r) => r.uploadStatus !== 'uploaded',
          ).length;
          return (
            <div
              className="event-modal-overlay delete-overlay"
              onClick={() => setDeleteTarget(null)}
            >
              <div className="event-modal" onClick={(e) => e.stopPropagation()}>
                <h2>למחוק את "{deleteTarget.name}" מהמכשיר?</h2>

                <ul className="delete-facts">
                  {evRecs.length > 0 ? (
                    <li>{evRecs.length} הקלטות יימחקו מהמכשיר</li>
                  ) : (
                    <li>אין הקלטות של האירוע הזה במכשיר</li>
                  )}
                  {notBackedUp > 0 ? (
                    <li className="delete-danger">
                      ⚠️ {notBackedUp} סרטונים <b>עדיין לא עלו לענן</b> — מחיקה
                      תאבד אותם לצמיתות
                    </li>
                  ) : (
                    evRecs.length > 0 && (
                      <li className="delete-safe">
                        ✓ הגיבוי בענן לא ייפגע — הסרטונים נשארים ב-Firebase
                      </li>
                    )
                  )}
                  <li>לא ניתן יהיה לחזור לאירוע הזה מהמכשיר הזה</li>
                </ul>

                <div className="footer">
                  <button
                    className="btn danger"
                    onClick={() => void deleteEventFromDevice(deleteTarget)}
                  >
                    מחק
                  </button>
                  <button
                    className="btn secondary"
                    onClick={() => setDeleteTarget(null)}
                  >
                    ביטול
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
