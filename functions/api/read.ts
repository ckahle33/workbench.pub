import { Hono } from 'hono';
import {
  decodeCursor,
  getCachedProfile,
  getProjectWithUpdates,
  getTopic,
  getUpdateWithReplies,
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
}

export interface ReadOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

const PROFILE_URL = 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile';
const PROFILE_TTL_MS = 24 * 3_600_000;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

type Profile = Omit<ProfileRow, 'fetchedAt'>;

/** Cached for 24h; any fetch failure falls back to stale data, then to just the did. */
async function lookupProfile(db: D1Database, did: string, fetchFn: typeof fetch): Promise<Profile> {
  const cached = await getCachedProfile(db, did);
  if (cached && Date.now() - cached.fetchedAt < PROFILE_TTL_MS) return strip(cached);
  try {
    const res = await fetchFn(`${PROFILE_URL}?actor=${encodeURIComponent(did)}`);
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
    return cached ? strip(cached) : { did };
  }
}

function strip({ fetchedAt: _f, ...rest }: ProfileRow): Profile {
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as unknown as Profile;
}

/** Read-only routes; mount under `/api`. */
export function readRoutes(opts: ReadOptions = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));

  /** Parses `limit` and `cursor`; a bad cursor is a client error. */
  const paging = (q: (k: string) => string | undefined): { limit: number; cursor?: ListCursor } | null => {
    const n = Number(q('limit') ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT) : DEFAULT_LIMIT;
    const raw = q('cursor');
    if (!raw) return { limit };
    const cursor = decodeCursor(raw);
    return cursor ? { limit, cursor } : null;
  };

  app.get('/feed', async (c) => {
    const page = paging((k) => c.req.query(k));
    if (!page) return c.json({ error: 'bad cursor' }, 400);
    return c.json(await listFeed(c.env.DB, { ...page, followingDid: c.req.query('following') || undefined }));
  });

  app.get('/topics', async (c) => c.json({ items: await listTopics(c.env.DB), cursor: null }));

  app.get('/topics/:slug', async (c) => {
    const page = paging((k) => c.req.query(k));
    if (!page) return c.json({ error: 'bad cursor' }, 400);
    const topic = await getTopic(c.env.DB, c.req.param('slug'));
    if (!topic) return c.json({ error: 'not found' }, 404);
    return c.json({ topic, ...(await listTopicProjects(c.env.DB, topic.slug, page.cursor, page.limit)) });
  });

  app.get('/projects/:did/:rkey', async (c) => {
    const { did, rkey } = c.req.param();
    const found = await getProjectWithUpdates(c.env.DB, `at://${did}/pub.workbench.project/${rkey}`);
    if (!found) return c.json({ error: 'not found' }, 404);
    return c.json({
      project: found.project,
      author: await lookupProfile(c.env.DB, did, fetchFn),
      items: found.updates,
      cursor: null,
    });
  });

  app.get('/updates/:did/:rkey', async (c) => {
    const { did, rkey } = c.req.param();
    const found = await getUpdateWithReplies(c.env.DB, `at://${did}/pub.workbench.update/${rkey}`);
    if (!found) return c.json({ error: 'not found' }, 404);
    return c.json({
      update: found.update,
      author: await lookupProfile(c.env.DB, did, fetchFn),
      items: found.replies,
      cursor: null,
    });
  });

  app.get('/profiles/:did', async (c) => {
    const page = paging((k) => c.req.query(k));
    if (!page) return c.json({ error: 'bad cursor' }, 400);
    const did = c.req.param('did');
    const [profile, projects] = await Promise.all([
      lookupProfile(c.env.DB, did, fetchFn),
      listProfileProjects(c.env.DB, did, page.cursor, page.limit),
    ]);
    return c.json({ profile, ...projects });
  });

  return app;
}
