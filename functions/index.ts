import { Hono } from 'hono';
import { readRoutes, type Env } from './api/read';

// Only /api/* reaches this Worker (wrangler.toml run_worker_first); static
// assets are served by the ASSETS binding. Later tasks mount card, blob and
// admin routes the same way: app.route('/api', xRoutes()).
const app = new Hono<{ Bindings: Env }>();
app.route('/api', readRoutes());

export default app;
