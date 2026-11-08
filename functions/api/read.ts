import { isValidDid } from '@atproto/syntax';
import { Hono } from 'hono';
import {
  decodeCursor,
  getCachedProfile,
  getProjectWithUpdates,
  getTopic,
  getUpdateWithReplies,
  hasIndexedUpdateOrReply,
  listFeed,
  listProfileProjects,
  listTopicProjects,
  listTopics,
  putProfile,
  type ListCursor,
  type ProfileRow,
} from '../../shared/db';

export interface Env {
  DB: D1Database;
  /** Workers static assets (wrangler.toml [assets]); the share-meta routes read the HTML shell from it. */
  ASSETS?: Fetcher;
  /** Cloudflare secret (`wrangler secret put ADMIN_TOKEN`). Admin routes are closed while unset or empty. */
  ADMIN_TOKEN?: string;
  /** Optional secret salt for hashing reporter IPs. */
  IP_HASH_SALT?: string;
  /** DEV ONLY: '1' serves generated placeholders for did:plc:demo... blobs (functions/api/devPlaceholder.ts). Never set in production. */
  DEV_PLACEHOLDERS?: string;
}

export interface ReadOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
  /** Profile fetch timeout; injectable for tests. */
  profileTimeoutMs?: number;
}

const PROFILE_URL = 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile';
const PROFILE_TTL_MS = 24 * 3_600_000;
const PROFILE_TIMEOUT_MS = 3_000;
/** After a failed fetch, the profile (stale or just the did) is reused for this long before retrying. */
const PROFILE_RETRY_MS = 60_000;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const PROJECT_UPDATES_LIMIT = 50;

type Profile = Omit<ProfileRow, 'fetchedAt'>;

/**
 * Cached for 24h. Any fetch failure (including the timeout) falls back to stale data, then to
 * just the did, and that fallback is remembered for PROFILE_RETRY_MS so a slow upstream is not
 * hit on every request. Callers only pass DIDs known to have indexed content.
 */
async function lookupProfile(db: D1Database, did: string, fetchFn: typeof fetch, timeoutMs: number): Promise<Profile> {
  const cached = await getCachedProfile(db, did);
  if (cached && Date.now() - cached.fetchedAt < PROFILE_TTL_MS) return strip(cached);
  try {
    const res = await fetchFn(`${PROFILE_URL}?actor=${encodeURIComponent(did)}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`getProfile ${res.status}`);
    const data = (await res.json()) as { handle?: string; displayName?: string; avatar?: string };
    const fresh: ProfileRow = {
      did,
      handle: typeof data.handle === 'string' ? data.handle : undefined,
      displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
      avatar: typeof data.avatar === 'string' ? data.avatar : undefined,
      fetchedAt: Date.now(),
    };
    await putProfile(db, fresh);
    return strip(fresh);
  } catch {
    const fallback: ProfileRow = { ...(cached ?? { did }), fetchedAt: Date.now() - PROFILE_TTL_MS + PROFILE_RETRY_MS };
    try {
      await putProfile(db, fallback);
    } catch {
      // Best effort: without the marker the next request simply retries.
    }
    return strip(fallback);
  }
}

function strip({ fetchedAt: _f, ...rest }: ProfileRow): Profile {
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as unknown as Profile;
}

/** Read-only routes; mount under `/api`. */
export function readRoutes(opts: ReadOptions = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
  const timeoutMs = opts.profileTimeoutMs ?? PROFILE_TIMEOUT_MS;

  /** Parses `limit` and `cursor`; a bad cursor is a client error. */
  const paging = (q: (k: string) => string | undefined, keyset = true, defaultLimit = DEFAULT_LIMIT): { limit: number; cursor?: ListCursor } | null => {
    const n = Number(q('limit') ?? defaultLimit);
    const limit = Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT) : defaultLimit;
    const raw = q('cursor');
    if (!raw || !keyset) return { limit };
    const cursor = decodeCursor(raw);
    return cursor ? { limit, cursor } : null;
  };

  app.get('/feed', async (c) => {
    const page = paging((k) => c.req.query(k));
    if (!page) return c.json({ error: 'bad cursor' }, 400);
    return c.json(await listFeed(c.env.DB, { ...page, followingDid: c.req.query('following') || undefined }));
  });

  app.get('/topics', async (c) => {
    const page = paging((k) => c.req.query(k), false);
    return c.json(await listTopics(c.env.DB, c.req.query('cursor') || undefined, page!.limit));
  });

  app.get('/topics/:slug', async (c) => {
    const page = paging((k) => c.req.query(k));
    if (!page) return c.json({ error: 'bad cursor' }, 400);
    const topic = await getTopic(c.env.DB, c.req.param('slug'));
    if (!topic) return c.json({ error: 'not found' }, 404);
    return c.json({ topic, ...(await listTopicProjects(c.env.DB, topic.slug, page.cursor, page.limit)) });
  });

  app.get('/projects/:did/:rkey', async (c) => {
    const page = paging((k) => c.req.query(k), true, PROJECT_UPDATES_LIMIT);
    if (!page) return c.json({ error: 'bad cursor' }, 400);
    const { did, rkey } = c.req.param();
    const found = await getProjectWithUpdates(c.env.DB, `at://${did}/pub.workbench.project/${rkey}`, page.cursor, page.limit);
    if (!found) return c.json({ error: 'not found' }, 404);
    return c.json({
      project: found.project,
      author: await lookupProfile(c.env.DB, did, fetchFn, timeoutMs),
      items: found.updates,
      cursor: found.cursor,
    });
  });

  app.get('/updates/:did/:rkey', async (c) => {
    const { did, rkey } = c.req.param();
    const found = await getUpdateWithReplies(c.env.DB, `at://${did}/pub.workbench.update/${rkey}`);
    if (!found) return c.json({ error: 'not found' }, 404);
    return c.json({
      update: found.update,
      author: await lookupProfile(c.env.DB, did, fetchFn, timeoutMs),
      items: found.replies,
      cursor: null,
    });
  });

  app.get('/profiles/:did', async (c) => {
    const page = paging((k) => c.req.query(k));
    if (!page) return c.json({ error: 'bad cursor' }, 400);
    const did = c.req.param('did');
    if (!isValidDid(did)) return c.json({ error: 'bad did' }, 400);
    // Only DIDs with visible indexed content get a profile lookup (and a stored row), so the
    // route cannot be used to make the Worker fetch and store arbitrary identities.
    const projects = await listProfileProjects(c.env.DB, did, page.cursor, page.limit);
    const known = projects.items.length > 0 || (await hasIndexedUpdateOrReply(c.env.DB, did));
    if (!known) return c.json({ error: 'not found' }, 404);
    return c.json({ profile: await lookupProfile(c.env.DB, did, fetchFn, timeoutMs), ...projects });
  });

  return app;
}
