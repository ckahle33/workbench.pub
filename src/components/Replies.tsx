import { Link } from 'react-router-dom';
import type { ReplyView } from '../api';
import { DeleteButton } from './DeleteButton';
import { DateText } from './Timeline';
import { Status } from './Status';

const MAX_DEPTH = 4;

/** Read-only thread, oldest first. Nested replies are indented by how deep they sit under the update. */
export function Replies({ replies, rootUri }: { replies: ReplyView[]; rootUri: string }) {
  if (replies.length === 0) return <Status kind="empty">No replies yet.</Status>;
  const parent = new Map(replies.map((r) => [r.uri, r.subjectUri]));
  const depth = (r: ReplyView): number => {
    let d = 0;
    for (let s = r.subjectUri; s !== rootUri && parent.has(s) && d < MAX_DEPTH; s = parent.get(s)!) d++;
    return d;
  };
  const ordered = [...replies].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return (
    <ol className="replies">
      {ordered.map((r) => (
        <li key={r.uri} className={depth(r) > 0 ? 'is-nested' : undefined} style={{ marginInlineStart: `${depth(r) * 1.5}rem` }}>
          <p className="reply-meta">
            <Link to={`/profile/${r.did}`} className="did">{r.did}</Link>
            <DateText iso={r.createdAt} />
          </p>
          <p className="notes" dir="auto">{r.body}</p>
          <DeleteButton uri={r.uri} kind="reply" parentUri={r.subjectUri} label="Delete reply" />
        </li>
      ))}
    </ol>
  );
}
