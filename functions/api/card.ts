import { Hono } from 'hono';
import { isSafeUrl, safeFetch, type SafeFetchOptions } from '../../shared/ssrf';
import type { Env } from './read';

export interface CardGithub {
  name: string;
  description: string;
  stars: number;
  pushedAt: string;
}

export interface Card {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  github?: CardGithub;
}

export interface CardOptions {
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: typeof fetch;
}

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 500;
const URL_MAX = 500;
const CACHE_TTL_MS = 24 * 3_600_000;
const HEADERS = { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', 'user-agent': 'workbench.pub-linkcard/1' };
const GITHUB_PATH = /^\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})\/?$/;

/** Plain text only: tags removed, entities decoded, angle brackets dropped, capped. */
function clean(raw: string | undefined, max: number): string | undefined {
  if (!raw) return undefined;
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, e: string) => {
      const l = e.toLowerCase();
      if (l === 'amp') return '&';
      if (l === 'lt') return '<';
      if (l === 'gt') return '>';
      if (l === 'quot') return '"';
      if (l === 'apos') return "'";
      if (l === 'nbsp') return ' ';
      const cp = l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '';
    })
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, max) : undefined;
}

/** Linear scan for <meta ...> tags; `>` inside a quoted attribute does not end the tag. */
function* metaTags(html: string): Generator<string> {
  const lower = html.toLowerCase();
  let i = 0;
  for (;;) {
    const start = lower.indexOf('<meta', i);
    if (start < 0) return;
    if (!/[\s/]/.test(html[start + 5] ?? '')) {
      i = start + 5;
      continue;
    }
    let quote = '';
    let j = start + 5;
    for (; j < html.length; j++) {
      const ch = html[j];
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
    }
    if (j >= html.length) return; // unterminated: nothing after it can be trusted
    yield html.slice(start, j + 1);
    i = j + 1;
  }
}

/** Open Graph / Twitter / plain meta tags plus <title>, via regex over the capped HTML. */
function parseMeta(html: string): { title?: string; description?: string; image?: string } {
  const meta = new Map<string, string>();
  for (const tag of metaTags(html)) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    }
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
    if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content);
  }
  const pageTitle = /<title\b[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  return {
    title: meta.get('og:title') ?? meta.get('twitter:title') ?? pageTitle,
    description: meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description'),
    image: meta.get('og:image') ?? meta.get('twitter:image'),
  };
}

function safeImage(raw: string | undefined, base: string): string | undefined {
  if (!raw) return undefined;
  try {
    const abs = new URL(raw.trim().replace(/&amp;/g, '&'), base).href;
    return abs.length <= URL_MAX && isSafeUrl(abs) ? abs : undefined;
  } catch {
    return undefined;
  }
}

function githubRepo(url: string): string | null {
  const u = new URL(url);
  if (u.protocol !== 'https:' || (u.hostname !== 'github.com' && u.hostname !== 'www.github.com')) return null;
  const m = GITHUB_PATH.exec(u.pathname);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function fetchGithub(repo: string, fetchImpl: typeof fetch, opts: SafeFetchOptions): Promise<CardGithub | null> {
  try {
    const r = await safeFetch(`https://api.github.com/repos/${repo}`, fetchImpl, {
      ...opts,
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'workbench.pub-linkcard/1' },
    });
    const j = JSON.parse(new TextDecoder().decode(r.body)) as Record<string, unknown>;
    if (typeof j.full_name !== 'string' || typeof j.stargazers_count !== 'number') return null;
    return {
      name: clean(j.full_name, TITLE_MAX) ?? repo,
      description: clean(typeof j.description === 'string' ? j.description : '', DESCRIPTION_MAX) ?? '',
      stars: j.stargazers_count,
      pushedAt: typeof j.pushed_at === 'string' ? j.pushed_at.slice(0, 40) : '',
    };
  } catch {
    return null;
  }
}

/** Thrown for URLs that fail the SSRF check; the route maps it to 400. */
export class UnsafeUrlError extends Error {}

/**
 * Builds a link card. Throws UnsafeUrlError for unsafe URLs and a plain Error
 * when the page cannot be fetched. Never returns raw HTML.
 */
export async function fetchCard(url: string, fetchImpl: typeof fetch, opts: SafeFetchOptions = {}): Promise<Card> {
  if (!isSafeUrl(url)) throw new UnsafeUrlError('unsafe url');
  const target = new URL(url);
  target.hash = '';
  const href = target.href;
  const card: Card = { url: href };

  const repo = githubRepo(href);
  if (repo) {
    const gh = await fetchGithub(repo, fetchImpl, opts);
    if (gh) {
      card.github = gh;
      card.title = gh.name;
      if (gh.description) card.description = gh.description;
      return card;
    }
  }

  const res = await safeFetch(href, fetchImpl, { ...opts, headers: HEADERS });
  const type = res.headers.get('content-type') ?? '';
  if (!/^(text\/html|application\/xhtml\+xml)/i.test(type)) return card;
  const meta = parseMeta(new TextDecoder().decode(res.body));
  const title = clean(meta.title, TITLE_MAX);
  const description = clean(meta.description, DESCRIPTION_MAX);
  const image = safeImage(meta.image, res.finalUrl);
  if (title) card.title = title;
  if (description) card.description = description;
  if (image) card.image = image;
  return card;
}

/** Link-card routes; mount under `/api`. */
export function cardRoutes(opts: CardOptions = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const fetchFn: typeof fetch = opts.fetchFn ?? ((input, init) => fetch(input, init));

  app.get('/card', async (c) => {
    const raw = c.req.query('url');
    if (!raw || raw.length > 2000 || !isSafeUrl(raw)) return c.json({ error: 'bad url' }, 400);
    const key = new URL(raw);
    key.hash = '';
    const now = Date.now();

    const row = await c.env.DB.prepare('SELECT data FROM link_cache WHERE url = ? AND expires_at > ?')
      .bind(key.href, now)
      .first<{ data: string }>();
    if (row) {
      c.header('Cache-Control', 'public, max-age=3600');
      return c.json(JSON.parse(row.data) as Card);
    }

    let card: Card;
    try {
      card = await fetchCard(key.href, fetchFn);
    } catch (e) {
      return c.json({ error: e instanceof UnsafeUrlError ? 'bad url' : 'fetch failed' }, e instanceof UnsafeUrlError ? 400 : 502);
    }

    // Only successful cards are stored. An expired row for this URL is overwritten,
    // and a few other expired rows are pruned on each write so the table stays bounded.
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM link_cache WHERE url IN (SELECT url FROM link_cache WHERE expires_at <= ? LIMIT 20)').bind(now),
      c.env.DB.prepare(
        'INSERT INTO link_cache (url, data, expires_at) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at',
      ).bind(key.href, JSON.stringify(card), now + CACHE_TTL_MS),
    ]);
    c.header('Cache-Control', 'public, max-age=3600');
    return c.json(card);
  });

  return app;
}
