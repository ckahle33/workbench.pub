import { Link } from 'react-router-dom';
import { blobUrl, parseImages, parseLinks, parseParts, type UpdateView } from '../api';
import { DeleteButton } from './DeleteButton';
import { LinkCard } from './LinkCard';

export function DateText({ iso }: { iso: string }) {
  const d = new Date(iso);
  const text = Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
  return <time dateTime={iso}>{text}</time>;
}

/** Newest first, as the server (or optimistic merge) ordered it. */
export function Timeline({ updates }: { updates: UpdateView[] }) {
  return (
    <ol className="timeline">
      {updates.map((u) => (
        <li key={u.uri}>
          <TimelineEntry update={u} />
        </li>
      ))}
    </ol>
  );
}

export function TimelineEntry({ update: u, headingLevel = 2 }: { update: UpdateView; headingLevel?: 1 | 2 }) {
  const images = parseImages(u.images);
  const links = parseLinks(u.links);
  const parts = parseParts(u.parts);
  const Heading = `h${headingLevel}` as const;
  const PartsHeading = headingLevel === 1 ? 'h2' : 'h3';
  return (
    <article className="update">
      <p className="meta">
        <DateText iso={u.createdAt} />
      </p>
      <Heading dir="auto">{headingLevel === 1 ? u.heading : <Link to={`/u/${u.did}/${u.rkey}`}>{u.heading}</Link>}</Heading>
      {headingLevel === 2 && (
        <div className="actions">
          <DeleteButton uri={u.uri} kind="update" parentUri={u.projectUri} label="Delete update" />
        </div>
      )}
      {images.length > 0 && (
        <div className="photos">
          {images.map((img, i) => (
            <img key={`${img.cid}-${i}`} src={blobUrl(u.did, img.cid)} alt={img.alt} width={800} height={600} loading="lazy" />
          ))}
        </div>
      )}
      {u.body && <p className="notes" dir="auto">{u.body}</p>}
      {parts.length > 0 && (
        <>
          <PartsHeading>Parts</PartsHeading>
          <ul className="parts">
            {parts.map((p, i) => (
              <li key={i} dir="auto">
                {p.quantity ? `${p.quantity} × ` : ''}
                {p.item}
                {p.note ? ` (${p.note})` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
      {links.length > 0 && (
        <ul className="links">
          {links.map((l, i) => (
            <li key={`${l.url}-${i}`}>
              <LinkCard url={l.url} title={l.title} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
