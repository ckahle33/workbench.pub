import { useId, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { logFailure } from '../records/errors';
import { afterWrite, FieldError, GENERIC_ERROR, TextField } from './Composer';

const REASON_MAX = 500;
export const REPORTED_KEY = 'wb.reported';
export const REPORTED_MAX = 200;

function reportedList(): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(REPORTED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Remembered in this browser (the most recent REPORTED_MAX posts) so the same post is not reported twice by accident. */
function wasReported(uri: string): boolean {
  return reportedList().includes(uri);
}

function remember(uri: string): void {
  window.localStorage.setItem(REPORTED_KEY, JSON.stringify([...reportedList().filter((u) => u !== uri), uri].slice(-REPORTED_MAX)));
}

function message(e: unknown): string {
  const status = e instanceof ApiError ? e.status : 0;
  if (status === 429) return 'This has already been reported, or too many reports have been sent today. Please try again later.';
  if (status === 503) return 'Reporting is temporarily unavailable. Please try again later.';
  if (status === 400) return 'Your report could not be sent. Check the reason and try again.';
  return GENERIC_ERROR;
}

/** Anyone may report a post; the reason is optional and capped at 500 characters. */
export function ReportButton({ uri }: { uri: string }) {
  // Keyed by uri so a reused instance never carries another post's state.
  return <ReportForm key={uri} uri={uri} />;
}

function ReportForm({ uri }: { uri: string }) {
  const panel = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(() => wasReported(uri));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/report', { uri, reason: reason.trim() });
      afterWrite(() => remember(uri));
      afterWrite(() => setSent(true));
      afterWrite(() => setOpen(false));
    } catch (err) {
      logFailure(err instanceof ApiError ? { stage: 'create', status: err.status, errorName: 'ReportFailed' } : { stage: 'create', status: 1, errorName: 'NetworkError' });
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
