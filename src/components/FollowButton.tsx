import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../auth/SessionContext';
import { clearFollow, getFollow, setFollow } from '../follows';
import { deleteRecord, followSubject } from '../records/write';
import type { Session } from '../auth/oauth';
import { FieldError } from './Composer';

interface Props {
  kind: 'topic' | 'project';
  /** Topic slug, or project at-uri. */
  subject: string;
}

function Toggle({ session, kind, subject }: Props & { session: Session }) {
  const [followUri, setFollowUri] = useState(() => getFollow(session.did, kind, subject));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (followUri) {
        await deleteRecord(session, followUri);
        clearFollow(session.did, kind, subject);
        setFollowUri(null);
      } else {
        const { uri } = await followSubject(session, kind, subject);
        setFollow(session.did, kind, subject, uri);
        setFollowUri(uri);
      }
    } catch {
      setError(followUri ? 'Could not unfollow. Please try again.' : 'Could not follow. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="follow">
      <button type="button" aria-disabled={busy || undefined} onClick={() => void toggle()}>
        {followUri ? 'Unfollow' : 'Follow'}
      </button>
      <FieldError id={`follow-err-${kind}`}>{error}</FieldError>
    </div>
  );
}

export function FollowButton(props: Props) {
  const { session, loading } = useSession();
  if (loading) return null;
  if (!session) return (
    <Link to="/signin" className="btn">
      Sign in to follow
    </Link>
  );
  return <Toggle key={`${session.did}|${props.kind}|${props.subject}`} session={session} {...props} />;
}
