import type { ImageDef } from '../../shared/types';

/** A CID may arrive as a string or as a CID object; only a real cid string is usable. */
function cidString(v: unknown): string | null {
  if (typeof v === 'string') return v || null;
  if (typeof v === 'object' && v !== null && typeof (v as { toString?: unknown }).toString === 'function') {
    const s = String(v);
    return s && s !== '[object Object]' ? s : null;
  }
  return null;
}

/**
 * Normalises uploaded image definitions into JSON form, with `image.ref.$link` as a plain string
 * (the shape the read API and optimistic store use). Entries without a usable cid are dropped.
 */
export function plainImages(images: unknown): ImageDef[] {
  if (!Array.isArray(images)) return [];
  return images.flatMap((d): ImageDef[] => {
    if (typeof d !== 'object' || d === null) return [];
    const img = (d as { image?: { ref?: { $link?: unknown }; mimeType?: unknown; size?: unknown } }).image;
    const ref = img?.ref;
    const cid = cidString(ref?.$link) ?? cidString(ref);
    if (!cid) return [];
    const alt = (d as { alt?: unknown }).alt;
    return [
      {
        image: {
          $type: 'blob',
          ref: { $link: cid },
          mimeType: typeof img?.mimeType === 'string' ? img.mimeType : 'image/jpeg',
          size: typeof img?.size === 'number' ? img.size : 0,
        },
        alt: typeof alt === 'string' ? alt : '',
      },
    ];
  });
}
