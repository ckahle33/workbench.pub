import { Hono } from 'hono';
import { isSafeUrl, safeFetch } from '../../shared/ssrf';
import { defaultCache, type CacheProvider } from '../edgeCache';
import { placeholderEnabled, placeholderResponse } from './devPlaceholder';
import type { Env } from './read';

export interface BlobOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
  /** Edge cache for blobs and DID-to-PDS lookups; `false` disables it (tests). Default `caches.default`. */
  cache?: CacheProvider | false;
}

/** DID-to-PDS resolutions are cached this long under a synthetic URL (never served to clients). */
const DID_CACHE_SECONDS = 3600;
const didCacheKey = (did: string) => new Request(`https://cache.internal/did/${encodeURIComponent(did)}`);

const DID_PLC = /^did:plc:[a-z2-7]{24}$/;
const DID_WEB = /^did:web:[a-zA-Z0-9][a-zA-Z0-9.-]*$/;
const CID = /^(b[a-z2-7]{30,120}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/;
const MAX_BLOB_BYTES = 5 * 1024 * 1024;
const DID_DOC_MAX_BYTES = 64 * 1024;
const BLOB_TIMEOUT_MS = 10_000;
// Never svg or html: blobs are served from our own origin.
export const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

/**
 * True when the proxy would attempt `/api/blob/<did>/<cid>` for a blob whose record claims
 * `mimeType`: a resolvable DID, a CID, and an allowlisted raster type. (The proxy still checks
 * the content type the PDS actually returns.)
 */
export function proxiesBlob(did: string, cid: string, mimeType: string): boolean {
  return CID.test(cid) && didDocUrl(did) !== null && IMAGE_TYPES.has(mimeType.toLowerCase());
}

function didDocUrl(did: string): string | null {
  if (DID_PLC.test(did)) return `https://plc.directory/${did}`;
  if (DID_WEB.test(did)) return `https://${did.slice('did:web:'.length)}/.well-known/did.json`;
  return null;
}

/**
 * resolvePds through the cache. Only successful resolutions (already SSRF-checked) are stored;
 * failures are never cached, so a transient plc.directory error costs only the next retry.
 */
async function resolvePdsCached(did: string, fetchImpl: typeof fetch, cache: Cache | null): Promise<string | null> {
  if (cache) {
    const hit = await cache.match(didCacheKey(did));
    if (hit) {
      const pds = await hit.text();
      if (isSafeUrl(pds)) return pds;
    }
  }
  const pds = await resolvePds(did, fetchImpl);
  if (pds && cache) {
    await cache.put(didCacheKey(did), new Response(pds, { headers: { 'Cache-Control': `public, max-age=${DID_CACHE_SECONDS}` } }));
  }
  return pds;
}

async function resolvePds(did: string, fetchImpl: typeof fetch): Promise<string | null> {
  const docUrl = didDocUrl(did);
  if (!docUrl) return null;
  const res = await safeFetch(docUrl, fetchImpl, {
    maxBytes: DID_DOC_MAX_BYTES,
    overflow: 'error',
    headers: { accept: 'application/json' },
  });
  const doc = JSON.parse(new TextDecoder().decode(res.body)) as {
    id?: unknown;
    service?: { id?: unknown; type?: unknown; serviceEndpoint?: unknown }[];
  };
  if (doc.id !== did || !Array.isArray(doc.service)) return null;
  const svc = doc.service.find(
    (s) => s && typeof s.id === 'string' && s.id.endsWith('#atproto_pds') && s.type === 'AtprotoPersonalDataServer',
  );
  if (!svc || typeof svc.serviceEndpoint !== 'string' || !isSafeUrl(svc.serviceEndpoint)) return null;
  return new URL(svc.serviceEndpoint).origin;
}

const notFound = (c: { json: (b: unknown, s: 404) => Response; header: (k: string, v: string) => void }) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ error: 'not found' }, 404);
};

/** Image proxy for atproto blobs; mount under `/api`. */
export function blobRoutes(opts: BlobOptions = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const fetchFn: typeof fetch = opts.fetchFn ?? ((input, init) => fetch(input, init));
  const cacheProvider = opts.cache ?? defaultCache;

  app.get('/blob/:did/:cid', async (c) => {
    const { did, cid } = c.req.param();
    // DEV ONLY: generated placeholders for the local demo seed. Unreachable unless the env sets
    // DEV_PLACEHOLDERS=1 (local .dev.vars only) and the DID is a fake did:plc:demo... one.
    if (placeholderEnabled(c.env ?? {}, did, cid)) return placeholderResponse(cid);
    if (!CID.test(cid) || !didDocUrl(did)) return notFound(c);
    try {
      // Content is addressed by CID, so the request URL is a safe cache key. Only responses that
      // passed every check below are stored; 404s never are.
      const cache = cacheProvider ? await cacheProvider() : null;
      const key = new Request(c.req.url, { method: 'GET' });
      const hit = cache ? await cache.match(key) : undefined;
      if (hit) return hit;
      const pds = await resolvePdsCached(did, fetchFn, cache);
      if (!pds) return notFound(c);
      const url = `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
      const res = await safeFetch(url, fetchFn, { maxBytes: MAX_BLOB_BYTES, overflow: 'error', timeoutMs: BLOB_TIMEOUT_MS });
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!IMAGE_TYPES.has(type)) return notFound(c);
      const out = new Response(res.body as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      });
      if (cache) {
        const put = cache.put(key, out.clone());
        try {
          c.executionCtx.waitUntil(put);
        } catch {
          await put.catch(() => {}); // no execution context (tests)
        }
      }
      return out;
    } catch {
      return notFound(c);
    }
  });

  return app;
}
