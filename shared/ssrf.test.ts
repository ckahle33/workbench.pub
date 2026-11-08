import { describe, expect, it } from 'vitest';
import { isSafeUrl, safeFetch } from './ssrf';

describe('isSafeUrl', () => {
  it.each([
    'https://example.com/',
    'http://example.com/a?b=c',
    'https://sub.example.co.uk/x',
    'http://8.8.8.8/',
    'http://172.32.0.1/',
  ])('accepts %s', (u) => expect(isSafeUrl(u)).toBe(true));

  it.each([
    'http://localhost',
    'http://localhost/',
    'http://LOCALHOST./',
    'http://127.0.0.1',
    'http://127.1.2.3/',
    'http://10.0.0.5',
    'http://172.16.0.1',
    'http://172.31.255.255',
    'http://192.168.1.1',
    'http://169.254.169.254',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1',
    'http://0.0.0.0',
    'http://224.0.0.1',
    'http://[::1]',
    'http://[::1]:80/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[fe80::1]/',
    'http://[2001:db8::1]/',
    'file:///etc/passwd',
    'ftp://example.com/',
    'gopher://example.com/',
    'javascript:alert(1)',
    'data:text/html,hi',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0x7f.1/',
    'http://0177.0.0.1/',
    'http://127.1/',
    'http://3232235777/',
    'http://user:pass@example.com/',
    'http://user@example.com/',
    'http://printer.local/',
    'http://db.internal/',
    'http://foo.localhost/',
    'http://intranet/',
    'http://example.com:8080/',
    'http://example.com:22/',
    'http://example.com.local./',
    'not a url',
    '',
  ])('rejects %s', (u) => expect(isSafeUrl(u)).toBe(false));
});

describe('safeFetch', () => {
  const html = (s: string) => new Response(s, { status: 200, headers: { 'content-type': 'text/html' } });

  it('re-checks every redirect hop', async () => {
    const seen: string[] = [];
    const f = (async (u: string) => {
      seen.push(u);
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
    }) as unknown as typeof fetch;
    await expect(safeFetch('https://example.com/', f)).rejects.toThrow();
    expect(seen).toEqual(['https://example.com/']);
  });

  it('sends manual redirect mode and no cookie/authorization headers', async () => {
    let init: RequestInit | undefined;
    const f = (async (_u: string, i: RequestInit) => {
      init = i;
      return html('ok');
    }) as unknown as typeof fetch;
    await safeFetch('https://example.com/', f, { headers: { accept: 'text/html' } });
    expect(init?.redirect).toBe('manual');
    expect(init?.headers).toEqual({ accept: 'text/html' });
  });

  it('allows up to 3 redirects and refuses a 4th', async () => {
    let n = 0;
    const f = (async () => {
      n++;
      return new Response(null, { status: 301, headers: { location: `https://example.com/${n}` } });
    }) as unknown as typeof fetch;
    await expect(safeFetch('https://example.com/', f)).rejects.toThrow('bad redirect');
    expect(n).toBe(4);

    let m = 0;
    const g = (async () => (++m <= 3 ? new Response(null, { status: 302, headers: { location: '/next' } }) : html('done'))) as unknown as typeof fetch;
    const r = await safeFetch('https://example.com/', g);
    expect(new TextDecoder().decode(r.body)).toBe('done');
    expect(r.finalUrl).toBe('https://example.com/next');
  });

  it('truncates at the byte cap without reading the rest of the stream', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(100_000).fill(65));
      },
    });
    const f = (async () => new Response(stream, { status: 200 })) as unknown as typeof fetch;
    const r = await safeFetch('https://example.com/', f, { maxBytes: 512 * 1024 });
    expect(r.body.length).toBe(512 * 1024);
    expect(pulled).toBeLessThan(20); // endless stream was not consumed
  });

  it('errors on oversize in error mode', async () => {
    const f = (async () => new Response(new Uint8Array(2000), { status: 200 })) as unknown as typeof fetch;
    await expect(safeFetch('https://example.com/', f, { maxBytes: 1000, overflow: 'error' })).rejects.toThrow('too large');
  });

  it('times out when headers never arrive', async () => {
    const f = (() => new Promise(() => {})) as unknown as typeof fetch;
    await expect(safeFetch('https://example.com/', f, { timeoutMs: 30 })).rejects.toThrow('timeout');
  });

  it('times out when the body stalls', async () => {
    const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
    const f = (async () => new Response(stream, { status: 200 })) as unknown as typeof fetch;
    await expect(safeFetch('https://example.com/', f, { timeoutMs: 30 })).rejects.toThrow('timeout');
  });

  it('rejects non-2xx', async () => {
    const f = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    await expect(safeFetch('https://example.com/', f)).rejects.toThrow('status 500');
  });
});
