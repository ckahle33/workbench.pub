import { Hono } from 'hono';
import { adminRoutes } from './api/admin';
import { blobRoutes } from './api/blob';
import { cardRoutes } from './api/card';
import { readRoutes, type Env } from './api/read';
import { defaultCache, edgeCache, type CacheProvider } from './edgeCache';
import { shareMetaRoutes } from './shareMeta';

/** Seconds the anonymous global feed and the topic list are cached at the edge. */
export const PUBLIC_LIST_MAX_AGE = 30;

export interface AppOptions {
  /** Cache for anonymous public lists; `false` turns edge caching off (tests). */
  edgeCache?: CacheProvider | false;
  /** Cache for share-page meta (functions/shareMeta.ts); `false` turns it off (tests). */
  shareCache?: CacheProvider | false;
}

// Builds the Hono app. Kept out of functions/index.ts: a Worker entry module may export only
// handlers, so constants and factories live here.
// Only /api/* and the share pages /p/*, /u/*, /t/*, /profile/* reach this Worker (wrangler.toml
// run_worker_first); everything else is served by the ASSETS binding. API routes are mounted as
// app.route('/api', xRoutes()); the share pages return the HTML shell with per-page meta.
export function createApp(opts: AppOptions = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const cache = opts.edgeCache ?? defaultCache;
  if (cache) {
    // Exact paths: /api/topics/:slug and other routes are not cached here.
    app.use('/api/feed', edgeCache({ maxAge: PUBLIC_LIST_MAX_AGE, cache, bypass: (c) => c.req.query('following') !== undefined }));
    app.use('/api/topics', edgeCache({ maxAge: PUBLIC_LIST_MAX_AGE, cache }));
  }
  app.route('/api', readRoutes());
  app.route('/api', cardRoutes());
  app.route('/api', blobRoutes());
  app.route('/api', adminRoutes());
  app.route('/', shareMetaRoutes({ cache: opts.shareCache ?? defaultCache }));
  return app;
}

