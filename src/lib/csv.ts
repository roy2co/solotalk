import type { Question, Relationship } from '../types';
import { ALL_RELATIONSHIPS, LEGACY_RELATIONSHIP_MAP } from '../types';
import { newQuestion } from './questions';

// BOM כדי ש-Excel יזהה UTF-8 (עברית) נכון
const BOM = '﻿';

function escapeCsv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** בונה CSV משאלות: עמודת "שאלה" + עמודה לכל סוג קרבה ("כן" = מתאים) */
function questionsToCsv(questions: Question[]): string {
  const header = ['שאלה', ...ALL_RELATIONSHIPS];
  const rows = questions.map((q) => [
    q.text,
    ...ALL_RELATIONSHIPS.map((r) => (q.relationships.includes(r) ? 'כן' : '')),
  ]);
  return (
    BOM +
    [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\r\n')
  );
}

/** תבנית לדוגמה להורדה - מראה בדיוק איפה כותבים שאלה ואיפה מסמנים קרבה */
export function templateCsv(): string {
  const examples: Question[] = [
    { id: '', text: 'איך הכרתם את בני הזוג?', relationships: ['מלווים של הזוג', 'חברים/חברות מהעבודה'] },
    { id: '', text: 'ספרו זיכרון ילדות משותף', relationships: ['משפחה', 'הורים'] },
    { id: '', text: 'תנו ברכה קצרה מהלב', relationships: [] },
  ];
  return questionsToCsv(examples);
}

/** פרסר CSV שמכבד מרכאות (שאלות עם פסיקים) */
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function isMarked(v: string): boolean {
  const t = (v ?? '').trim().toLowerCase();
  return t !== '' && t !== '0' && t !== 'לא' && t !== 'no' && t !== 'false';
}

/** ממיר CSV לשאלות. עמודת השאלה = "שאלה" (או הראשונה); עמודות הקרבה לפי הכותרות */
export function csvToQuestions(text: string): Question[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const qCol = header.findIndex((h) => h === 'שאלה');
  const questionCol = qCol >= 0 ? qCol : 0;

  // מזהה גם כותרות בשמות הקטגוריות הישנים, כדי שקובץ CSV שיוצא
  // מגרסה קודמת עדיין ייובא נכון ולא יאבד עמודות בשקט
  const relCols = header
    .map((h, idx) => {
      const direct = ALL_RELATIONSHIPS.find((r) => r === h);
      return { idx, rel: direct ?? LEGACY_RELATIONSHIP_MAP[h] };
    })
    .filter((c): c is { idx: number; rel: Relationship } => Boolean(c.rel));

  return rows
    .slice(1)
    .map((r) => {
      const textVal = (r[questionCol] ?? '').trim();
      const rels = relCols
        .filter((rc) => isMarked(r[rc.idx]))
        .map((rc) => rc.rel);
      return newQuestion(textVal, rels);
    })
    .filter((q) => q.text);
}
