import { useEffect, useId, useRef, useState } from 'react';
import { useSession } from '../auth/SessionContext';
import type { Session } from '../auth/oauth';
import { optimistic, type Removal } from '../optimistic';
import { deleteRecord } from '../records/write';
import { FieldError } from './Composer';

interface Props {
  /** at-uri of the record to delete; the control shows only when its repo is the signed-in DID. */
  uri: string;
  kind: Removal['kind'];
  parentUri?: string;
  /** Accessible name of the first button, e.g. "Delete update". */
  label: string;
  /** Called after the record is deleted and hidden (e.g. to leave a page that no longer exists). */
  onDeleted?: () => void;
}

function Confirmable({ session, uri, kind, parentUri, label, onDeleted }: Props & { session: Session }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const errId = `delete-err-${useId()}`;

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (returnFocus.current) startRef.current?.focus();
  }, [confirming]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteRecord(session, uri);
      optimistic.remove({ uri, kind, parentUri, did: session.did });
      onDeleted?.();
    } catch {
      setError('Could not delete. Please try again.');
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button ref={startRef} type="button" className="delete" onClick={() => setConfirming(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="delete-confirm">
      <button
        ref={confirmRef}
        type="button"
        aria-disabled={busy || undefined}
        aria-describedby={error ? errId : undefined}
        onClick={() => void confirm()}
      >
        {busy ? 'Deleting…' : 'Confirm delete'}
      </button>{' '}
      <button
        type="button"
        onClick={() => {
          if (busy) return;
          returnFocus.current = true;
          setError(null);
          setConfirming(false);
        }}
      >
        Cancel
      </button>
      <FieldError id={errId}>{error}</FieldError>
    </span>
  );
}

/** Two-step, owner-only delete for a project, update or reply. */
export function DeleteButton(props: Props) {
  const { session } = useSession();
  if (!session || props.uri.split('/')[2] !== session.did) return null;
  return <Confirmable session={session} {...props} />;
}
