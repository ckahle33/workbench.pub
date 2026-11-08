import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Page } from './api';

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · workbench.pub` : 'workbench.pub';
  }, [title]);
}

export type Fetched<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'notfound' } | { state: 'error' };

const failure = (e: unknown): Fetched<never> => (e instanceof ApiError && e.status === 404 ? { state: 'notfound' } : { state: 'error' });

/** One GET, re-run when `path` changes. */
export function useApi<T>(path: string): Fetched<T> {
  const [res, setRes] = useState<{ path: string; value: Fetched<T> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<T>(path)
      .then((data) => !cancelled && setRes({ path, value: { state: 'ready', data } }))
      .catch((e) => !cancelled && setRes({ path, value: failure(e) }));
    return () => {
      cancelled = true;
    };
  }, [path]);
  return res && res.path === path ? res.value : { state: 'loading' };
}

export const PAGE_SIZE = 20;
/** After the first request, how many more to make while a page is short and a cursor remains. */
export const MAX_RETRIES = 5;

interface Pulled<R> {
  first: R;
  items: R extends Page<infer T> ? T[] : never;
  cursor: string | null;
}

const withParams = (path: string, cursor: string | null, size: number) =>
  `${path}${path.includes('?') ? '&' : '?'}limit=${size}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;

/**
 * Fetches one "load": a page, then (because the server scans a bounded window and may return
 * short or empty pages with a cursor) up to MAX_RETRIES more while the page is short. Cursors
 * are opaque and passed back untouched.
 */
async function pull<T extends { uri: string }, R extends Page<T>>(path: string, from: string | null, size: number): Promise<Pulled<R>> {
  let cursor = from;
  let first: R | undefined;
  const items: T[] = [];
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await api.get<R>(withParams(path, cursor, size));
    first ??= res;
    items.push(...res.items);
    cursor = res.cursor;
    if (!cursor || items.length >= size) break;
  }
  return { first: first as R, items: items as Pulled<R>['items'], cursor };
}

interface PagedState<T, R> {
  path: string;
  phase: 'ready' | 'error' | 'notfound';
  items: T[];
  cursor: string | null;
  first: R | null;
  loadingMore: boolean;
  moreFailed: boolean;
}

export interface Paged<T, R> {
  phase: 'loading' | 'ready' | 'error' | 'notfound';
  items: T[];
  /** The first response, for extra fields such as `topic` or `profile`. */
  first: R | null;
  hasMore: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
  loadMore: () => void;
}

const dedupe = <T extends { uri: string }>(list: T[]): T[] => {
  const seen = new Set<string>();
  return list.filter((i) => !seen.has(i.uri) && seen.add(i.uri));
};

/** Cursor-paginated list. `path` must not already carry limit or cursor. */
export function usePaged<T extends { uri: string }, R extends Page<T> = Page<T>>(path: string, size = PAGE_SIZE): Paged<T, R> {
  const [state, setState] = useState<PagedState<T, R> | null>(null);

  useEffect(() => {
    let cancelled = false;
    pull<T, R>(path, null, size)
      .then((r) => !cancelled && setState({ path, phase: 'ready', items: dedupe(r.items), cursor: r.cursor, first: r.first, loadingMore: false, moreFailed: false }))
      .catch((e) => {
        if (cancelled) return;
        const phase = failure(e).state === 'notfound' ? 'notfound' : 'error';
        setState({ path, phase, items: [], cursor: null, first: null, loadingMore: false, moreFailed: false });
      });
    return () => {
      cancelled = true;
    };
  }, [path, size]);

  const cur = state && state.path === path ? state : null;
  const cursor = cur?.cursor ?? null;
  const busy = cur?.loadingMore ?? false;

  const loadMore = useCallback(() => {
    if (!cursor || busy) return;
    const patch = (p: Partial<PagedState<T, R>>) => setState((s) => (s && s.path === path ? { ...s, ...p } : s));
    patch({ loadingMore: true, moreFailed: false });
    pull<T, R>(path, cursor, size)
      .then((r) => setState((s) => (s && s.path === path ? { ...s, items: dedupe([...s.items, ...r.items]), cursor: r.cursor, loadingMore: false } : s)))
      .catch(() => patch({ loadingMore: false, moreFailed: true }));
  }, [path, cursor, busy, size]);

  return {
    phase: cur?.phase ?? 'loading',
    items: cur?.items ?? [],
    first: cur?.first ?? null,
    hasMore: cursor !== null,
    loadingMore: busy,
    moreFailed: cur?.moreFailed ?? false,
    loadMore,
  };
}
