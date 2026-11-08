import { useState, type FormEvent } from 'react';
import { useSession } from '../auth/SessionContext';
import { optimistic } from '../optimistic';
import { createReply } from '../records/write';
import { LIMITS } from '../../shared/lexicons';
import { TextField, writeErrorMessage } from './Composer';

/** Reply form for the signed-in user; renders nothing when signed out. */
export function ReplyBox({ subjectUri }: { subjectUri: string }) {
  const { session } = useSession();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!session) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!session || busy) return;
    const text = body.trim();
    if (!text) {
      setError('Write something before posting your reply.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { uri } = await createReply(session, { subject: subjectUri, body: text });
      optimistic.add({ kind: 'reply', uri, did: session.did, subjectUri, body: text, createdAt: new Date().toISOString() });
      setBody('');
    } catch (err) {
      setError(writeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="reply-box">
      <TextField label="Your reply" value={body} onChange={setBody} max={LIMITS.replyBody} multiline error={error ?? undefined} />
      <button type="submit" disabled={busy}>
        {busy ? 'Posting…' : 'Post reply'}
      </button>
    </form>
  );
}
