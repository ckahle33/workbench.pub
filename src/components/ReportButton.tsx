import { useId, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { FieldError, GENERIC_ERROR, TextField } from './Composer';

const REASON_MAX = 500;

function message(e: unknown): string {
  const status = e instanceof ApiError ? e.status : 0;
  if (status === 429) return 'This has already been reported, or too many reports have been sent today. Please try again later.';
  if (status === 503) return 'Reporting is temporarily unavailable. Please try again later.';
  if (status === 400) return 'Your report could not be sent. Check the reason and try again.';
  return GENERIC_ERROR;
}

/** Anyone may report a post; the reason is optional and capped at 500 characters. */
export function ReportButton({ uri }: { uri: string }) {
  const panel = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/report', { uri, reason: reason.trim() });
      setSent(true);
      setOpen(false);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <p className="meta" role="status">Thanks, your report was sent.</p>;
  return (
    <div className="report">
      <button type="button" className="btn-text" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)}>
        Report
      </button>
      {open && (
        <form id={panel} className="report-form" onSubmit={(e) => void onSubmit(e)} noValidate>
          <TextField label="Reason (optional)" value={reason} onChange={setReason} max={REASON_MAX} multiline />
          <FieldError id={`${panel}-err`}>{error}</FieldError>
          <button type="submit" aria-disabled={busy || undefined}>
            {busy ? 'Sending…' : 'Send report'}
          </button>
        </form>
      )}
    </div>
  );
}
