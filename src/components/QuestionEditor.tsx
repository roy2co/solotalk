import type { Question, Relationship } from '../types';
import { ALL_RELATIONSHIPS } from '../types';
import { newQuestion } from '../lib/questions';

interface Props {
  value: Question[];
  onChange: (questions: Question[]) => void;
  /** כמה פעמים אורחים דילגו על כל שאלה (לפי טקסט) — מוצג ליד השאלה */
  skipStats?: Record<string, number>;
  /** הקרבות שאפשר לתייג אליהן. ברירת מחדל: כל קרבות החתונה */
  relationships?: readonly Relationship[];
  /** תוויות תצוגה לקרבות (מסלול ברית) */
  labels?: Record<string, string>;
}

export default function QuestionEditor({
  value,
  onChange,
  skipStats,
  relationships = ALL_RELATIONSHIPS,
  labels,
}: Props) {
  const update = (id: string, patch: Partial<Question>) => {
    onChange(value.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  const remove = (id: string) => {
    onChange(value.filter((q) => q.id !== id));
  };

  const add = () => {
    onChange([...value, newQuestion()]);
  };

  const toggleRel = (q: Question, rel: Relationship) => {
    const has = q.relationships.includes(rel);
    update(q.id, {
      relationships: has
        ? q.relationships.filter((r) => r !== rel)
        : [...q.relationships, rel],
    });
  };

  return (
    <div className="question-editor">
      {value.map((q) => {
        const skips = skipStats?.[q.text.trim()] ?? 0;
        return (
        <div className="q-row" key={q.id}>
          <div className="q-top">
            <input
              className="q-text"
              placeholder="כתבו שאלה..."
              value={q.text}
              onChange={(e) => update(q.id, { text: e.target.value })}
            />
            {skips > 0 && (
              <span
                className="q-skips"
                title={`אורחים דילגו על השאלה הזו ${skips} פעמים`}
              >
                <span aria-hidden>⟳</span> {skips}
              </span>
            )}
            <button
              className="mini-btn danger"
              onClick={() => remove(q.id)}
              title="מחיקה"
            >
              ✕
            </button>
          </div>
          <div className="q-chips">
            <span className="q-chips-label">מתאים ל:</span>
            {relationships.map((rel) => (
              <button
                key={rel}
                className={`chip ${q.relationships.includes(rel) ? 'selected' : ''}`}
                onClick={() => toggleRel(q, rel)}
              >
                {labels?.[rel] ?? rel}
              </button>
            ))}
            {q.relationships.length === 0 && (
              <span className="q-all-hint">(מתאים לכולם)</span>
            )}
          </div>
        </div>
        );
      })}
      <button className="mini-btn outline" onClick={add}>
        + הוסף שאלה
      </button>
    </div>
  );
}
