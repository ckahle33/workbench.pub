// SSRF guards for every outbound fetch made on behalf of a user-supplied URL.
// Limitation: a Worker cannot resolve DNS, so a public-looking hostname that
// resolves to a private address (DNS rebinding, nip.io-style names) is not
// detectable here. Cloudflare's network does not route fetch() to its own
// private ranges, which is the backstop for that case.

export const FETCH_TIMEOUT_MS = 5_000;
export const MAX_BODY_BYTES = 512 * 1024;
export const MAX_REDIRECTS = 3;

const BLOCKED_SUFFIXES = [
  '.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet', '.private',
  '.localdomain', '.home.arpa', '.arpa', '.onion',
];

function blockedIpv4(a: number, b: number, c: number): boolean {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

/**
 * True when `url` is an http(s) URL to a public-looking DNS name or public IPv4.
 * The WHATWG parser canonicalises decimal/octal/hex IPv4 forms (2130706433,
 * 0x7f.1, 0177.0.0.1) to dotted quads before we look at the hostname.
 * IPv6 literals are refused outright (covers ::1 and ::ffff:127.0.0.1).
 */
export function isSafeUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (u.port !== '') return false; // the URL parser drops the default port; anything else is refused
  let host = u.hostname.toLowerCase();
  if (host.startsWith('[')) return false;
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes('..') || host.startsWith('.')) return false;

  const quad = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (quad) {
    const [a, b, c, d] = quad.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return false;
    return !blockedIpv4(a, b, c);
  }
  const labels = host.split('.');
  if (labels.length < 2) return false; // bare hostname: localhost, intranet names
  // A numeric / 0x last label means an IPv4 spelling the parser did not accept.
  if (/^(0x[0-9a-f]*|\d+)$/.test(labels[labels.length - 1])) return false;
  return !BLOCKED_SUFFIXES.some((s) => host.endsWith(s));
}

export class SsrfError extends Error {}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** `truncate` keeps the first maxBytes; `error` rejects larger bodies. */
  overflow?: 'truncate' | 'error';
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  status: number;
  headers: Headers;
  body: Uint8Array;
  finalUrl: string;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * GET with SSRF protection: isSafeUrl on the first URL and on every redirect
 * hop (redirects are followed manually), a wall-clock deadline covering headers
 * and body, and a streamed byte cap. Only the caller's explicit headers are sent.
 * Throws on unsafe URLs, non-2xx, timeout, too many hops or oversize (error mode).
 */
export async function safeFetch(
  startUrl: string,
  fetchImpl: typeof fetch,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, timeoutMs);
  });
  deadline.catch(() => {}); // avoid unhandled rejection when the work finishes first

  const work = async (): Promise<SafeFetchResult> => {
    let url = startUrl;
    for (let hop = 0; ; hop++) {
      if (!isSafeUrl(url)) throw new SsrfError(`unsafe url`);
      const res = await fetchImpl(url, {
        method: 'GET',
        redirect: 'manual',
        headers: opts.headers ?? {},
        credentials: 'omit',
        signal: controller.signal,
      } as RequestInit);
      if (REDIRECTS.has(res.status)) {
        void res.body?.cancel().catch(() => {});
        const loc = res.headers.get('location');
        if (!loc || hop >= maxRedirects) throw new Error('bad redirect');
        try {
          url = new URL(loc, url).href;
        } catch {
          throw new Error('bad redirect');
        }
        continue;
      }
      if (res.status < 200 || res.status > 299) {
        void res.body?.cancel().catch(() => {});
        throw new Error(`status ${res.status}`);
      }
      if (opts.overflow === 'error') {
        const len = Number(res.headers.get('content-length'));
        if (Number.isFinite(len) && len > maxBytes) {
          void res.body?.cancel().catch(() => {});
          throw new Error('too large');
        }
      }
      const body = await readCapped(res, maxBytes, opts.overflow ?? 'truncate');
      return { status: res.status, headers: res.headers, body, finalUrl: url };
    }
  };

  try {
    return await Promise.race([work(), deadline]);
  } finally {
    clearTimeout(timer);
    controller.abort(); // stop any stream still open after the race is decided
  }
}

async function readCapped(res: Response, max: number, overflow: 'truncate' | 'error'): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > max) {
        if (overflow === 'error') throw new Error('too large');
        chunks.push(value.subarray(0, max - total));
        total = max;
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
