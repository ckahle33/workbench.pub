import { useState, type FormEvent } from 'react';
import { useSession } from '../auth/SessionContext';
import { optimistic } from '../optimistic';
import { createReply } from '../records/write';
import { LIMITS } from '../../shared/lexicons';
import { afterWrite, POSTED_TEXT, TextField, writeErrorMessage } from './Composer';

/** Reply form for the signed-in user; renders nothing when signed out. */
export function ReplyBox({ subjectUri }: { subjectUri: string }) {
  const { session } = useSession();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(false);
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
    setPosted(false);
    setBusy(true);
    let uri: string;
    try {
      ({ uri } = await createReply(session, { subject: subjectUri, body: text }));
    } catch (err) {
      setError(writeErrorMessage(err, 'post your reply'));
      setBusy(false);
      return;
    }
    // Saved. Clear the box first so a retry cannot post the same text again.
    afterWrite(() => setBody(''));
    afterWrite(() => optimistic.add({ kind: 'reply', uri, did: session.did, subjectUri, body: text, createdAt: new Date().toISOString() }));
    afterWrite(() => setPosted(true));
    afterWrite(() => setBusy(false));
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="reply-box">
      <TextField label="Your reply" value={body} onChange={setBody} max={LIMITS.replyBody} multiline error={error ?? undefined} />
      {posted && <p role="status" className="meta">{POSTED_TEXT}</p>}
      <button type="submit" aria-disabled={busy || undefined}>
        {busy ? 'Posting…' : 'Post reply'}
      </button>
    </form>
  );
}
