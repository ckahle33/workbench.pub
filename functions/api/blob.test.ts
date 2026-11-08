import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { blobRoutes } from './blob';
import type { Env } from './read';

const bindings = env as unknown as Record<string, unknown>;
const DID = 'did:plc:' + 'a'.repeat(24);
const CID = 'bafkrei' + 'a'.repeat(45);
const PNG = new Uint8Array([137, 80, 78, 71]);

function stub(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const didDoc = (pds: string, id = DID) =>
  new Response(JSON.stringify({ id, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: pds }] }), {
    headers: { 'content-type': 'application/json' },
  });
const happy = (pds = 'https://pds.example.com', type = 'image/png') =>
  stub((u) => (u.startsWith('https://plc.directory/') ? didDoc(pds) : new Response(PNG, { headers: { 'content-type': type } })));
// Edge caching is off here (each test sees fresh fetches); it is covered in 'edge caching' below.
const get = (s: ReturnType<typeof stub>, path: string) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/api', blobRoutes({ fetchFn: s.fn, cache: false }));
  return app.request(path, {}, bindings);
};

describe('GET /api/blob/:did/:cid', () => {
  it('resolves the PDS, proxies the blob and sets immutable caching', async () => {
    const s = happy();
    const r = await get(s, `/api/blob/${DID}/${CID}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PNG);
    expect(s.calls.map((c) => c.url)).toEqual([
      `https://plc.directory/${DID}`,
      `https://pds.example.com/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(DID)}&cid=${CID}`,
    ]);
  });

  it('resolves did:web through .well-known', async () => {
    const s = stub((u) =>
      u === 'https://alice.example.com/.well-known/did.json'
        ? didDoc('https://pds.example.com', 'did:web:alice.example.com')
        : new Response(PNG, { headers: { 'content-type': 'image/jpeg' } }),
    );
    expect((await get(s, `/api/blob/did:web:alice.example.com/${CID}`)).status).toBe(200);
  });

  it('never forwards cookies or auth headers, and uses manual redirects', async () => {
    const s = happy();
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', blobRoutes({ fetchFn: s.fn, cache: false }));
    await app.request(`/api/blob/${DID}/${CID}`, { headers: { cookie: 'session=1', authorization: 'Bearer x' } }, bindings);
    for (const c of s.calls) {
      const h = new Headers(c.init?.headers);
      expect(h.has('cookie')).toBe(false);
      expect(h.has('authorization')).toBe(false);
      expect(c.init?.redirect).toBe('manual');
    }
  });

  it.each([
    'http://169.254.169.254',
    'http://localhost:2583',
    'http://10.0.0.5',
    'http://pds.internal',
    'http://[::1]',
    'http://2130706433',
    'file:///etc/passwd',
    'https://user:pw@pds.example.com',
  ])('404s without fetching when the DID document names an unsafe PDS (%s)', async (pds) => {
    const s = stub((u) => (u.startsWith('https://plc.directory/') ? didDoc(pds) : new Response(PNG, { headers: { 'content-type': 'image/png' } })));
    const r = await get(s, `/api/blob/${DID}/${CID}`);
    expect(r.status).toBe(404);
    expect(s.calls).toHaveLength(1);
  });

  it('404s when the PDS redirects the blob request to an internal address', async () => {
    const s = stub((u) =>
      u.startsWith('https://plc.directory/') ? didDoc('https://pds.example.com') : new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
    );
    expect((await get(s, `/api/blob/${DID}/${CID}`)).status).toBe(404);
    expect(s.calls).toHaveLength(2);
  });

  it('404s for malformed DIDs and CIDs without any fetch', async () => {
    const s = happy();
    const bad = [
      `/api/blob/did:plc:short/${CID}`,
      `/api/blob/did:key:abc/${CID}`,
      `/api/blob/did:web:localhost%2F..%2Fx/${CID}`,
      `/api/blob/did:web:a.com%2Fpath/${CID}`,
      `/api/blob/${DID}/not-a-cid`,
      `/api/blob/${DID}/${CID}%2F..%2F..`,
      `/api/blob/https:%2F%2Fevil.example/${CID}`,
    ];
    for (const p of bad) expect((await get(s, p)).status).toBe(404);
    expect(s.calls).toEqual([]);
  });

  it('404s when the DID document id does not match, or the DID is unknown', async () => {
    expect((await get(stub(() => didDoc('https://pds.example.com', 'did:plc:' + 'b'.repeat(24))), `/api/blob/${DID}/${CID}`)).status).toBe(404);
    expect((await get(stub(() => new Response('nope', { status: 404 })), `/api/blob/${DID}/${CID}`)).status).toBe(404);
  });

  it('refuses non-image content types (no html/svg served from our origin)', async () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/javascript']) {
      expect((await get(happy('https://pds.example.com', type), `/api/blob/${DID}/${CID}`)).status).toBe(404);
    }
  });

  it('404s for oversize blobs', async () => {
    const s = stub((u) =>
      u.startsWith('https://plc.directory/')
        ? didDoc('https://pds.example.com')
        : new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } }),
    );
    expect((await get(s, `/api/blob/${DID}/${CID}`)).status).toBe(404);
  });

  it('does not make failures cacheable as immutable', async () => {
    const r = await get(stub(() => new Response('x', { status: 500 })), `/api/blob/${DID}/${CID}`);
    expect(r.status).toBe(404);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});

describe('GET /api/blob edge caching', () => {
  let n = 0;
  const cachedApp = async (s: ReturnType<typeof stub>) => {
    const cache = await caches.open(`blob-test-${++n}-${Math.random()}`);
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', blobRoutes({ fetchFn: s.fn, cache: async () => cache }));
    return { cache, get: (path: string) => app.request(`https://workbench.pub${path}`, {}, bindings) };
  };

  it('serves a second request for the same blob from the cache without fetching', async () => {
    const s = happy();
    const { get } = await cachedApp(s);
    expect((await get(`/api/blob/${DID}/${CID}`)).status).toBe(200);
    expect(s.calls).toHaveLength(2);
    const r = await get(`/api/blob/${DID}/${CID}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PNG);
    expect(s.calls).toHaveLength(2);
  });

  it('caches the DID to PDS resolution: another blob of the same DID skips plc.directory', async () => {
    const s = happy();
    const { get } = await cachedApp(s);
    await get(`/api/blob/${DID}/${CID}`);
    const other = 'bafkrei' + 'b'.repeat(45);
    expect((await get(`/api/blob/${DID}/${other}`)).status).toBe(200);
    expect(s.calls.filter((c) => c.url.startsWith('https://plc.directory/'))).toHaveLength(1);
    expect(s.calls).toHaveLength(3);
  });

  it('does not cache a failed resolution or a 404', async () => {
    let fail = true;
    const s = stub((u) => {
      if (u.startsWith('https://plc.directory/')) return fail ? new Response('down', { status: 503 }) : didDoc('https://pds.example.com');
      return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    });
    const { get, cache } = await cachedApp(s);
    expect((await get(`/api/blob/${DID}/${CID}`)).status).toBe(404);
    expect(await cache.match(`https://cache.internal/did/${DID}`)).toBeUndefined();
    expect(await cache.match(`https://workbench.pub/api/blob/${DID}/${CID}`)).toBeUndefined();
    fail = false;
    expect((await get(`/api/blob/${DID}/${CID}`)).status).toBe(200);
  });

  it('never caches refused content types, and SSRF checks still run before any PDS fetch', async () => {
    const s = happy('https://pds.example.com', 'text/html');
    const { get, cache } = await cachedApp(s);
    expect((await get(`/api/blob/${DID}/${CID}`)).status).toBe(404);
    expect(await cache.match(`https://workbench.pub/api/blob/${DID}/${CID}`)).toBeUndefined();
    const unsafe = stub((u) => (u.startsWith('https://plc.directory/') ? didDoc('http://169.254.169.254') : new Response(PNG)));
    const second = await cachedApp(unsafe);
    expect((await second.get(`/api/blob/${DID}/${CID}`)).status).toBe(404);
    expect(unsafe.calls).toHaveLength(1);
    expect(await second.cache.match(`https://cache.internal/did/${DID}`)).toBeUndefined();
  });
});
