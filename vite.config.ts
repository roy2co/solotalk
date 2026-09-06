import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json' with { type: 'json' }

/**
 * הגרסה מוזרקת מ-`package.json` בזמן בנייה — מקור אמת יחיד.
 * מוצגת בדשבורד תחת «הגדרות», כדי שאפשר יהיה לוודא **על האייפד עצמו**
 * איזו גרסה רצה, בלי מחשב ובלי לנחש אם הפריסה תפסה.
 */

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    /**
     * חותמת בנייה — **המזהה האמין**.
     *
     * מספר הגרסה נלקח מ-`package.json` וצריך עדכון ידני, ולכן הוא כבר
     * פיגר פעם אחת: נפרסה גרסה חדשה והדשבורד הציג את הישנה. חותמת
     * הבנייה משתנה לבד בכל בנייה, ולכן היא זו שמוכיחה שפריסה תפסה.
     */
    __BUILD_ID__: JSON.stringify(
      new Date().toLocaleString('sv-SE').slice(5, 16).replace('T', ' '),
    ),
  },
  plugins: [react()],
  server: {
    // Vite לא קורא PORT מעצמו. בלי זה, כשהפורט תפוס הוא קופץ לבא בתור בשקט
    // וכלי התצוגה המקדימה מצביע לפורט הלא נכון.
    port: Number(process.env.PORT) || 5173,
  },
})
