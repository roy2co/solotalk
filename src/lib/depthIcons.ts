import type { Depth } from '../types';

import blessing from '../assets/icons/blessing.svg';
import mic from '../assets/icons/mic.svg';
import micWaves from '../assets/icons/mic-waves.svg';

/**
 * אייקוני קו-זהב לרמת העומק, באותו קו של אייקוני הקרבה.
 * גם כאן הקבצים משמשים כ-mask ב-CSS, כך שהם נצבעים בערכת הצבע הפעילה.
 */
export const DEPTH_ICONS: Record<Depth, string> = {
  blessing,
  few: mic,
  many: micWaves,
};
