/** Thin JSON client over fetch. The fetch implementation is replaceable so tests never hit the network. */

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`request failed: ${status}`);
  }
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchFn = (input, init) => fetch(input, init);
let impl: FetchFn = defaultFetch;

export const api = {
  /** GET a JSON path such as `/api/feed`. Throws ApiError on a non-2xx status. */
  async get<T>(path: string): Promise<T> {
    const res = await impl(path, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new ApiError(res.status);
    return (await res.json()) as T;
  },
  /** Test seam: replace the fetch implementation; pass null to restore the default. */
  setFetch(fn: FetchFn | null): void {
    impl = fn ?? defaultFetch;
  },
};

// ---- Response shapes (mirror functions/api/read.ts) ---------------------------

export interface Page<T> {
  items: T[];
  cursor: string | null;
}

export interface Author {
  did: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
}

export interface UpdateView {
  uri: string;
  did: string;
  rkey: string;
  projectUri: string;
  heading: string;
  body: string;
  images?: unknown;
  links?: unknown;
  parts?: unknown;
  createdAt: string;
  indexedAt: number;
}

export interface FeedItem extends UpdateView {
  project: { uri: string; did: string; rkey: string; title: string; topicSlug: string };
}

export interface ProjectView {
  uri: string;
  did: string;
  rkey: string;
  topicSlug: string;
  title: string;
  summary: string;
  status: string;
  cover?: unknown;
  createdAt: string;
  indexedAt: number;
}

export interface ReplyView {
  uri: string;
  did: string;
  rkey: string;
  subjectUri: string;
  body: string;
  createdAt: string;
  indexedAt: number;
}

export interface TopicInfo {
  slug: string;
  name: string;
  description: string;
}

export interface Card {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  github?: { name: string; description: string; stars: number; pushedAt: string };
}

// ---- Helpers ------------------------------------------------------------------

export const blobUrl = (did: string, cid: string): string => `/api/blob/${did}/${encodeURIComponent(cid)}`;

/** Returns the href only for http(s) URLs; anything else (javascript:, data:, garbage) is null. */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export interface ParsedImage {
  cid: string;
  alt: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Records are stored JSON; read them defensively. */
export function parseImages(v: unknown): ParsedImage[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((d) => {
    const ref = isObj(d) && isObj(d.image) && isObj(d.image.ref) ? d.image.ref.$link : undefined;
    return typeof ref === 'string' ? [{ cid: ref, alt: isObj(d) && typeof d.alt === 'string' ? d.alt : '' }] : [];
  });
}

export function parseLinks(v: unknown): { url: string; title?: string }[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((d) =>
    isObj(d) && typeof d.url === 'string' ? [{ url: d.url, title: typeof d.title === 'string' ? d.title : undefined }] : [],
  );
}

export function parseParts(v: unknown): { item: string; quantity?: string; note?: string }[] {
  if (!Array.isArray(v)) return [];
  const s = (x: unknown) => (typeof x === 'string' && x ? x : undefined);
  return v.flatMap((d) => (isObj(d) && typeof d.item === 'string' ? [{ item: d.item, quantity: s(d.quantity), note: s(d.note) }] : []));
}
