export interface Size {
  width: number;
  height: number;
}

/**
 * Scales (w, h) so the longest edge is at most maxEdge, keeping aspect ratio.
 * Never upscales. Throws RangeError on non-positive or non-finite input.
 */
export function fitWithin(w: number, h: number, maxEdge: number): Size {
  if (![w, h, maxEdge].every((n) => Number.isFinite(n) && n > 0)) {
    throw new RangeError('Image dimensions must be positive numbers');
  }
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** Seam over the browser's decode and canvas APIs so tests can stub them. */
export interface ImageBackend {
  decode(file: File): Promise<{ width: number; height: number; source: unknown }>;
  encode(source: unknown, size: Size, mime: string, quality: number): Promise<Blob>;
}

export const browserBackend: ImageBackend = {
  async decode(file) {
    const bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height, source: bitmap };
  },
  async encode(source, { width, height }, mime, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process this image');
    ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process this image'))), mime, quality);
    });
  },
};

/**
 * Downscales an image so its longest edge is at most maxEdge and re-encodes it
 * as JPEG (always, including PNG/WebP input, so output size is predictable;
 * transparency becomes black, which is acceptable for build photos). Drawing
 * onto a canvas drops EXIF and other metadata, including GPS location.
 */
export async function resizeImage(
  file: File,
  maxEdge = 1600,
  backend: ImageBackend = browserBackend,
): Promise<Blob> {
  try {
    const { width, height, source } = await backend.decode(file);
    return await backend.encode(source, fitWithin(width, height, maxEdge), 'image/jpeg', 0.85);
  } catch {
    throw new Error('Could not process this image');
  }
}
