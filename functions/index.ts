import { Hono } from 'hono';
import { blobRoutes } from './api/blob';
import { cardRoutes } from './api/card';
import { readRoutes, type Env } from './api/read';

// Only /api/* reaches this Worker (wrangler.toml run_worker_first); static
// assets are served by the ASSETS binding. Later tasks mount admin routes the same way: app.route('/api', xRoutes()).
const app = new Hono<{ Bindings: Env }>();
app.route('/api', readRoutes());
app.route('/api', cardRoutes());
app.route('/api', blobRoutes());

export default app;
