// תיקון משכי דגימה פגומים ב-fragmented MP4 שנוצר ע"י MediaRecorder בספארי.
//
// ---- מה הבעיה ----
// בהקלטות ארוכות ספארי פולט לעיתים דגימה אחת עם `sample_duration` של
// `0xFFFFFFFF` (כלומר -1 כמספר מסומן). נגן שסוכם את משכי המקטעים מקבל
// 4,294,967,295 / 600 ≈ **1,988 שעות** במקום 4:58.
//
// נמדד על קובץ אמיתי: סכום המשכים היה 4,295,146,278, כלומר בדיוק
// `0xFFFFFFFF` ועוד 178,983 - וה-178,983 הוא המשך האמיתי (298.3 שנ').
//
// ---- למה זה בטוח, בניגוד לניסיון הקודם ----
// הגרסה שנכשלה בעבר כתבה `duration` ל-`mvhd`/`mdhd`. זה גרם ל-macOS
// להתייחס לקובץ כ-MP4 רגיל, לחפש דגימות בטבלאות `stts`/`stsz` **הריקות**,
// ולהיכשל: אפס תמונות ממוזערות והנגן קפא על הפריים הראשון.
//
// כאן **לא נוגעים ב-moov בכלל**. מתקנים ערך פגום בתוך `trun`, שהוא בדיוק
// המקום שממנו הנגן קורא את המשך בקובץ מקוטע. זה תיקון של נתון שבור,
// לא הוספת מידע חדש.
//
// ---- למה זה לא מפוצץ זיכרון ----
// התוצאה נבנית מ-`blob.slice()` שמצביע על המקור ולא מעתיק אותו. גם על
// קובץ של 280 מ"ב נוצרות רק כמה רצועות של 4 בתים.

/** מעל הערך הזה משך דגימה בודדת אינו אפשרי בשום מסלול תקין */
const ABSURD_TICKS = 1_000_000;

export interface RepairResult {
  blob: Blob;
  /** כמה דגימות תוקנו. 0 = הקובץ היה תקין ולא נגענו בו */
  fixed: number;
}

/** מיקום שדה בקובץ והערך שיוצב בו */
interface Patch {
  offset: number;
  value: number;
}

function median(values: number[]): number {
  const sane = values.filter((v) => v > 0 && v < ABSURD_TICKS).sort((a, b) => a - b);
  if (sane.length === 0) return 0;
  return sane[Math.floor(sane.length / 2)];
}

/**
 * סורק `moof` אחד ומחזיר את התיקונים הדרושים בתוכו.
 * `base` הוא ההיסט של ה-moof בקובץ המלא.
 */
function scanMoof(view: DataView, base: number): Patch[] {
  const patches: Patch[] = [];
  const end = view.byteLength;

  for (let i = 0; i + 8 <= end; ) {
    const size = view.getUint32(i);
    const type = String.fromCharCode(
      view.getUint8(i + 4), view.getUint8(i + 5),
      view.getUint8(i + 6), view.getUint8(i + 7),
    );

    if (type === 'traf' || type === 'moof') {
      // קופסאות מכילות - יורדים פנימה
      i += 8;
      continue;
    }

    if (type === 'trun' && size >= 16) {
      const flags = view.getUint32(i + 8) & 0xffffff;
      const count = view.getUint32(i + 12);
      let p = i + 16;
      if (flags & 0x1) p += 4; // data_offset
      if (flags & 0x4) p += 4; // first_sample_flags

      if (flags & 0x100) {
        // sample_duration קיים - אוספים, מאתרים חריגים, ומתקנים לחציון
        const offsets: number[] = [];
        const values: number[] = [];
        let q = p;
        for (let k = 0; k < count && q + 4 <= i + size; k++) {
          offsets.push(q);
          values.push(view.getUint32(q));
          q += 4;
          if (flags & 0x200) q += 4; // sample_size
          if (flags & 0x400) q += 4; // sample_flags
          if (flags & 0x800) q += 4; // composition_offset
        }
        const med = median(values);
        if (med > 0) {
          for (let k = 0; k < values.length; k++) {
            if (values[k] >= ABSURD_TICKS) {
              patches.push({ offset: base + offsets[k], value: med });
            }
          }
        }
      }
    }

    if (size < 8) break;
    i += size;
  }
  return patches;
}

/**
 * מאתר ומתקן משכי דגימה פגומים.
 *
 * קורא רק את קופסאות ה-`moof` (קטנות), ולא את ה-`mdat` שמכיל את הווידאו
 * עצמו - ולכן זה זול גם על קובץ של מאות מ"ב.
 */
export async function repairSampleDurations(blob: Blob): Promise<RepairResult> {
  const patches: Patch[] = [];
  let off = 0;

  while (off + 8 <= blob.size) {
    const head = new DataView(await blob.slice(off, off + 8).arrayBuffer());
    const size = head.getUint32(0);
    const type = String.fromCharCode(
      head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7),
    );
    if (size < 8) break;

    if (type === 'moof') {
      const box = new DataView(await blob.slice(off, off + size).arrayBuffer());
      patches.push(...scanMoof(box, off));
    }
    off += size;
  }

  if (patches.length === 0) return { blob, fixed: 0 };

  // מרכיבים מחדש מ-slices: אין העתקה של הווידאו, רק רצועות של 4 בתים
  patches.sort((a, b) => a.offset - b.offset);
  const parts: BlobPart[] = [];
  let cursor = 0;
  for (const patch of patches) {
    if (patch.offset > cursor) parts.push(blob.slice(cursor, patch.offset));
    const buf = new DataView(new ArrayBuffer(4));
    buf.setUint32(0, patch.value);
    parts.push(buf.buffer);
    cursor = patch.offset + 4;
  }
  if (cursor < blob.size) parts.push(blob.slice(cursor));

  return { blob: new Blob(parts, { type: blob.type }), fixed: patches.length };
}
