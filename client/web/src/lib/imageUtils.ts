export interface CompressImageOptions {
  maxDimension?: number;
  quality?: number;
}

/**
 * Resizes non-GIF raster images proportionally within `maxDimension` on an
 * offscreen canvas and encodes as JPEG so high-resolution photos stay well under
 * serverless payload limits.
 */
export async function compressImageFile(
  file: File | Blob,
  options: CompressImageOptions = {},
): Promise<Blob> {
  const { maxDimension = 1600, quality = 0.85 } = options;

  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return file;
  }

  let objectUrl = '';
  try {
    objectUrl = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode image'));
      el.src = objectUrl;
    });

    const natW = img.naturalWidth || img.width;
    const natH = img.naturalHeight || img.height;
    if (!natW || !natH) return file;

    const scale = Math.min(1, maxDimension / Math.max(natW, natH));
    const targetW = Math.max(1, Math.round(natW * scale));
    const targetH = Math.max(1, Math.round(natH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    // Fill white behind transparent PNG/WebP before JPEG conversion
    if (file.type === 'image/png' || file.type === 'image/webp') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, targetW, targetH);
    }

    ctx.drawImage(img, 0, 0, targetW, targetH);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    return blob || file;
  } catch {
    return file;
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}
