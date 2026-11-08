import { Hono, type Context } from 'hono';
import { blockDid, hideUri, insertReport, listReports } from '../../shared/db';
import type { Env } from './read';

const REASON_MAX = 500;
const URI_MAX = 512;
const DID_MAX = 256;
const BODY_MAX = 4096;
const DAY_MS = 24 * 3_600_000;
const REPORT_LIST_LIMIT = 200;
// Used when IP_HASH_SALT is not configured; still keeps raw IPs out of the database.
const DEFAULT_SALT = 'workbench.pub/report-ip/v1';
const DID_RE = /^did:[a-z]+:[A-Za-z0-9._:%-]+$/;
const URI_RE = /^at:\/\/[^\s]+$/;

const enc = new TextEncoder();

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Constant-time token check. Both sides are hashed to 32 bytes first, so the
 * comparison never depends on the secret's length, and every byte is compared.
 * Fails closed when the expected token is unset or empty.
 */
async function tokenMatches(header: string | undefined, expected: string | undefined): Promise<boolean> {
  if (!expected) return false;
  const m = /^Bearer (.+)$/.exec(header ?? '');
  const [a, b] = await Promise.all([sha256(m ? m[1] : ''), sha256(expected)]);
  let diff = m ? 0 : 1;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

type Ctx = Context<{ Bindings: Env }>;

/** Parses a small JSON object body; null on anything else. */
async function jsonBody(c: Ctx): Promise<Record<string, unknown> | null> {
  try {
    const text = await c.req.text();
    if (text.length > BODY_MAX) return null;
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const validUri = (v: unknown): v is string => typeof v === 'string' && v.length <= URI_MAX && URI_RE.test(v);
const validDid = (v: unknown): v is string => typeof v === 'string' && v.length <= DID_MAX && DID_RE.test(v);

/** Public report endpoint plus bearer-protected admin endpoints; mount under `/api`. */
export function adminRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.post('/report', async (c) => {
    const body = await jsonBody(c);
    if (!body || !validUri(body.uri) || typeof body.reason !== 'string' || body.reason.length > REASON_MAX) {
      return c.json({ error: 'bad request' }, 400);
    }
    const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
    const ipHash = hex(await sha256(`${c.env.IP_HASH_SALT || DEFAULT_SALT}:${ip}`));
    const now = Date.now();
    const outcome = await insertReport(c.env.DB, {
      uri: body.uri,
      reason: body.reason,
      ipHash,
      nowMs: now,
      sinceMs: now - DAY_MS,
    });
    if (outcome === 'stored') return c.json({ ok: true }, 201);
    // The table being full is a server-side condition (503); the per-ip and per-uri limits are 429.
    if (outcome === 'full') return c.json({ error: 'reports unavailable' }, 503);
    return c.json({ error: outcome === 'duplicate' ? 'already reported' : 'too many reports' }, 429);
  });

  const admin = new Hono<{ Bindings: Env }>();
  admin.use('*', async (c, next) => {
    if (!(await tokenMatches(c.req.header('Authorization'), c.env.ADMIN_TOKEN))) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });

  admin.post('/hide', async (c) => {
    const body = await jsonBody(c);
    if (!body || !validUri(body.uri)) return c.json({ error: 'bad request' }, 400);
    await hideUri(c.env.DB, body.uri);
    return c.json({ ok: true });
  });

  admin.post('/block', async (c) => {
    const body = await jsonBody(c);
    if (!body || !validDid(body.did)) return c.json({ error: 'bad request' }, 400);
    await blockDid(c.env.DB, body.did);
    return c.json({ ok: true });
  });

  admin.get('/reports', async (c) => c.json({ items: await listReports(c.env.DB, REPORT_LIST_LIMIT) }));

  app.route('/admin', admin);
  return app;
}
