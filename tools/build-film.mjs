#!/usr/bin/env node
/**
 * בונה סרט אחד מכל הקלטות האירוע, עם פרקים.
 *
 *   node tools/build-film.mjs <תיקיית-סרטונים> [תיקיית-פלט]
 *
 * מה הוא עושה, לפי הסדר:
 *   1. מתקן משכי דגימה פגומים (באג ה-1988 שעות). בלי זה הסרט יורש אותו.
 *   2. מזהה שתיקה בתחילת/סוף כל קטע (`silencedetect`) וחותך אותה — הקטע
 *      מתחיל בדיוק כשהאורח מתחיל לדבר, לא לפניו. **לא** נוגע בשתיקות
 *      באמצע הקטע. כל קטע עובר קידוד מחדש בשלב הזה (מהיר יחסית —
 *      VideoToolbox של macOS), גם אם אין בו שתיקה לחתוך: כך כל הקטעים
 *      יוצאים באותם פרמטרים בדיוק, וחיבור ה-`-c copy` בשלב 5 בטוח.
 *   3. מסדר את הקטעים לפי תבנית — קרבה, ובתוך כל בלוק לפי שעת הצילום.
 *      הקלטות «רק לברך» יוצאות מהבלוקים ומרוכזות כפרק אחרון, «הברכות».
 *   4. שוזר את הקטעים הקצרים בין הבלוקים כמפרידים.
 *   5. מחבר עם ffmpeg ב-`-c copy` — בלי קידוד נוסף, בלי אובדן איכות.
 *   6. מטמיע סימני פרקים ומייצר רשימת זמנים קריאה.
 *   7. אורז את התוצאה לזיפ.
 *
 * ⚠️ זיהוי «ברכה» תלוי בשם קובץ שנוצר **אחרי** שהעומק נוסף לשם האובייקט
 * בענן (`src/lib/naming.ts` → `cloudObjectName`). הקלטות שהועלו לפני השינוי
 * הזה לא נושאות את המידע ופשוט יישארו בבלוק הקרבה הרגיל שלהן.
 *
 * דרישות: ffmpeg (brew install ffmpeg)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import zlib from 'node:zlib';

// ---------- תבנית הסרט ----------
// הסדר שבו הבלוקים מופיעים. השם הוא מה שיופיע כשם הפרק.
// עבודה וצבא מאוחדים לתוך «החברים» — הם תת-קטגוריות של «חברים» גם
// ב-`FRIENDS_SUBCATEGORIES` שב-`src/types.ts`, לא ענף נפרד משלהן.
const TEMPLATE = [
  { slugs: ['family', 'parents', 'grandparents', 'siblings', 'uncles-cousins', 'in-laws'], title: 'המשפחה' },
  { slugs: ['friends', 'childhood-friends', 'inner-circle', 'work-friends', 'army-friends'], title: 'החברים' },
  { slugs: ['other', 'guest'], title: 'אחר' },
  { slugs: ['couple'], title: 'החתן והכלה' },
];

/** מקבצת לפי סדר `TEMPLATE` (זהה למה שקורה לגוף הראשי), בלי מפרידים — משמש לברכות. */
function groupByTemplateOrder(list) {
  const used = new Set();
  const ordered = [];
  for (const block of TEMPLATE) {
    const inBlock = list.filter((c) => block.slugs.includes(c.slug)).sort((a, b) => a.order - b.order);
    inBlock.forEach((c) => used.add(c));
    ordered.push(...inBlock);
  }
  const rest = list.filter((c) => !used.has(c)).sort((a, b) => a.order - b.order);
  return [...ordered, ...rest];
}

/** קטע קצר מזה נחשב «מפריד» ונשזר בין הבלוקים במקום להיערם בתוכם */
const INTERSTITIAL_MAX_SEC = 20;

// ---------- ניתוח MP4 ----------
const ABSURD = 1e6;

function topBoxes(b) {
  const out = [];
  let o = 0;
  while (o + 8 <= b.length) {
    let sz = b.readUInt32BE(o);
    const t = b.toString('latin1', o + 4, o + 8);
    if (sz === 1) sz = Number(b.readBigUInt64BE(o + 8));
    if (sz === 0) sz = b.length - o;
    if (sz < 8) break;
    out.push({ type: t, start: o, size: sz });
    o += sz;
  }
  return out;
}

/**
 * מתקן משכי דגימה פגומים ומחזיר גם את המשך האמיתי.
 * מחליף כל ערך חריג בחציון של אותו `trun` — בדיוק כמו `src/lib/mp4Repair.ts`.
 */
function repairAndMeasure(buf) {
  const b = Buffer.from(buf);
  let fixed = 0;
  let ticks = 0;

  for (const box of topBoxes(b)) {
    if (box.type !== 'moof') continue;
    let i = box.start + 8;
    const end = box.start + box.size;
    while (i + 8 <= end) {
      const s2 = b.readUInt32BE(i);
      const t2 = b.toString('latin1', i + 4, i + 8);
      if (t2 === 'traf') { i += 8; continue; }
      if (t2 === 'trun' && s2 >= 16) {
        const flags = b.readUInt32BE(i + 8) & 0xffffff;
        const count = b.readUInt32BE(i + 12);
        if (flags & 0x100) {
          let q = i + 16;
          if (flags & 0x1) q += 4;
          if (flags & 0x4) q += 4;
          const offsets = [], values = [];
          for (let k = 0; k < count && q + 4 <= i + s2; k++) {
            offsets.push(q); values.push(b.readUInt32BE(q));
            q += 4;
            if (flags & 0x200) q += 4;
            if (flags & 0x400) q += 4;
            if (flags & 0x800) q += 4;
          }
          const sane = values.filter((v) => v > 0 && v < ABSURD).sort((x, y) => x - y);
          const med = sane.length ? sane[Math.floor(sane.length / 2)] : 0;
          for (let k = 0; k < values.length; k++) {
            if (values[k] >= ABSURD && med > 0) {
              b.writeUInt32BE(med, offsets[k]);
              values[k] = med;
              fixed++;
            }
          }
          // מסלול 1 הוא הווידאו (timescale 600)
          ticks += values.reduce((a, v) => a + v, 0);
        }
      }
      if (s2 < 8) break;
      i += s2;
    }
  }
  // המשך נמדד ב-ffprobe על הקובץ **המתוקן**, ולא בחשבון עצמי:
  // שני המסלולים משתמשים ב-timescale שונה (600 לווידאו, 48000 לאודיו),
  // וסכימה שלהם יחד נותנת מספר חסר משמעות. `ticks` נשאר רק לאבחון.
  return { buf: b, fixed, ticks };
}

/**
 * משך משוער לפי ספירת `moof`. המקליט כותב מקטע כל שנייה בדיוק
 * (`recorder.start(1000)`), ולכן זה מדויק ל-±1 שנייה — **וחסין לבאג
 * ה-1988**, שגורם ל-ffprobe להחזיר משכים אבסורדיים בקבצים שלא תוקנו.
 */
function moofSeconds(file) {
  const b = fs.readFileSync(file);
  let n = 0;
  for (const box of topBoxes(b)) if (box.type === 'moof') n++;
  return n;
}

// ---------- חיתוך שתיקות ----------
const SILENCE_NOISE_DB = -35; // מתחת לזה נחשב «שקט» (לא 0 מוחלט — יש רעש רקע באולם)
const SILENCE_MIN_SEC = 0.4;  // רצף שקט קצר מזה לא נחשב (לא לחתוך הפסקת נשימה טבעית)
const SILENCE_PAD_SEC = 0.15; // שוליים קטנים כדי לא לחתוך את ההברה הראשונה/אחרונה ממש

/**
 * מזהה שתיקה **רק** בתחילת ובסוף הקטע (לא באמצע) ומחזירה טווח חיתוך.
 * `silencedetect` כותב ל-stderr, ולכן `spawnSync` ולא `execFileSync`
 * (שמחזיר רק stdout).
 */
function detectSilenceTrim(file, totalSeconds) {
  const res = spawnSync('ffmpeg', [
    '-i', file, '-af', `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_SEC}`,
    '-f', 'null', '-',
  ], { encoding: 'utf8' });
  const log = res.stderr || '';
  const starts = [...log.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => parseFloat(m[1]));
  const ends = [...log.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));

  // שקט שמתחיל כמעט ב-0 = הקטע נפתח בשתיקה
  let from = 0;
  if (starts.length && starts[0] <= 0.05) from = Math.max(0, (ends[0] ?? 0) - SILENCE_PAD_SEC);
  /**
   * ⚠️ **לא סופרים "יותר start מ-end"** — ffmpeg (לפחות 9.0.1) כן סוגר את
   * ה-silence_end גם כששקט נמשך עד ה-EOF בדיוק (נמדד: `silence_start: 3.0`
   * ואז `silence_end: 4` על קטע של 4 שנ' בדיוק). הסתמכות על אי-זוגיות
   * ספרה את זה כ"לא שתיקה סופית" ופספסה כל חיתוך סוף — נבדק בפועל: 1 שנ'
   * שתיקה בסוף קטע 4 שנ' לא נחתכה כלל, למרות שהזיהוי עצמו עבד מושלם.
   *
   * הבדיקה הנכונה: **האם רצף השתיקה האחרון מגיע עד סוף הקובץ** — בין אם
   * יש לו `silence_end` תואם (המקרה שנמדד כאן) ובין אם אין (המקרה שההנחה
   * המקורית כיוונה אליו). שני המקרים שקולים מבחינתנו: יש שתיקה בזנב.
   */
  let to = totalSeconds;
  if (starts.length) {
    const lastStart = starts[starts.length - 1];
    const matchedEnd = ends.length >= starts.length ? ends[starts.length - 1] : totalSeconds;
    if (matchedEnd >= totalSeconds - 0.2) {
      to = Math.min(totalSeconds, lastStart + SILENCE_PAD_SEC);
    }
  }

  if (to - from < 1) return { from: 0, to: totalSeconds }; // הגנה: לא לחתוך כמעט הכל בטעות
  return { from, to };
}

/**
 * משך בשניות + זמן צילום (אם הוטמע ב-mp4), לפי ffprobe — מקור האמת היחיד
 * אחרי התיקון. `creation_time` הוא עוגן אמין יותר לסדר מאשר המספור
 * בשם הקובץ (ראו ההערה ליד `READABLE_LABEL_TO_SLUG`).
 */
function probeMeta(file) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:format_tags=creation_time',
    '-of', 'json', file,
  ]).toString();
  let seconds = 0, createdAt = null;
  try {
    const j = JSON.parse(out);
    const d = parseFloat(j.format?.duration);
    if (Number.isFinite(d)) seconds = d;
    const t = Date.parse(j.format?.tags?.creation_time ?? '');
    if (Number.isFinite(t)) createdAt = t;
  } catch { /* נשאר 0 / null */ }
  return { seconds, createdAt };
}

// ---------- עזר ----------
const pad = (n) => String(n).padStart(2, '0');
const hhmmss = (s) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(Math.floor(s % 60))}`;
const israelTime = (ms) => new Date(ms).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });

/**
 * מיפוי מהתווית העברית שבשם הקובץ (אחרי `safeSegment` — לוכסן הפך למקף,
 * ראו `src/lib/naming.ts`) ל-slug האנגלי שהתבנית למעלה משתמשת בו.
 * מראה כמו `RELATIONSHIP_SLUG` ב-`src/types.ts`, ידנית כי זה סקריפט
 * עצמאי בלי גישה לקוד ה-TS.
 */
const READABLE_LABEL_TO_SLUG = {
  'חתן וכלה': 'couple',
  'הורים': 'parents',
  'אחים ואחיות': 'siblings',
  'סבא וסבתא': 'grandparents',
  'דודים ובני דודים': 'uncles-cousins',
  'גיסים-גיסות': 'in-laws',
  'משפחה': 'family',
  'חברי ילדות': 'childhood-friends',
  'חברים-חברות מהצבא': 'army-friends',
  'חברים-חברות מהעבודה': 'work-friends',
  'חברים': 'friends',
  'מלווים של הזוג': 'inner-circle',
  'אחר': 'other',
};

/** מתוך `DEPTH_LABELS` ב-`src/types.ts` — ידני מאותה סיבה שהמפה למעלה ידנית */
const READABLE_LABEL_TO_DEPTH = {
  'רק לברך': 'blessing',
  'כמה שאלות': 'few',
  'פריסטייל': 'many',
};

/**
 * מזהה slug + עומק + עוגן-סדר-גיבוי מתוך שם הקובץ, בשני הפורמטים הקיימים
 * בפועל:
 *   1. `<slug>_<עומק>_HHMM_<id>.mp4`                          — אובייקט גולמי בענן.
 *      (קבצים ישנים מלפני שהעומק נוסף: `<slug>_HHMM_<id>.mp4`, בלי עומק.)
 *   2. `<שם> - <תאריך> - NN[ - <קרבה בעברית>][ - <עומק בעברית>].mp4` — ייצוא קריא.
 *
 * ⚠️ ב-(2) ה-NN **לא תמיד עולה עם הסדר הכרוני האמיתי** — `Admin.tsx` ממספר
 * לפי סדר תצוגה יורד (חדש=01), בעוד `cloudArchive.ts` ממספר עולה (ישן=01).
 * לכן זהו רק **גיבוי**: הסדר האמיתי בפועל נלקח מ-`creation_time` שב-mp4
 * עצמו כשהוא קיים (`probeMeta`), ורק בהיעדרו נופלים לכאן.
 */
function slugOf(file) {
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  let m = base.match(/^(.+?)_(blessing|few|many)_(\d{4})_[a-z0-9]+$/i);
  if (m) return { slug: m[1], depth: m[2], fallbackOrder: Number(m[3]), fallbackDisplay: `${m[3].slice(0, 2)}:${m[3].slice(2)}` };
  m = base.match(/^(.+?)_(\d{4})_[a-z0-9]+$/i);
  if (m) return { slug: m[1], depth: null, fallbackOrder: Number(m[2]), fallbackDisplay: `${m[2].slice(0, 2)}:${m[2].slice(2)}` };
  m = base.match(/^.* - \d{1,2}\.\d{1,2}\.\d{4} - (\d+)(?: - (.+?))?(?: - (רק לברך|כמה שאלות|פריסטייל))?$/);
  if (m) {
    const slug = READABLE_LABEL_TO_SLUG[m[2]] || 'guest';
    const depth = READABLE_LABEL_TO_DEPTH[m[3]] || null;
    return { slug, depth, fallbackOrder: Number(m[1]), fallbackDisplay: `#${m[1]}` };
  }
  return { slug: 'guest', depth: null, fallbackOrder: 0, fallbackDisplay: '?' };
}

/**
 * כותב ZIP בשיטת STORE עם קובץ אחד, ידנית — בלי להסתמך על `zip` המערכת.
 *
 * ⚠️ **חובה, לא נוחות.** ה-`zip` המובנה במק לא כותב UTF-8 תקין לשמות
 * קבצים — נבדק בפועל: גם עם `LANG=en_US.UTF-8` מפורש, שם עברי יצא
 * `??????????.mp4` בתוך הארכיון. זו בדיוק הסיבה ש-`src/lib/zip.ts` כבר
 * נכתב כך לאפליקציית האורח; זו אותה שיטה בדיוק (STORE + דגל UTF-8
 * `0x0800`), רק ב-Node עם `fs`/`Buffer` במקום `Blob` בדפדפן.
 */
function writeSingleFileZip(zipPath, filePath, entryName) {
  const data = fs.readFileSync(filePath);
  const crc = zlib.crc32(data) >>> 0;
  const nameBytes = Buffer.from(entryName, 'utf8');
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // דגל UTF-8 — בדיוק מה ש-zip של המערכת מפספס
  local.writeUInt16LE(0, 8); // STORE
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42); // היסט הכותרת המקומית — 0, כי היא ראשונה בקובץ
  nameBytes.copy(central, 46);

  const localSize = 30 + nameBytes.length + data.length;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(localSize, 16);

  fs.writeFileSync(zipPath, Buffer.concat([local, nameBytes, data, central, end]));
}

// ---------- ראשי ----------
const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const skipArg = args.find((a) => a.startsWith('--skip='));
/** מספרי הקטעים שיש להשמיט, לפי המספור שמוצג ב---list */
const skipNums = new Set(
  (skipArg ? skipArg.slice(7) : '').split(',').map((x) => parseInt(x.trim(), 10)).filter(Number.isFinite),
);
const positional = args.filter((a) => !a.startsWith('--'));
const srcDir = positional[0];
const outDir = positional[1] || path.join(srcDir ?? '.', '_film');

if (!srcDir || !fs.existsSync(srcDir)) {
  console.error('שימוש: node tools/build-film.mjs <תיקיית-סרטונים> [תיקיית-פלט]');
  console.error('טיפ: שימו את סרטוני האירוע בתת-תיקייה בתוך "סרטוני אירועים/"');
  process.exit(1);
}
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  console.error('ffmpeg לא מותקן. הרץ:  brew install ffmpeg');
  process.exit(1);
}
// VideoToolbox (חומרה, מק בלבד) לקידוד מחדש מהיר בשלב חיתוך השתיקות.
// בלעדיו נופלים ל-libx264 (תוכנה) — עובד בכל מקום, פשוט איטי יותר.
const HW_ENCODER = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] })
  .toString().includes('h264_videotoolbox') ? 'h264_videotoolbox' : null;
const VIDEO_ENCODE_ARGS = HW_ENCODER
  ? ['-c:v', HW_ENCODER, '-b:v', '6M', '-maxrate', '8M', '-bufsize', '12M']
  : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];

const files = fs.readdirSync(srcDir).filter((f) => f.toLowerCase().endsWith('.mp4')).sort();
if (!files.length) { console.error('לא נמצאו קבצי mp4 ב-' + srcDir); process.exit(1); }

/**
 * מצב תצוגה: מראה מה ייכנס לסרט, עם משך ומספר סידורי, ויוצא.
 * זה מה שמאפשר לזהות הקלטת בדיקה ולהשמיט אותה לפני שבונים 1.7 ג"ב.
 */
if (listOnly) {
  console.log(`\n${files.length} קטעים ב-${srcDir}\n`);
  let n = 0, total = 0;
  for (const f of files) {
    n++;
    const d = moofSeconds(path.join(srcDir, f));
    const { slug, depth, fallbackDisplay } = slugOf(f);
    total += d;
    console.log(`  ${String(n).padStart(2)}. ${hhmmss(d).slice(3)}  ${slug.padEnd(18)} ${(depth || '').padEnd(9)} ${fallbackDisplay.padEnd(6)}   ${f}`);
  }
  console.log(`\n  סה"כ ${hhmmss(total)}`);

  // גיליון תמונות: פריים אחד מכל קטע, באותו מספור. זו הדרך המהירה
  // לזהות הקלטת בדיקה בלי לפתוח 27 קבצים אחד-אחד.
  const sheetDir = fs.mkdtempSync(path.join(srcDir, '.sheet-'));
  try {
    let k = 0;
    for (const f of files) {
      k++;
      // בלי drawtext — הוא דורש libfreetype שלא קיים בכל בניית ffmpeg.
      // המספור נשמר לפי המיקום בגיליון, והמקרא מודפס למטה.
      execFileSync('ffmpeg', ['-y', '-i', path.join(srcDir, f), '-vf',
        'select=eq(n\\,30),scale=240:-1',
        '-frames:v', '1', path.join(sheetDir, `${String(k).padStart(2, '0')}.png`)],
        { stdio: ['ignore', 'ignore', 'ignore'] });
    }
    const sheet = path.join(srcDir, 'גיליון_קטעים.png');
    execFileSync('ffmpeg', ['-y', '-pattern_type', 'glob', '-i', path.join(sheetDir, '*.png'),
      '-filter_complex', `tile=5x${Math.ceil(files.length / 5)}:padding=6:color=black`,
      '-frames:v', '1', sheet], { stdio: ['ignore', 'ignore', 'ignore'] });
    console.log(`\n  גיליון תמונות: ${sheet}`);
    console.log('  (5 בשורה, משמאל לימין — לפי אותו מספור שלמעלה)');
  } catch {
    console.log('\n  (גיליון התמונות נכשל — לא קריטי)');
  } finally {
    fs.rmSync(sheetDir, { recursive: true, force: true });
  }

  console.log(`\n  להשמטה:  node tools/build-film.mjs "${srcDir}" --skip=3,14\n`);
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
const prepDir = path.join(outDir, '_prepared');
fs.mkdirSync(prepDir, { recursive: true });

console.log(`\n── שלב 1: תיקון, חיתוך שתיקות ונרמול (${files.length} קבצים, ${HW_ENCODER ? 'VideoToolbox' : 'libx264 — איטי יותר'}) ──`);
const clips = [];
let totalFixed = 0;
let totalTrimmed = 0;
let idx = 0;
for (const f of files) {
  idx++;
  if (skipNums.has(idx)) { console.log(`  ${String(idx).padStart(2)}. ${f.slice(0, 40)} — הושמט`); continue; }
  const raw = fs.readFileSync(path.join(srcDir, f));
  const { buf, fixed } = repairAndMeasure(raw);
  const repaired = path.join(prepDir, `r_${idx}.mp4`);
  fs.writeFileSync(repaired, buf);
  totalFixed += fixed;

  const { seconds: rawSeconds, createdAt } = probeMeta(repaired);
  const { from, to } = detectSilenceTrim(repaired, rawSeconds);
  const cutLead = from > 0.05;
  const cutTail = to < rawSeconds - 0.05;

  // כל קטע עובר קידוד מחדש כאן, גם בלי שתיקה לחתוך — כדי שכל הקטעים
  // יצאו באותם פרמטרים בדיוק ואפשר יהיה לחבר אותם ב-`-c copy` בביטחון.
  const dest = path.join(prepDir, `t_${idx}.mp4`);
  execFileSync('ffmpeg', ['-y', '-i', repaired, '-ss', String(from), '-to', String(to),
    ...VIDEO_ENCODE_ARGS, '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '44100', '-ac', '2',
    '-map_metadata', '0', '-movflags', '+faststart', dest],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  fs.rmSync(repaired, { force: true });
  const seconds = to - from;

  const { slug, depth, fallbackOrder, fallbackDisplay } = slugOf(f);
  const order = createdAt ?? fallbackOrder;
  const timeLabel = createdAt ? israelTime(createdAt) : fallbackDisplay;
  clips.push({ file: dest, name: f, slug, depth, order, timeLabel, seconds });

  const notes = [];
  if (fixed) notes.push(`תוקנו ${fixed} משכים`);
  if (cutLead || cutTail) {
    totalTrimmed++;
    notes.push(`שתיקה${cutLead ? ` התחלה -${from.toFixed(1)}s` : ''}${cutTail ? ` סוף -${(rawSeconds - to).toFixed(1)}s` : ''}`);
  }
  if (notes.length) console.log(`  ${f.slice(0, 34).padEnd(36)} ${notes.join(' · ')} · ${hhmmss(seconds)}`);
}
console.log(`  סה"כ תוקנו ${totalFixed} משכים פגומים · נחתכה שתיקה ב-${totalTrimmed} קטעים${skipNums.size ? ` · הושמטו ${skipNums.size} קטעים` : ''}`);

console.log('\n── שלב 2: סידור לפי תבנית ──');
// ברכות מרוכזות בסוף הסרט ולא בבלוק הקרבה שלהן — יוצאות מהמאגר לפני החלוקה
// לבלוקים ולפני זיהוי המפרידים, כדי שלא ייבלעו כ«קטע קצר» באמצע הסרט.
const blessings = clips.filter((c) => c.depth === 'blessing');
const nonBlessing = clips.filter((c) => c.depth !== 'blessing');

// קטע קצר נהיה «מפריד» רק אם יש עוד קטע מאותה קרבה — אחרת בלוק שלם עם קטע
// יחיד קצר (למשל אירוע-בדיקה עם קטע אחד לכל קרבה) היה נעלם לגמרי ל«לסיום».
const bySlugCount = new Map();
for (const c of nonBlessing) bySlugCount.set(c.slug, (bySlugCount.get(c.slug) || 0) + 1);
const belongsToBlock = (slug) => TEMPLATE.some((b) => b.slugs.includes(slug));

const used = new Set();
const shorts = nonBlessing.filter((c) => {
  if (c.seconds >= INTERSTITIAL_MAX_SEC) return false;
  return !belongsToBlock(c.slug) || (bySlugCount.get(c.slug) || 0) > 1;
});
shorts.forEach((c) => used.add(c.file));

const timeline = [];
for (const block of TEMPLATE) {
  const inBlock = nonBlessing
    .filter((c) => block.slugs.includes(c.slug) && !used.has(c.file))
    .sort((a, b) => a.order - b.order);
  if (!inBlock.length) continue;
  timeline.push({ chapter: block.title, clips: inBlock });
  inBlock.forEach((c) => used.add(c.file));
  // מפריד אחד אחרי כל בלוק, כל עוד נשארו קצרים
  const filler = shorts.shift();
  if (filler) timeline.push({ chapter: null, clips: [filler] });
}
// כל מה שלא נתפס בתבנית + קצרים שנשארו
const rest = nonBlessing.filter((c) => !used.has(c.file) && !shorts.includes(c));
const leftovers = [...rest, ...shorts].sort((a, b) => a.order - b.order);
if (leftovers.length) {
  // אם הבלוק האחרון כבר נושא את אותו שם — מאחדים במקום ליצור פרק כפול
  const last = [...timeline].reverse().find((s) => s.chapter);
  if (last && last.chapter === 'אחר') last.clips.push(...leftovers);
  else timeline.push({ chapter: 'לסיום', clips: leftovers });
}
if (blessings.length) {
  // אותו סדר קטגוריות כמו הגוף הראשי — משפחה ← חברים ← אחר ← חתן וכלה
  timeline.push({ chapter: 'הברכות', clips: groupByTemplateOrder(blessings) });
}

for (const seg of timeline) {
  if (seg.chapter) console.log(`  ▸ ${seg.chapter} (${seg.clips.length})`);
  else console.log(`      · מפריד: ${seg.clips[0].name.slice(0, 30)}`);
}

console.log('\n── שלב 3: חיבור ──');
const ordered = timeline.flatMap((s) => s.clips);
const listFile = path.join(outDir, 'concat.txt');
fs.writeFileSync(listFile, ordered.map((c) => `file '${path.resolve(c.file).replace(/'/g, "'\\''")}'`).join('\n'));

// פרקים + רשימת זמנים
let at = 0;
const chapters = [';FFMETADATA1'];
const readable = [];
for (const seg of timeline) {
  if (seg.chapter) {
    const start = Math.round(at * 1000);
    const len = seg.clips.reduce((a, c) => a + c.seconds, 0);
    chapters.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${start}`, `END=${Math.round((at + len) * 1000)}`, `title=${seg.chapter}`);
    readable.push(`${hhmmss(at)}  ${seg.chapter}`);
  }
  for (const c of seg.clips) {
    readable.push(`   ${hhmmss(at)}  ${c.slug} · ${c.timeLabel}`);
    at += c.seconds;
  }
}
const metaFile = path.join(outDir, 'chapters.txt');
fs.writeFileSync(metaFile, chapters.join('\n'));

const joined = path.join(outDir, 'film_raw.mp4');
execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', joined], { stdio: ['ignore', 'ignore', 'pipe'] });

const final = path.join(outDir, 'הסרט_המלא.mp4');
execFileSync('ffmpeg', ['-y', '-i', joined, '-f', 'ffmetadata', '-i', metaFile, '-map_metadata', '1', '-c', 'copy', '-movflags', '+faststart', final], { stdio: ['ignore', 'ignore', 'pipe'] });
fs.rmSync(joined, { force: true });

fs.writeFileSync(path.join(outDir, 'רשימת_זמנים.txt'), readable.join('\n') + '\n');
fs.rmSync(prepDir, { recursive: true, force: true });
fs.rmSync(listFile, { force: true });
fs.rmSync(metaFile, { force: true });

console.log('\n── שלב 4: אריזה לזיפ ──');
// בלי דחיסה: הווידאו כבר דחוס, DEFLATE רק יבזבז זמן.
const zipFile = path.join(outDir, path.basename(final, '.mp4') + '.zip');
fs.rmSync(zipFile, { force: true });
writeSingleFileZip(zipFile, final, path.basename(final));

const mb = fs.statSync(final).size / 1048576;
console.log(`\n✅ נוצר: ${final}`);
console.log(`   ${mb.toFixed(0)} מ"ב · ${hhmmss(at)} · ${ordered.length} קטעים · ${timeline.filter((s) => s.chapter).length} פרקים`);
console.log(`   זיפ: ${zipFile}`);
console.log(`   רשימת זמנים: ${path.join(outDir, 'רשימת_זמנים.txt')}\n`);
