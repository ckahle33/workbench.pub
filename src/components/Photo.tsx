import { useState, type ReactNode } from 'react';

interface Props {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  /** Shown instead of the image when it fails to load; defaults to a labelled grey panel. */
  fallback?: ReactNode;
}

/** A lazy image that swaps itself for a fallback when the blob proxy cannot serve it. */
export function Photo({ src, alt, width, height, className, fallback }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) {
    return (
      fallback ?? (
        <div className="photo-missing" role="img" aria-label={alt || 'Photo'}>
          <span className="label">Photo unavailable</span>
          {alt && <span className="photo-missing-alt" dir="auto">{alt}</span>}
        </div>
      )
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(src)}
    />
  );
}
