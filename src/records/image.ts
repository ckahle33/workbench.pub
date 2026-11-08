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

/** Input files above this are refused before decoding (a phone can decode huge photos into hundreds of MB). */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export class ImageTooLargeError extends Error {
  constructor() {
    super('This photo is too large');
    this.name = 'ImageTooLargeError';
  }
}

/** Seam over the browser's decode and canvas APIs so tests can stub them. */
export interface ImageBackend {
  decode(file: File): Promise<{ width: number; height: number; source: unknown }>;
  encode(source: unknown, size: Size, mime: string, quality: number): Promise<Blob>;
  /** Frees the decoded source (an ImageBitmap holds the full-resolution pixels until closed). */
  release?(source: unknown): void;
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
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not process this image');
      // JPEG has no alpha: paint white first so transparent PNG/WebP areas do not turn black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
      return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process this image'))), mime, quality);
      });
    } finally {
      // Release the backing store now rather than whenever the canvas is collected.
      canvas.width = 0;
      canvas.height = 0;
    }
  },
  release(source) {
    (source as { close?: () => void } | null)?.close?.();
  },
};

/**
 * Downscales an image so its longest edge is at most maxEdge and re-encodes it
 * as JPEG (always, including PNG/WebP input, so output size is predictable;
 * transparent areas become white). Drawing onto a canvas drops EXIF and other
 * metadata, including GPS location. Throws ImageTooLargeError for files over
 * MAX_INPUT_BYTES (before decoding), else a plain safe Error on failure.
 */
export async function resizeImage(
  file: File,
  maxEdge = 1600,
  backend: ImageBackend = browserBackend,
): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) throw new ImageTooLargeError();
  let source: unknown;
  try {
    const decoded = await backend.decode(file);
    source = decoded.source;
    return await backend.encode(source, fitWithin(decoded.width, decoded.height, maxEdge), 'image/jpeg', 0.85);
  } catch {
    throw new Error('Could not process this image');
  } finally {
    if (source !== undefined) backend.release?.(source);
  }
}
