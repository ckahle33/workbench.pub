import { useSyncExternalStore } from 'react';
import type { ProjectView, ReplyView, UpdateView } from './api';

/**
 * Something the signed-in user just created. Part B calls `optimistic.add` after a successful
 * write; pages show it at once and it disappears once the server returns the same `uri`.
 */
export interface OptimisticItem {
  kind: 'project' | 'update' | 'reply';
  uri: string;
  did: string;
  /** ISO datetime. */
  createdAt: string;
  /** update: at-uri of its project. */
  projectUri?: string;
  /** reply: at-uri of the update or reply it answers. */
  subjectUri?: string;
  /** project */
  title?: string;
  summary?: string;
  topicSlug?: string;
  status?: string;
  /** update */
  heading?: string;
  /** update or reply */
  body?: string;
  /** Same shape as the record: ImageDef[] / LinkDef[] / PartDef[]. */
  images?: unknown;
  links?: unknown;
  parts?: unknown;
}

/** Something the signed-in user just deleted; hidden until the server stops returning it. */
export interface Removal {
  uri: string;
  kind: OptimisticItem['kind'];
  /** update: its project; reply: what it answers. */
  parentUri?: string;
  /** project: its owner, for the profile list. */
  did?: string;
}

let items: readonly OptimisticItem[] = [];
let removed: ReadonlyMap<string, Removal> = new Map();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const newestFirst = (a: OptimisticItem, b: OptimisticItem) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

export const optimistic = {
  add(item: OptimisticItem): void {
    items = [...items.filter((i) => i.uri !== item.uri), item];
    notify();
  },

  /** Hides `r.uri` everywhere (server and optimistic items) until a page prunes it. */
  remove(r: Removal): void {
    items = items.filter((i) => i.uri !== r.uri);
    removed = new Map(removed).set(r.uri, r);
    notify();
  },

  isRemoved(uri: string): boolean {
    return removed.has(uri);
  },

  /**
   * Optimistic items (optionally only those passing `match`) first, newest first, then the
   * server items. An optimistic item whose uri the server already returned is dropped, and
   * removed uris are left out. Pure: neither the store nor the input is changed.
   */
  mergeWith<T extends { uri: string }>(serverItems: readonly T[], match: (i: OptimisticItem) => boolean = () => true): (T | OptimisticItem)[] {
    const seen = new Set(serverItems.map((s) => s.uri));
    const mine = items.filter((i) => !seen.has(i.uri) && match(i)).sort(newestFirst);
    return [...mine, ...serverItems.filter((s) => !removed.has(s.uri))];
  },

  /**
   * Forget items the server now has. With `inScope`, also expire removals that list covers
   * (e.g. the updates of this project) once the server no longer returns them. Pages call this
   * from an effect.
   */
  prune(serverItems: readonly { uri: string }[], inScope?: (r: Removal) => boolean): void {
    const seen = new Set(serverItems.map((s) => s.uri));
    const next = items.filter((i) => !seen.has(i.uri));
    let changed = next.length !== items.length;
    items = next;
    if (inScope) {
      const keep = new Map([...removed].filter(([uri, r]) => seen.has(uri) || !inScope(r)));
      if (keep.size !== removed.size) {
        removed = keep;
        changed = true;
      }
    }
    if (changed) notify();
  },

  find(uri: string): OptimisticItem | undefined {
    return items.find((i) => i.uri === uri);
  },

  clear(): void {
    items = [];
    removed = new Map();
    notify();
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },

  getSnapshot: (): readonly OptimisticItem[] => items,
};

/** Re-renders the caller whenever the store changes. */
export function useOptimistic(): readonly OptimisticItem[] {
  return useSyncExternalStore(optimistic.subscribe, optimistic.getSnapshot);
}

const isOptimistic = (x: object): x is OptimisticItem => 'kind' in x;

export function asUpdate(x: UpdateView | OptimisticItem): UpdateView {
  if (!isOptimistic(x)) return x;
  const rkey = x.uri.split('/').pop() ?? '';
  return {
    uri: x.uri, did: x.did, rkey, projectUri: x.projectUri ?? '', heading: x.heading ?? '', body: x.body ?? '',
    images: x.images, links: x.links, parts: x.parts, createdAt: x.createdAt, indexedAt: 0,
  };
}

export function asProject(x: ProjectView | OptimisticItem): ProjectView {
  if (!isOptimistic(x)) return x;
  return {
    uri: x.uri, did: x.did, rkey: x.uri.split('/').pop() ?? '', topicSlug: x.topicSlug ?? '', title: x.title ?? '',
    summary: x.summary ?? '', status: x.status ?? 'in-progress', createdAt: x.createdAt, indexedAt: 0,
  };
}

export function asReply(x: ReplyView | OptimisticItem): ReplyView {
  if (!isOptimistic(x)) return x;
  return {
    uri: x.uri, did: x.did, rkey: x.uri.split('/').pop() ?? '', subjectUri: x.subjectUri ?? '', body: x.body ?? '',
    createdAt: x.createdAt, indexedAt: 0,
  };
}
