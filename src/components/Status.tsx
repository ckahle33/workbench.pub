import type { ReactNode } from 'react';

type Kind = 'loading' | 'error' | 'empty' | 'notfound';

const DEFAULT_TEXT: Record<Kind, string> = {
  loading: 'Loading…',
  error: 'Something went wrong. Please try again.',
  empty: 'Nothing here yet.',
  notfound: 'Not found.',
};

/** Loading, error, empty and not-found messages. Errors are announced to screen readers. */
export function Status({ kind, children }: { kind: Kind; children?: ReactNode }) {
  const role = kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined;
  return (
    <p className={`status status-${kind}`} role={role}>
      {children ?? DEFAULT_TEXT[kind]}
    </p>
  );
}

export function LoadMore({ label = 'Load more', hasMore, loading, failed, onClick }: { label?: string; hasMore: boolean; loading: boolean; failed: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="load-more">
      {failed && <Status kind="error" />}
      <button type="button" onClick={onClick} disabled={loading}>
        {loading ? 'Loading…' : label}
      </button>
    </div>
  );
}
