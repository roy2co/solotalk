// כותב ZIP מינימלי בשיטת STORE (בלי דחיסה).
//
// למה בלי ספרייה ובלי דחיסה: קבצי הווידאו כבר דחוסים — DEFLATE עליהם יבזבז
// שניות ויחסוך ~0%. STORE הוא פשוט מספיק לכתיבה ידנית, וכך אין תלות נוספת.
//
// למה זה לא מפוצץ את הזיכרון: הארכיון נבנה כ-`new Blob([...])` שמצביע על
// ה-Blobs המקוריים במקום להעתיק אותם. רק חישוב ה-CRC דורש קריאה, והוא זורם
// במנות דרך `blob.stream()`.

/** מעל הגודל הזה נדרש פורמט ZIP64, שאינו נתמך כאן */
const ZIP64_THRESHOLD = 0xffffffff; // 4 ג"ב

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/**
 * טבלאות «slice-by-4» — מעבדות 4 בתים בסיבוב אחד במקום אחד.
 *
 * נמדד על קובץ אמיתי של 281 מ"ב: 717ms → 308ms, כלומר **פי 2.3**.
 * הפלט אומת כזהה לבית-בית. באייפד, שאיטי יותר, זה ההבדל בין המתנה
 * שנראית כמו תקיעה לבין חיווי שזז.
 */
const CRC_TABLES = (() => {
  const tabs: Uint32Array[] = [CRC_TABLE];
  for (let s = 1; s < 4; s++) {
    const prev = tabs[s - 1];
    const cur = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      const c = prev[n];
      cur[n] = CRC_TABLE[c & 0xff] ^ (c >>> 8);
    }
    tabs.push(cur);
  }
  return tabs;
})();

/**
 * CRC32 בזרימה — לא מחזיק את הקובץ בזיכרון.
 *
 * מחזיר **גם את מספר הבתים שנקראו בפועל**, וזה קריטי: אסור לסמוך על
 * `blob.size` בכתיבת הכותרות. ראו ההסבר ב-`buildZip`.
 */
async function crc32(
  blob: Blob,
  onBytes?: (delta: number) => void,
): Promise<{ crc: number; length: number }> {
  let crc = 0xffffffff;
  let length = 0;
  const [t0, t1, t2, t3] = CRC_TABLES;
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;

    // ארבעה בתים בכל סיבוב, והשארית בית-בית
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    let i = 0;
    for (; i + 4 <= value.length; i += 4) {
      const w = view.getUint32(i, true) ^ crc;
      crc =
        t3[w & 0xff] ^
        t2[(w >>> 8) & 0xff] ^
        t1[(w >>> 16) & 0xff] ^
        t0[(w >>> 24) & 0xff];
    }
    for (; i < value.length; i++) {
      crc = CRC_TABLE[(crc ^ value[i]) & 0xff] ^ (crc >>> 8);
    }

    // מדווח **תוך כדי** הקובץ. בלי זה החיווי קפא על אותו מספר לאורך כל
    // סרטון של 280 מ"ב, וזה נראה בדיוק כמו תקיעה.
    onBytes?.(value.length);
  }
  return { crc: (crc ^ 0xffffffff) >>> 0, length };
}

/** תאריך/שעה בפורמט DOS — כדי שהקבצים בארכיון יישאו את זמן ההקלטה */
function dosDateTime(ms: number): { date: number; time: number } {
  const d = new Date(ms);
  const year = Math.max(1980, d.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

export interface ZipEntry {
  name: string;
  blob: Blob;
  /** זמן היצירה של הקובץ (ms). ברירת מחדל: עכשיו */
  modified?: number;
}

export interface ZipProgress {
  /** כמה קבצים כבר עובדו */
  done: number;
  total: number;
  /** בתים שעובדו עד כה בחלק הזה — מאפשר אחוז שזז ברציפות */
  bytes: number;
  /** סך הבתים בחלק הזה */
  totalBytes: number;
}

/**
 * בונה ארכיון ZIP יחיד מכל הרשומות.
 * זורק שגיאה מפורשת אם הארכיון חורג מ-4 ג"ב, כדי לא לייצר קובץ פגום בשקט.
 *
 * ---- ⚠️ למה הגודל נמדד ולא נלקח מ-`blob.size` ----
 *
 * ארכיון שנוצר באייפד יצא **פגום**: macOS סירב לפתוח אותו, ו-`unzip -t`
 * דיווח `bad zipfile offset` מהקובץ השמיני והלאה. הניתוח הראה סטייה
 * שגדלה ב-**262,144 בתים בדיוק לכל רשומה** - כלומר לכל סרטון נכתבו
 * 256 ק"ב יותר ממה שהכותרת הצהירה.
 *
 * המקור: `fixMp4Duration` מרכיב blob חדש מ-256 ק"ב ראשונים + השארית.
 * בספארי ה-`size` של התוצאה יצא קטן מהתוכן האמיתי, וכיוון שהכותרות
 * נגזרו מ-`size`, כל ההיסטים אחריו זזו. הכותרות תיארו קובץ אחד והנתונים
 * היו אחרים.
 *
 * ממילא קוראים כל בית לחישוב ה-CRC, ולכן **סופרים תוך כדי**. מטא-דאטה
 * יכולה לשקר; הבתים עצמם לא.
 */
export async function buildZip(
  entries: ZipEntry[],
  onProgress?: (p: ZipProgress) => void,
): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  const totalBytes = entries.reduce((a, e) => a + e.blob.size, 0);
  let bytesDone = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const nameBytes = encoder.encode(entry.name);
    // הגודל **הנמדד**, לא המוצהר. ראו ההסבר למעלה.
    const { crc, length: size } = await crc32(entry.blob, (delta) => {
      bytesDone += delta;
      onProgress?.({ done: i, total: entries.length, bytes: bytesDone, totalBytes });
    });
    const { date, time } = dosDateTime(entry.modified ?? Date.now());

    // Local File Header — 30 בייט + שם הקובץ
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // חתימה
    local.setUint16(4, 20, true); // גרסה נדרשת
    local.setUint16(6, 0x0800, true); // דגל: השם מקודד UTF-8
    local.setUint16(8, 0, true); // שיטה: STORE
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true); // גודל דחוס
    local.setUint32(22, size, true); // גודל מקורי — זהה ב-STORE
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // אין extra field

    /**
     * ⚠️ **חיתוך מפורש לאורך שנמדד, ולא ה-blob כמו שהוא.**
     *
     * מדידת האורך לבדה לא הספיקה: blob פגום (כזה שנוצר ב-`fixMp4Duration`
     * על ספארי) מדווח `size` קטן מהתוכן, ו-`new Blob([blob])` כותב את
     * התוכן המלא. כלומר הכותרת תיארה N בתים והנתונים היו N+256K.
     * התוצאה: כל הקבצים אחרי הראשון יצאו פגומים אחרי חילוץ - **חוץ מזה
     * שנוצר אחרי התיקון**, וזה בדיוק מה שנצפה בשדה.
     *
     * `slice(0, size)` כופה שהחלק יהיה **בדיוק** באורך שהוכרז.
     */
    parts.push(new Uint8Array(local.buffer), nameBytes, entry.blob.slice(0, size));

    // Central Directory Header — 46 בייט + שם הקובץ
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); // גרסה שיצרה
    cd.setUint16(6, 20, true); // גרסה נדרשת
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true); // STORE
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true); // היסט ה-Local Header
    const cdBytes = new Uint8Array(46 + nameBytes.length);
    cdBytes.set(new Uint8Array(cd.buffer), 0);
    cdBytes.set(nameBytes, 46);
    central.push(cdBytes);

    offset += 30 + nameBytes.length + size;
    if (offset > ZIP64_THRESHOLD) {
      throw new Error('הארכיון גדול מ-4 ג"ב — יש לפצל אותו לחלקים');
    }
    onProgress?.({
      done: i + 1,
      total: entries.length,
      bytes: bytesDone,
      totalBytes,
    });
  }

  const centralSize = central.reduce((a, b) => a + b.length, 0);
  const centralOffset = offset;

  // End Of Central Directory — 22 בייט
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true); // רשומות בדיסק הזה
  end.setUint16(10, entries.length, true); // סה"כ רשומות
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralOffset, true);

  parts.push(...central, new Uint8Array(end.buffer));
  return new Blob(parts, { type: 'application/zip' });
}

/**
 * מחלק רשומות לקבוצות שכל אחת מתחת ל-maxBytes.
 * קובץ שגדול מהסף בעצמו מקבל קבוצה משלו — עדיף ארכיון חורג מלהשמיט אותו.
 */
export function splitBySize<T extends { blob: Blob }>(
  entries: T[],
  maxBytes: number,
): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let running = 0;
  for (const entry of entries) {
    if (current.length > 0 && running + entry.blob.size > maxBytes) {
      groups.push(current);
      current = [];
      running = 0;
    }
    current.push(entry);
    running += entry.blob.size;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
