import { Link } from 'react-router-dom';
import { blobUrl, parseImages, parseLinks, parseParts, type UpdateView } from '../api';
import { formatDate } from '../format';
import { DeleteButton } from './DeleteButton';
import { LinkCard } from './LinkCard';
import { Photo } from './Photo';

const pad = (n: number) => String(n).padStart(2, '0');

export function DateText({ iso }: { iso: string }) {
  return <time dateTime={iso}>{formatDate(iso)}</time>;
}

export interface NumberedUpdate {
  update: UpdateView;
  /** Sequence number in the project, oldest = 1; undefined when unknown. */
  n?: number;
}

/** Newest first, as the server (or optimistic merge) ordered it. The newest entry's numeral is red. */
export function Timeline({ entries }: { entries: NumberedUpdate[] }) {
  return (
    <ol className="timeline" aria-label="Updates, newest first">
      {entries.map(({ update, n }, i) => (
        <li key={update.uri}>
          <TimelineEntry update={update} n={n} newest={i === 0} />
        </li>
      ))}
    </ol>
  );
}

interface EntryProps {
  update: UpdateView;
  headingLevel?: 1 | 2;
  n?: number;
  newest?: boolean;
}

export function TimelineEntry({ update: u, headingLevel = 2, n, newest }: EntryProps) {
  const images = parseImages(u.images);
  const links = parseLinks(u.links);
  const parts = parseParts(u.parts);
  const Heading = `h${headingLevel}` as const;
  const PartsHeading = headingLevel === 1 ? 'h2' : 'h3';
  const inList = headingLevel === 2;
  return (
    <article className={`entry${inList ? '' : ' entry-single'}`}>
      {inList && (
        <p className={`entry-num${newest ? ' is-newest' : ''}`}>
          {n !== undefined && (
            <>
              <span className="visually-hidden">Update </span>
              {pad(n)}
            </>
          )}
        </p>
      )}
      <div className="entry-body">
        <div className="entry-head">
          <Heading dir="auto">{inList ? <Link to={`/u/${u.did}/${u.rkey}`}>{u.heading}</Link> : u.heading}</Heading>
          <span className="entry-date">
            <DateText iso={u.createdAt} />
          </span>
        </div>
        {u.body && <p className="notes" dir="auto">{u.body}</p>}
        {images.length > 0 && (
          <div className={`photos photos-${Math.min(images.length, 2)}`}>
            {images.map((img, i) => (
              <Photo key={`${img.cid}-${i}`} src={blobUrl(u.did, img.cid)} alt={img.alt} width={800} height={600} />
            ))}
          </div>
        )}
        {parts.length > 0 && (
          <div className="entry-parts">
            <PartsHeading className="label">Parts</PartsHeading>
            <ul className="parts">
              {parts.map((p, i) => (
                <li key={i}>
                  <span className="parts-qty" dir="auto">{p.quantity ? `${p.quantity} ×` : ''}</span>
                  <span dir="auto">
                    {p.item}
                    {p.note ? ` (${p.note})` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
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
        {inList && (
          <div className="entry-foot">
            <Link to={`/u/${u.did}/${u.rkey}`}>
              Replies<span className="visually-hidden" dir="auto">{` to ${u.heading}`}</span>
            </Link>
            <DeleteButton uri={u.uri} kind="update" parentUri={u.projectUri} label="Delete update" />
          </div>
        )}
      </div>
    </article>
  );
}
