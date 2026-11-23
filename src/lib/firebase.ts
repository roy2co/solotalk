// אתחול Firebase - מופעל רק אם הוגדרו משתני הסביבה (VITE_FIREBASE_*).
// כל עוד לא הוגדר, שכבת הענן רדומה וההקלטות נשארות "ממתינות" מקומית.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth';

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** האם הוגדר גיבוי ענן */
export function isCloudConfigured(): boolean {
  return Boolean(cfg.apiKey && cfg.storageBucket && cfg.projectId);
}

let app: FirebaseApp | null = null;
let storage: FirebaseStorage | null = null;
let auth: Auth | null = null;
let authReady: Promise<void> | null = null;

export function getCloudStorage(): FirebaseStorage | null {
  if (!isCloudConfigured()) return null;
  if (!app) {
    app = initializeApp(cfg);
    storage = getStorage(app);
    /**
     * ה-SDK מנסה שוב עד **שתי דקות** כברירת מחדל - גם על שגיאה קבועה כמו
     * `403 Permission denied`, שלעולם לא תיפתר בניסיון נוסף. התוצאה הייתה
     * שהפאנל נתקע על «טוען מהענן…» עד שה-timeout שלנו קפץ והאשים את הרשת,
     * בזמן ש-Firebase החזיר את התשובה האמיתית תוך 87 מילישניות.
     *
     * 8 שניות מספיקות לגמגום רשת אמיתי, וקצרות מספיק כדי ששגיאת הרשאות
     * תגיע למסך עם ההסבר הנכון - מה בדיוק להגדיר בקונסול.
     */
    storage.maxOperationRetryTime = 8000;
    auth = getAuth(app);
  }
  return storage;
}

/** מתחבר אנונימית (נדרש לכללי האבטחה של Storage). ממוזג - פעם אחת. */
export async function ensureAuth(): Promise<void> {
  if (!isCloudConfigured()) return;
  getCloudStorage();
  if (!authReady) {
    authReady = signInAnonymously(auth!)
      .then(() => undefined)
      .catch((e) => {
        authReady = null;
        throw e;
      });
  }
  return authReady;
}
