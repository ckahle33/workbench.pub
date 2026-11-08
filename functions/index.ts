import { Hono } from 'hono';
import { adminRoutes } from './api/admin';
import { blobRoutes } from './api/blob';
import { cardRoutes } from './api/card';
import { readRoutes, type Env } from './api/read';
import { defaultCache, edgeCache, type CacheProvider } from './edgeCache';

/** Seconds the anonymous global feed and the topic list are cached at the edge. */
export const PUBLIC_LIST_MAX_AGE = 30;

export interface AppOptions {
  /** Cache for anonymous public lists; `false` turns edge caching off (tests). */
  edgeCache?: CacheProvider | false;
}

// Only /api/* reaches this Worker (wrangler.toml run_worker_first); static
// assets are served by the ASSETS binding. Routes are mounted as app.route('/api', xRoutes()).
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
  return app;
}

export default createApp();
