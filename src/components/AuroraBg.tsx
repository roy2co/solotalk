/**
 * AuroraBg - רקע חי מונפש בסגנון "אורורה צפונית"
 * סרטים של גרדיאנט זורמים על כל המסך, מתוך בעיצוב Liquid Glass.
 * מאחורי כל המסכים; מרונדר פעם אחת ב-App.tsx.
 */

export default function AuroraBg() {
  return (
    <div className="aurora-container">
      {/* שכבה 1 - סרט עם גוונים ראשיים */}
      <div className="aurora-ribbon r1" />

      {/* שכבה 2 - סרט עם גוונים משלימים */}
      <div className="aurora-ribbon r2" />

      {/* שכבה 3 - סרט עמוק יותר */}
      <div className="aurora-ribbon r3" />

      {/* שכבה 4 - סרט דק ומהיר */}
      <div className="aurora-ribbon r4" />

      {/* גרגר טקסטורה - עדינות */}
      <div className="aurora-grain" />

      {/* רשת עדינה */}
      <div className="aurora-grid" />

      {/* נצנוצים - כוכבים דקוקים */}
      <div className="aurora-sparks">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="spark" style={{ '--delay': `${i * 0.4}s` } as any} />
        ))}
      </div>
    </div>
  );
}
