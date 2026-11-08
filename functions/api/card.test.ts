import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { fetchCard, cardRoutes } from './card';
import type { Env } from './read';

const db = (env as unknown as { DB: D1Database }).DB;
const bindings = env as unknown as Record<string, unknown>;

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function stub(handler: Handler) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const html = (body: string, type = 'text/html; charset=utf-8') => new Response(body, { status: 200, headers: { 'content-type': type } });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });

const PAGE = `<html><head><title>Fallback &amp; title</title>
<meta property="og:title" content="Shelf &quot;build&quot;">
<meta property='og:description' content='A <b>nice</b> shelf &lt;script&gt;alert(1)&lt;/script&gt;'>
<meta property="og:image" content="/img/cover.png"></head><body>x</body></html>`;

describe('fetchCard', () => {
  it('parses open graph tags, resolves the image, and returns plain text only', async () => {
    const s = stub(() => html(PAGE));
    const card = await fetchCard('https://example.com/post#frag', s.fn);
    expect(card.url).toBe('https://example.com/post');
    expect(card.title).toBe('Shelf "build"');
    expect(card.description).toBe('A nice shelf scriptalert(1)/script');
    expect(card.image).toBe('https://example.com/img/cover.png');
    expect(JSON.stringify(card)).not.toMatch(/[<>]/);
    expect(s.calls).toEqual(['https://example.com/post']);
  });

  it('falls back to <title> and caps string lengths', async () => {
    const s = stub(() => html(`<title>${'t'.repeat(500)}</title><meta name="description" content="${'d'.repeat(900)}">`));
    const card = await fetchCard('https://example.com/', s.fn);
    expect(card.title).toHaveLength(200);
    expect(card.description).toHaveLength(500);
  });

  it('drops an unsafe or non-http og:image', async () => {
    for (const img of ['javascript:alert(1)', 'http://169.254.169.254/x.png', 'data:image/png;base64,AAAA']) {
      const s = stub(() => html(`<meta property="og:title" content="t"><meta property="og:image" content="${img}">`));
      expect((await fetchCard('https://example.com/', s.fn)).image).toBeUndefined();
    }
  });

  it('returns a bare card for non-html content', async () => {
    const s = stub(() => html('{"a":1}', 'application/json'));
    expect(await fetchCard('https://example.com/a.json', s.fn)).toEqual({ url: 'https://example.com/a.json' });
  });

  it('sends no cookies or authorization', async () => {
    let init: RequestInit | undefined;
    const s = stub((_u, i) => ((init = i), html(PAGE)));
    await fetchCard('https://example.com/', s.fn);
    const h = new Headers(init?.headers);
    expect(h.has('cookie')).toBe(false);
    expect(h.has('authorization')).toBe(false);
    expect(init?.redirect).toBe('manual');
  });

  it('follows a safe redirect', async () => {
    const s = stub((u) => (u === 'https://short.example/x' ? redirect('https://example.com/final') : html(PAGE)));
    const card = await fetchCard('https://short.example/x', s.fn);
    expect(card.title).toBe('Shelf "build"');
    expect(s.calls).toEqual(['https://short.example/x', 'https://example.com/final']);
  });

  // Review Focus 3: a public URL must not be able to bounce us into the internal network.
  describe.each([
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['localhost', 'http://localhost/admin'],
    ['loopback ip', 'http://127.0.0.1:80/'],
    ['private ip', 'http://10.0.0.5/'],
    ['decimal ip', 'http://2130706433/'],
    ['ipv4-mapped ipv6', 'http://[::ffff:127.0.0.1]/'],
    ['file url', 'file:///etc/passwd'],
    ['credentials', 'https://user:pass@example.net/'],
    ['internal name', 'http://db.internal/'],
  ])('redirect to %s', (_name, target) => {
    it.each([301, 302, 307])('is refused (status %i) and the target is never fetched', async (status) => {
      const s = stub(() => redirect(target, status));
      await expect(fetchCard('https://public.example/start', s.fn)).rejects.toThrow();
      expect(s.calls).toEqual(['https://public.example/start']);
    });

    it('is refused on the third hop too', async () => {
      const s = stub((u) =>
        u.endsWith('/a') ? redirect('https://public.example/b') : u.endsWith('/b') ? redirect('https://public.example/c') : redirect(target),
      );
      await expect(fetchCard('https://public.example/a', s.fn)).rejects.toThrow();
      expect(s.calls).toEqual(['https://public.example/a', 'https://public.example/b', 'https://public.example/c']);
    });
  });

  it('refuses unsafe start URLs without fetching', async () => {
    const s = stub(() => html(PAGE));
    for (const u of ['http://localhost', 'http://127.0.0.1', 'http://10.0.0.5', 'http://169.254.169.254', 'http://[::1]', 'file:///etc/passwd', 'http://0x7f.1/']) {
      await expect(fetchCard(u, s.fn)).rejects.toThrow();
    }
    expect(s.calls).toEqual([]);
  });

  it('gives up after more than 3 redirects', async () => {
    let n = 0;
    const s = stub(() => redirect(`https://public.example/${++n}`));
    await expect(fetchCard('https://public.example/', s.fn)).rejects.toThrow();
    expect(s.calls).toHaveLength(4);
  });

  it('aborts after the timeout (default is 5 seconds)', async () => {
    const { FETCH_TIMEOUT_MS } = await import('../../shared/ssrf');
    expect(FETCH_TIMEOUT_MS).toBe(5000);
    const s = stub(() => new Promise<Response>(() => {}));
    await expect(fetchCard('https://slow.example/', s.fn, { timeoutMs: 40 })).rejects.toThrow('timeout');
  });

  it('stops reading after 512 KB: tags past the cap are ignored and the stream is not drained', async () => {
    let pulled = 0;
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(pulled === 1 ? enc.encode('<title>early</title>' + ' '.repeat(100_000)) : enc.encode(' '.repeat(100_000)));
        if (pulled === 6) c.enqueue(enc.encode('<meta property="og:description" content="late">'));
      },
    });
    const s = stub(() => new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } }));
    const card = await fetchCard('https://big.example/', s.fn);
    expect(card.title).toBe('early');
    expect(card.description).toBeUndefined();
    expect(pulled).toBeLessThan(10);
  });

  it('builds a github block from the stubbed API', async () => {
    const s = stub((u) =>
      u === 'https://api.github.com/repos/octo/widget'
        ? new Response(JSON.stringify({ full_name: 'octo/widget', description: 'A widget', stargazers_count: 42, pushed_at: '2026-10-01T00:00:00Z' }), {
            headers: { 'content-type': 'application/json' },
          })
        : html('should not be fetched'),
    );
    const card = await fetchCard('https://github.com/octo/widget', s.fn);
    expect(card.github).toEqual({ name: 'octo/widget', description: 'A widget', stars: 42, pushedAt: '2026-10-01T00:00:00Z' });
    expect(card.title).toBe('octo/widget');
    expect(s.calls).toEqual(['https://api.github.com/repos/octo/widget']);
  });

  it('does not treat non-repo github paths as repos, and falls back to html if the API fails', async () => {
    const s = stub((u) => (u.startsWith('https://api.github.com') ? new Response('rate limited', { status: 403 }) : html(PAGE)));
    const card = await fetchCard('https://github.com/octo/widget', s.fn);
    expect(card.github).toBeUndefined();
    expect(card.title).toBe('Shelf "build"');
    const t = stub(() => html(PAGE));
    await fetchCard('https://github.com/octo/widget/issues/1', t.fn);
    await fetchCard('https://github.com.evil.example/octo/widget', t.fn);
    expect(t.calls.some((u) => u.startsWith('https://api.github.com'))).toBe(false);
  });
});

describe('GET /api/card', () => {
  beforeEach(async () => {
    await db.prepare('DELETE FROM link_cache').run();
  });
  const mk = (s: ReturnType<typeof stub>) => {
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', cardRoutes({ fetchFn: s.fn }));
    return (path: string) => app.request(path, {}, bindings);
  };
  const q = (u: string) => `/api/card?url=${encodeURIComponent(u)}`;

  it('returns a card and serves the second request from link_cache without fetching', async () => {
    const s = stub(() => html(PAGE));
    const get = mk(s);
    const r1 = await get(q('https://example.com/post'));
    expect(r1.status).toBe(200);
    const card = await r1.json();
    expect(card).toMatchObject({ url: 'https://example.com/post', title: 'Shelf "build"' });
    expect(s.calls).toHaveLength(1);

    const r2 = await get(q('https://example.com/post#other-fragment'));
    expect(await r2.json()).toEqual(card);
    expect(s.calls).toHaveLength(1);

    const row = await db.prepare('SELECT expires_at FROM link_cache').first<{ expires_at: number }>();
    expect(row!.expires_at - Date.now()).toBeGreaterThan(23.9 * 3_600_000);
    expect(row!.expires_at - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
  });

  it('refetches an expired row and overwrites it (no duplicate rows)', async () => {
    const s = stub(() => html(PAGE));
    const get = mk(s);
    await db.prepare('INSERT INTO link_cache (url, data, expires_at) VALUES (?, ?, ?)')
      .bind('https://example.com/post', JSON.stringify({ url: 'https://example.com/post', title: 'old' }), Date.now() - 1000).run();
    const body = (await (await get(q('https://example.com/post'))).json()) as { title: string };
    expect(body.title).toBe('Shelf "build"');
    expect(s.calls).toHaveLength(1);
    const { results } = await db.prepare('SELECT url, data FROM link_cache').all<{ url: string; data: string }>();
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0].data).title).toBe('Shelf "build"');
  });

  it('prunes other expired rows on write', async () => {
    const get = mk(stub(() => html(PAGE)));
    await db.prepare('INSERT INTO link_cache (url, data, expires_at) VALUES (?, ?, ?)').bind('https://old.example/', '{}', 1).run();
    await get(q('https://example.com/new'));
    const { results } = await db.prepare('SELECT url FROM link_cache').all<{ url: string }>();
    expect(results.map((r) => r.url)).toEqual(['https://example.com/new']);
  });

  it('does not cache failures', async () => {
    const s = stub(() => new Response('boom', { status: 500 }));
    const r = await mk(s)(q('https://example.com/down'));
    expect(r.status).toBe(502);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM link_cache').first<{ n: number }>())!.n).toBe(0);
  });

  it('rejects missing and unsafe urls with 400 and no fetch or cache write', async () => {
    const s = stub(() => html(PAGE));
    const get = mk(s);
    for (const u of ['', 'http://169.254.169.254/', 'http://localhost/', 'file:///etc/passwd', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/']) {
      expect((await get(q(u))).status).toBe(400);
    }
    expect((await get('/api/card')).status).toBe(400);
    expect(s.calls).toEqual([]);
  });

  it('answers 400 and caches nothing when a public URL redirects to the metadata service', async () => {
    const s = stub(() => redirect('http://169.254.169.254/latest/meta-data/'));
    const r = await mk(s)(q('https://public.example/x'));
    expect(r.status).toBe(502);
    expect(s.calls).toEqual(['https://public.example/x']);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM link_cache').first<{ n: number }>())!.n).toBe(0);
  });
});
