import { Link } from 'react-router-dom';
import { blobUrl, parseImages, type FeedItem } from '../api';
import { Photo } from './Photo';
import { DateText } from './Timeline';

/** Stable light/dark choice per project, so a project's tiles always look the same. */
function isDark(uri: string): boolean {
  let h = 0;
  for (let i = 0; i < uri.length; i++) h = (h * 31 + uri.charCodeAt(i)) | 0;
  return (h & 1) === 0;
}

/** The poster-style stand-in for a photo: the project title set huge on black or white. */
export function TypeTile({ title, topic, uri }: { title: string; topic: string; uri: string }) {
  const long = Array.from(title).length > 36;
  return (
    <div className={`tile ${isDark(uri) ? 'tile-dark' : 'tile-light'}${long ? ' tile-long' : ''}`}>
      <span className="tile-title" dir="auto">
        {title}
      </span>
      <span className="tile-foot">
        <span dir="auto">{topic}</span>
        <span className="tile-mark" />
      </span>
    </div>
  );
}

/** A feed update as a card: 4:3 visual, mono label, project title, update heading and excerpt. */
export function FeedCard({ item: u }: { item: FeedItem }) {
  const updateHref = `/u/${u.did}/${u.rkey}`;
  const [photo] = parseImages(u.images);
  const tile = <TypeTile title={u.project.title} topic={u.project.topicSlug} uri={u.project.uri} />;
  return (
    <li className="card">
      {/* Duplicate of the heading link for pointer users; hidden from the tab order and screen readers. */}
      <Link to={updateHref} className="card-visual" tabIndex={-1} aria-hidden="true">
        {photo ? <Photo src={blobUrl(u.did, photo.cid)} alt={photo.alt} width={800} height={600} fallback={tile} /> : tile}
      </Link>
      <p className="label card-label">
        <span dir="auto">{u.project.topicSlug}</span> · <DateText iso={u.createdAt} />
      </p>
      <h3 className="card-title" dir="auto">
        <Link to={`/p/${u.project.did}/${u.project.rkey}`}>{u.project.title}</Link>
      </h3>
      <p className="card-update" dir="auto">
        <Link to={updateHref}>{u.heading}</Link>
      </p>
      {u.body && (
        <p className="excerpt" dir="auto">
          {u.body}
        </p>
      )}
    </li>
  );
}
