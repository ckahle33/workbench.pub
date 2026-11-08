import type { ReactNode } from 'react';

type Kind = 'loading' | 'error' | 'empty' | 'notfound';

const DEFAULT_TEXT: Record<Kind, string> = {
  loading: 'Loading…',
  error: 'Something went wrong. Please try again.',
  empty: 'Nothing here yet.',
  notfound: 'Not found.',
};

/**
 * Loading, error, empty and not-found messages. Errors are announced to screen readers. Empty and
 * not-found states sit in a box, with the next action (`action`) beside the sentence.
 */
export function Status({ kind, children, action }: { kind: Kind; children?: ReactNode; action?: ReactNode }) {
  const text = children ?? DEFAULT_TEXT[kind];
  if (kind === 'empty' || kind === 'notfound') {
    return (
      <div className={`status status-${kind} state-panel`}>
        <p>{text}</p>
        {action}
      </div>
    );
  }
  return (
    <p className={`status status-${kind} ${kind === 'error' ? 'state-error' : 'state-loading'}`} role={kind === 'error' ? 'alert' : 'status'}>
      {text}
    </p>
  );
}

export function LoadMore({ label = 'Load more', hasMore, loading, failed, onClick }: { label?: string; hasMore: boolean; loading: boolean; failed: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="load-more">
      {failed && <Status kind="error" />}
      <button type="button" onClick={loading ? undefined : onClick} aria-disabled={loading || undefined}>
        {loading ? 'Loading…' : label}
      </button>
    </div>
  );
}
