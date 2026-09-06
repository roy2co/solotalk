// מקטין תמונה שהמשתמש העלה לפני שמירה כ-data URL,
// כדי לא לחרוג ממכסת localStorage (data URL של תמונת טלפון מלאה יכול להיות כמה MB).

interface Options {
  maxDim: number;
  mime: 'image/jpeg' | 'image/png';
  quality?: number;
}

export function downscaleImage(file: File, opts: Options): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const max = Math.max(width, height);
      if (max > opts.maxDim) {
        const scale = opts.maxDim / max;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no canvas context'));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL(opts.mime, opts.quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('failed to load image'));
    };
    img.src = url;
  });
}
