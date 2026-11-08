import type { Context, MiddlewareHandler } from 'hono';

/** Returns the Cache API cache to use. Production: `caches.default`. */
export type CacheProvider = () => Promise<Cache>;

// The shared tsconfig also loads the DOM lib, whose CacheStorage lacks the Workers `default`.
export const defaultCache: CacheProvider = async () => (caches as unknown as { default: Cache }).default;

/**
 * Edge-caches successful anonymous GET responses for `maxAge` seconds, keyed on the full
 * request URL (so cursor and limit are part of the key). A Worker on a custom domain runs in
 * front of Cloudflare's cache, so without this every request costs an invocation and D1 reads.
 *
 * Never cached: requests with an Authorization header, requests `bypass` says to skip, and any
 * response other than 200 (errors, 4xx, 5xx).
 */
export function edgeCache(opts: {
  maxAge: number;
  cache: CacheProvider;
  bypass?: (c: Context) => boolean;
}): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== 'GET' || c.req.header('Authorization') !== undefined || opts.bypass?.(c)) return next();
    const cache = await opts.cache();
    const key = new Request(c.req.url, { method: 'GET' });
    const hit = await cache.match(key);
    if (hit) return hit;
    await next();
    if (c.res.status !== 200) return;
    c.res.headers.set('Cache-Control', `public, max-age=${opts.maxAge}`);
    const put = cache.put(key, c.res.clone());
    try {
      c.executionCtx.waitUntil(put);
    } catch {
      await put; // no execution context (tests): store before returning
    }
  };
}
