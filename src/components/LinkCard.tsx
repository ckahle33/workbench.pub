import { useEffect, useState } from 'react';
import { api, safeHttpUrl, type Card } from '../api';

const REL = 'noopener noreferrer nofollow';

/** A link with a preview from /api/card. While loading, on failure, or without a preview it is a plain link. */
export function LinkCard({ url, title }: { url: string; title?: string }) {
  const href = safeHttpUrl(url);
  const [card, setCard] = useState<{ url: string; card: Card } | null>(null);

  useEffect(() => {
    if (!href) return;
    let cancelled = false;
    api
      .get<Card>(`/api/card?url=${encodeURIComponent(href)}`)
      .then((c) => !cancelled && setCard({ url: href, card: c }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [href]);

  // Not http(s): show the text, never a clickable link.
  if (!href) return <span className="link-plain" dir="auto">{url}</span>;

  const c = card && card.url === href ? card.card : null;
  if (!c || (!c.title && !c.description && !c.image)) {
    return (
      <a className="link-plain" href={href} target="_blank" rel={REL} dir="auto">
        {title || url}
      </a>
    );
  }

  const image = safeHttpUrl(c.image);
  return (
    <a className="link-card" href={href} target="_blank" rel={REL}>
      {image && <img src={image} alt="" loading="lazy" width={96} height={96} referrerPolicy="no-referrer" />}
      <span className="link-card-text">
        <strong dir="auto">{c.title || title || url}</strong>
        {c.description && <span dir="auto">{c.description}</span>}
        {c.github && <span>{`★ ${c.github.stars}`}</span>}
        <span className="link-card-url">{new URL(href).hostname}</span>
      </span>
    </a>
  );
}
