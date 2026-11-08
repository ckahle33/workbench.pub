import { Link } from 'react-router-dom';
import type { Author } from '../api';

/** Handle if known, else the DID, linking to the profile. */
export function AuthorName({ author }: { author: Author }) {
  return (
    <Link to={`/profile/${author.did}`} className="did" dir="auto">
      {author.handle ? `@${author.handle}` : author.did}
    </Link>
  );
}
