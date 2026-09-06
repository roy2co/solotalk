#!/usr/bin/env node
/**
 * בונה סרט אחד מכל הקלטות האירוע, עם פרקים.
 *
 *   node tools/build-film.mjs <תיקיית-סרטונים> [תיקיית-פלט]
 *
 * מה הוא עושה, לפי הסדר:
 *   1. מתקן משכי דגימה פגומים (באג ה-1988 שעות). בלי זה הסרט יורש אותו.
 *   2. מסדר את הקטעים לפי תבנית — קרבה, ובתוך כל בלוק לפי שעת הצילום.
 *   3. שוזר את הקטעים הקצרים בין הבלוקים כמפרידים.
 *   4. מחבר עם ffmpeg ב-`-c copy` — בלי קידוד מחדש, בלי אובדן איכות.
 *   5. מטמיע סימני פרקים ומייצר רשימת זמנים קריאה.
 *
 * דרישות: ffmpeg (brew install ffmpeg)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// ---------- תבנית הסרט ----------
// הסדר שבו הבלוקים מופיעים. השם הוא מה שיופיע כשם הפרק.
const TEMPLATE = [
  { slugs: ['couple'], title: 'החתן והכלה' },
  { slugs: ['parents', 'grandparents', 'siblings'], title: 'המשפחה הקרובה' },
  { slugs: ['uncles-cousins', 'in-laws', 'family'], title: 'המשפחה' },
  { slugs: ['childhood-friends', 'friends', 'inner-circle'], title: 'החברים' },
  { slugs: ['work-friends', 'army-friends'], title: 'עבודה וצבא' },
  { slugs: ['other', 'guest'], title: 'ועוד' },
];

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

/**
 * מזהה slug + עוגן-סדר-גיבוי מתוך שם הקובץ, בשני הפורמטים הקיימים בפועל:
 *   1. `<slug>_HHMM_<id>.mp4`                     — שם האובייקט הגולמי בענן.
 *   2. `<שם> - <תאריך> - NN[ - <קרבה בעברית>].mp4` — ייצוא קריא (מכשיר/ענן).
 *
 * ⚠️ ב-(2) ה-NN **לא תמיד עולה עם הסדר הכרוני האמיתי** — `Admin.tsx` ממספר
 * לפי סדר תצוגה יורד (חדש=01), בעוד `cloudArchive.ts` ממספר עולה (ישן=01).
 * לכן זהו רק **גיבוי**: הסדר האמיתי בפועל נלקח מ-`creation_time` שב-mp4
 * עצמו כשהוא קיים (`probeMeta`), ורק בהיעדרו נופלים לכאן.
 */
function slugOf(file) {
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  let m = base.match(/^(.+?)_(\d{4})_[a-z0-9]+$/i);
  if (m) return { slug: m[1], fallbackOrder: Number(m[2]), fallbackDisplay: `${m[2].slice(0, 2)}:${m[2].slice(2)}` };
  m = base.match(/^.* - \d{1,2}\.\d{1,2}\.\d{4} - (\d+)(?: - (.+))?$/);
  if (m) {
    const slug = READABLE_LABEL_TO_SLUG[m[2]] || 'guest';
    return { slug, fallbackOrder: Number(m[1]), fallbackDisplay: `#${m[1]}` };
  }
  return { slug: 'guest', fallbackOrder: 0, fallbackDisplay: '?' };
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
try {
  execFileSync('zip', ['-v'], { stdio: 'ignore' });
} catch {
  console.error('zip לא מותקן.');
  process.exit(1);
}

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
    const { slug, fallbackDisplay } = slugOf(f);
    total += d;
    console.log(`  ${String(n).padStart(2)}. ${hhmmss(d).slice(3)}  ${slug.padEnd(18)} ${fallbackDisplay.padEnd(6)}   ${f}`);
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

console.log(`\n── שלב 1: תיקון ומדידה (${files.length} קבצים) ──`);
const clips = [];
let totalFixed = 0;
let idx = 0;
for (const f of files) {
  idx++;
  if (skipNums.has(idx)) { console.log(`  ${String(idx).padStart(2)}. ${f.slice(0, 40)} — הושמט`); continue; }
  const raw = fs.readFileSync(path.join(srcDir, f));
  const { buf, fixed } = repairAndMeasure(raw);
  const dest = path.join(prepDir, f);
  fs.writeFileSync(dest, buf);
  totalFixed += fixed;
  const { seconds, createdAt } = probeMeta(dest);
  const { slug, fallbackOrder, fallbackDisplay } = slugOf(f);
  const order = createdAt ?? fallbackOrder;
  const timeLabel = createdAt ? israelTime(createdAt) : fallbackDisplay;
  clips.push({ file: dest, name: f, slug, order, timeLabel, seconds });
  if (fixed) console.log(`  ${f.slice(0, 34).padEnd(36)} תוקנו ${fixed} · ${hhmmss(seconds)}`);
}
console.log(`  סה"כ תוקנו ${totalFixed} משכים פגומים${skipNums.size ? ` · הושמטו ${skipNums.size} קטעים` : ''}`);

console.log('\n── שלב 2: סידור לפי תבנית ──');
const used = new Set();
const shorts = clips.filter((c) => c.seconds < INTERSTITIAL_MAX_SEC);
shorts.forEach((c) => used.add(c.file));

const timeline = [];
for (const block of TEMPLATE) {
  const inBlock = clips
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
const rest = clips.filter((c) => !used.has(c.file) && !shorts.includes(c));
const leftovers = [...rest, ...shorts].sort((a, b) => a.order - b.order);
if (leftovers.length) {
  // אם הבלוק האחרון כבר נושא את אותו שם — מאחדים במקום ליצור פרק כפול
  const last = [...timeline].reverse().find((s) => s.chapter);
  if (last && last.chapter === 'ועוד') last.clips.push(...leftovers);
  else timeline.push({ chapter: 'לסיום', clips: leftovers });
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
// בלי דחיסה (-0): הווידאו כבר דחוס, DEFLATE רק מבזבז זמן. ראו src/lib/zip.ts.
const zipFile = path.join(outDir, path.basename(final, '.mp4') + '.zip');
fs.rmSync(zipFile, { force: true });
execFileSync('zip', ['-j', '-0', zipFile, final], { stdio: ['ignore', 'ignore', 'pipe'] });

const mb = fs.statSync(final).size / 1048576;
console.log(`\n✅ נוצר: ${final}`);
console.log(`   ${mb.toFixed(0)} מ"ב · ${hhmmss(at)} · ${ordered.length} קטעים · ${timeline.filter((s) => s.chapter).length} פרקים`);
console.log(`   זיפ: ${zipFile}`);
console.log(`   רשימת זמנים: ${path.join(outDir, 'רשימת_זמנים.txt')}\n`);
