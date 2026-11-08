import { Link } from 'react-router-dom';
import type { Author } from '../api';

/** Two letters for the avatar circle: initials of a display name, else the start of the handle or DID. */
export function initials(a: Author): string {
  const words = (a.displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
  const base = words[0] ?? a.handle ?? a.did.replace(/^did:[a-z]+:/, '');
  return Array.from(base.replace(/^@/, '')).slice(0, 2).join('').toUpperCase();
}

/** Black circle with initials, name and handle, linking to the profile. */
export function AuthorBlock({ author }: { author: Author }) {
  const handle = author.handle ? `@${author.handle}` : null;
  const name = author.displayName || handle || author.did;
  return (
    <Link to={`/profile/${author.did}`} className="author">
      <span className="avatar" aria-hidden="true">
        {initials(author)}
      </span>
      <span className="author-text">
        <span className="author-name" dir="auto">{name}</span>
        {author.displayName && handle && <span className="author-handle" dir="auto">{handle}</span>}
      </span>
    </Link>
  );
}
