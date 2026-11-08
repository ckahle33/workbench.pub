import { isValidDid, isValidRecordKey } from '@atproto/syntax';
import { Hono, type Context } from 'hono';
import { getTopic } from '../shared/db';
import { proxiesBlob } from './api/blob';
import type { Env } from './api/read';
import type { CacheProvider } from './edgeCache';
import { SECURITY_HEADERS } from './securityHeaders';

/**
 * Per-page link-preview meta for crawlers that do not run JavaScript (Bluesky, Slack, iMessage,
 * Discord, X). For /p/:did/:rkey, /u/:did/:rkey, /t/:slug and /profile/:did the Worker reads the
 * SPA shell from the ASSETS binding, looks the entity up with ONE D1 query (same visibility rules
 * as the read API), and rewrites the head tags with HTMLRewriter, whose setAttribute and
 * setInnerContent escape their input. Anything else under those prefixes, and every miss, gets the
 * shell's own default tags. The body is untouched, so browsers hydrate exactly as before.
 */

export const SITE = 'https://workbench.pub';
export const DEFAULT_TITLE = 'workbench.pub: show how it’s made';
export const DEFAULT_DESCRIPTION =
  'Post a project as a dated timeline of photos and notes, from the first parts on the bench to the finished thing. Sign in with your Bluesky account; your posts stay in it.';
export const DEFAULT_IMAGE = `${SITE}/og.png`;
export const DEFAULT_IMAGE_ALT = 'workbench.pub: Show how it’s made. Projects as dated timelines of photos and notes.';
/** Photos larger than this (record `size`) are not used as the card image; Bluesky caps thumbs near 1 MB. */
export const OG_PHOTO_MAX_BYTES = 900_000;
/** Seconds a found entity's meta is kept in the edge cache (hidden content can linger this long). */
export const SHARE_META_MAX_AGE = 300;

const TITLE_MAX = 70;
const DESCRIPTION_MAX = 200;
const ALT_MAX = 200;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ShareMeta {
  /** og:title / twitter:title. */
  title: string;
  /** The document <title>. */
  docTitle: string;
  description: string;
  url: string;
  type: 'article' | 'website';
  /** A photo; absent means the default image (with its known width and height). */
  image?: { url: string; alt: string };
}

export interface ShareMetaOptions {
  /** Cache for found entities' meta; `false` turns it off (tests). Default `caches.default`. */
  cache?: CacheProvider | false;
}

// ---- Untrusted text ---------------------------------------------------------------

// C0/C1 controls (after whitespace is collapsed) and bidi embedding, override and isolate marks,
// which can visually reorder the rest of a preview line. Ordinary RTL text is kept.
const CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩﻿]/g;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Makes user text safe and short for a meta tag: well-formed UTF-16, whitespace collapsed to
 * single spaces, control and bidi-control characters removed, truncated to `max` graphemes with
 * an ellipsis. Escaping is left to HTMLRewriter.
 */
export function cleanText(input: string, max: number): string {
  const s = input.replace(LONE_SURROGATE, '\ufffd').replace(/\s+/g, ' ').replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  const graphemes = [...segmenter.segment(s)];
  if (graphemes.length <= max) return s;
  return graphemes.slice(0, max - 1).map((g) => g.segment).join('').trimEnd() + '…';
}

// ---- Lookups (one D1 query each) --------------------------------------------------

type Row = Record<string, unknown>;

interface BlobJson {
  ref?: { $link?: unknown };
  mimeType?: unknown;
  size?: unknown;
}

function parse(s: unknown): unknown {
  if (typeof s !== 'string') return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** The proxied photo URL for a blob, or null if the proxy would not serve it or it is too big for a card. */
function photoUrl(did: string, blob: unknown): string | null {
  const b = blob as BlobJson | undefined;
  const cid = b?.ref?.$link;
  if (typeof cid !== 'string' || typeof b?.mimeType !== 'string' || typeof b.size !== 'number') return null;
  if (b.size <= 0 || b.size > OG_PHOTO_MAX_BYTES || !proxiesBlob(did, cid, b.mimeType)) return null;
  return `${SITE}/api/blob/${did}/${cid}`;
}

/** The first photo of an update's images JSON, if it can be a card image. */
function firstPhoto(did: string, imagesJson: unknown, fallbackAlt: string): ShareMeta['image'] | undefined {
  const images = parse(imagesJson);
  if (!Array.isArray(images) || images.length === 0) return undefined;
  const first = images[0] as { image?: unknown; alt?: unknown };
  const url = photoUrl(did, first?.image);
  if (!url) return undefined;
  const alt = cleanText(typeof first.alt === 'string' ? first.alt : '', ALT_MAX);
  return { url, alt: alt || fallbackAlt };
}

function coverPhoto(did: string, coverJson: unknown, title: string): ShareMeta['image'] | undefined {
  const url = photoUrl(did, parse(coverJson));
  return url ? { url, alt: cleanText(`Cover photo for ${title}`, ALT_MAX) } : undefined;
}

async function projectMeta(db: D1Database, did: string, rkey: string, url: string): Promise<ShareMeta | null> {
  // Same filters as getProjectWithUpdates: visible project; only its author's visible updates.
  const r = await db
    .prepare(
      `SELECT p.title, p.summary, p.cover,
         (SELECT u.images FROM updates u WHERE u.project_uri = p.uri AND u.hidden = 0 AND u.did = p.did
            AND u.images IS NOT NULL AND u.images != '[]' ORDER BY u.indexed_at DESC, u.uri DESC LIMIT 1) AS images,
         (SELECT u.body FROM updates u WHERE u.project_uri = p.uri AND u.hidden = 0 AND u.did = p.did
            ORDER BY u.indexed_at DESC, u.uri DESC LIMIT 1) AS latest_body
       FROM projects p WHERE p.uri = ? AND p.hidden = 0`,
    )
    .bind(`at://${did}/pub.workbench.project/${rkey}`)
    .first<Row>();
  if (!r) return null;
  const title = cleanText(String(r.title ?? ''), TITLE_MAX) || 'Untitled project';
  const description =
    cleanText(String(r.summary ?? ''), DESCRIPTION_MAX) ||
    cleanText(String(r.latest_body ?? ''), DESCRIPTION_MAX) ||
    'A project on workbench.pub, posted as a dated timeline of photos and notes.';
  const image = firstPhoto(did, r.images, `Photo from ${title}`) ?? coverPhoto(did, r.cover, title);
  return { title, docTitle: `${title} · workbench.pub`, description, url, type: 'article', image };
}

async function updateMeta(db: D1Database, did: string, rkey: string, url: string): Promise<ShareMeta | null> {
  // Same filters as getUpdateWithReplies: visible update on a visible project by the same DID.
  const r = await db
    .prepare(
      `SELECT u.heading, u.body, u.images, p.title AS p_title, p.cover AS p_cover
       FROM updates u JOIN projects p ON p.uri = u.project_uri
       WHERE u.uri = ? AND u.hidden = 0 AND p.hidden = 0 AND u.did = p.did`,
    )
    .bind(`at://${did}/pub.workbench.update/${rkey}`)
    .first<Row>();
  if (!r) return null;
  const heading = cleanText(String(r.heading ?? ''), TITLE_MAX) || 'Update';
  const project = cleanText(String(r.p_title ?? ''), 50) || 'Untitled project';
  const title = `${heading} — ${project}`;
  const description = cleanText(String(r.body ?? ''), DESCRIPTION_MAX) || `An update to ${project} on workbench.pub.`;
  const image = firstPhoto(did, r.images, `Photo from ${heading}`) ?? coverPhoto(did, r.p_cover, project);
  return { title, docTitle: `${title} · workbench.pub`, description, url, type: 'article', image };
}

async function topicMeta(db: D1Database, slug: string, url: string): Promise<ShareMeta | null> {
  const t = await getTopic(db, slug); // hidden = 0
  if (!t) return null;
  const name = cleanText(t.name, 50) || slug;
  const title = `${name} on workbench.pub`;
  const description =
    cleanText(t.description, DESCRIPTION_MAX) || cleanText(`${name} projects on workbench.pub, each a dated timeline of photos and notes.`, DESCRIPTION_MAX);
  return { title, docTitle: title, description, url, type: 'website' };
}

async function profileMeta(db: D1Database, did: string, url: string): Promise<ShareMeta | null> {
  // Like /api/profiles/:did: only DIDs with visible indexed content. The name comes from the
  // cached profiles row only; a crawler hit never triggers a Bluesky fetch.
  const r = await db
    .prepare(
      `SELECT (EXISTS(SELECT 1 FROM projects WHERE did = ?1 AND hidden = 0)
            OR EXISTS(SELECT 1 FROM updates WHERE did = ?1 AND hidden = 0)
            OR EXISTS(SELECT 1 FROM replies WHERE did = ?1 AND hidden = 0)) AS known,
              (SELECT handle FROM profiles WHERE did = ?1) AS handle,
              (SELECT display_name FROM profiles WHERE did = ?1) AS display_name`,
    )
    .bind(did)
    .first<Row>();
  if (!r || r.known !== 1) return null;
  const handle = cleanText(String(r.handle ?? ''), 60);
  const display = cleanText(String(r.display_name ?? ''), 50);
  const name = display || (handle ? `@${handle}` : '');
  if (!name) {
    const title = 'A maker on workbench.pub';
    return { title, docTitle: title, description: 'Projects and updates by a maker on workbench.pub.', url, type: 'website' };
  }
  const title = `${name} on workbench.pub`;
  const who = display && handle ? `${display} (@${handle})` : name;
  return { title, docTitle: title, description: cleanText(`Projects by ${who} on workbench.pub.`, DESCRIPTION_MAX), url, type: 'website' };
}

type Route =
  | { kind: 'project' | 'update'; did: string; rkey: string }
  | { kind: 'topic'; slug: string }
  | { kind: 'profile'; did: string };

/** Parses the share routes; anything else (including /p/:did/:rkey/update) is null. Never throws. */
export function parseRoute(pathname: string): Route | null {
  let parts: string[];
  try {
    parts = pathname.replace(/\/$/, '').split('/').slice(1).map(decodeURIComponent);
  } catch {
    return null;
  }
  const [head, a, b] = parts;
  if ((head === 'p' || head === 'u') && parts.length === 3 && isValidDid(a) && isValidRecordKey(b)) {
    return { kind: head === 'p' ? 'project' : 'update', did: a, rkey: b };
  }
  if (head === 't' && parts.length === 2 && a.length >= 2 && a.length <= 40 && SLUG_RE.test(a)) return { kind: 'topic', slug: a };
  if (head === 'profile' && parts.length === 2 && isValidDid(a)) return { kind: 'profile', did: a };
  return null;
}

function canonicalUrl(route: Route): string {
  const enc = encodeURIComponent;
  switch (route.kind) {
    case 'project':
      return `${SITE}/p/${route.did}/${enc(route.rkey)}`;
    case 'update':
      return `${SITE}/u/${route.did}/${enc(route.rkey)}`;
    case 'topic':
      return `${SITE}/t/${route.slug}`;
    case 'profile':
      return `${SITE}/profile/${route.did}`;
  }
}

function lookup(db: D1Database, route: Route): Promise<ShareMeta | null> {
  const url = canonicalUrl(route);
  switch (route.kind) {
    case 'project':
      return projectMeta(db, route.did, route.rkey, url);
    case 'update':
      return updateMeta(db, route.did, route.rkey, url);
    case 'topic':
      return topicMeta(db, route.slug, url);
    case 'profile':
      return profileMeta(db, route.did, url);
  }
}

// ---- Response ---------------------------------------------------------------------

/**
 * setAttribute escapes only `"` (enough for a double-quoted value), so `&`, `<` and `>` are encoded
 * here too: the stored value then round-trips exactly (a literal "&amp;" stays "&amp;") and naive
 * regex-based preview parsers never see a `<script` inside an attribute. Tests pin both behaviours.
 */
const attrText = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function rewrite(shell: Response, m: ShareMeta): Response {
  const set = (attr: string, value: string): HTMLRewriterElementContentHandlers => ({
    element: (e) => void e.setAttribute(attr, attrText(value)),
  });
  const content = (v: string) => set('content', v);
  const image = m.image ?? { url: DEFAULT_IMAGE, alt: DEFAULT_IMAGE_ALT };
  let rw = new HTMLRewriter()
    .on('head > title', { element: (e) => void e.setInnerContent(m.docTitle) })
    .on('meta[name="description"]', content(m.description))
    .on('meta[property="og:title"]', content(m.title))
    .on('meta[property="og:description"]', content(m.description))
    .on('meta[property="og:url"]', content(m.url))
    .on('meta[property="og:type"]', content(m.type))
    .on('meta[property="og:image"]', content(image.url))
    .on('meta[property="og:image:alt"]', content(image.alt))
    .on('meta[name="twitter:title"]', content(m.title))
    .on('meta[name="twitter:description"]', content(m.description))
    .on('meta[name="twitter:image"]', content(image.url))
    .on('meta[name="twitter:image:alt"]', content(image.alt))
    .on('link[rel="canonical"]', set('href', m.url));
  if (m.image) {
    // The default image's dimensions and type do not describe a photo.
    rw = rw.on('meta[property="og:image:width"], meta[property="og:image:height"], meta[property="og:image:type"]', {
      element: (e) => void e.remove(),
    });
  }
  return rw.transform(shell);
}

/** Copies the shell's headers, drops validators that describe the unmodified file, adds the security headers. */
function finish(body: BodyInit | null, shell: Response): Response {
  const headers = new Headers(shell.headers);
  headers.delete('etag');
  headers.delete('last-modified');
  headers.delete('content-length');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(body, { status: shell.status, headers });
}

// The shared tsconfig also loads the DOM lib, whose CacheStorage lacks the Workers `default`.
const workersDefaultCache: CacheProvider = async () => (caches as unknown as { default: Cache }).default;
const cacheKey = (pathname: string) => new Request(`https://cache.internal/share-meta/v1${pathname}`);

/**
 * Share routes; mount at the root AFTER the /api routes. wrangler.toml run_worker_first sends
 * /p/*, /u/*, /t/* and /profile/* here; every other page is served from static assets.
 */
export function shareMetaRoutes(opts: ShareMetaOptions = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  const cacheProvider = opts.cache ?? workersDefaultCache;

  const handler = async (c: Context<{ Bindings: Env }>) => {
    const reqUrl = new URL(c.req.url);
    if (!c.env.ASSETS) return c.text('assets binding missing', 500);
    // `/` is the shell itself (`/index.html` would redirect under the default html_handling).
    const shell = await c.env.ASSETS.fetch(new Request(new URL('/', reqUrl), { headers: { accept: 'text/html' } }));
    const route = parseRoute(reqUrl.pathname);
    if (!shell.ok || !route) return finish(shell.body, shell);

    let meta: ShareMeta | null = null;
    try {
      const cache = cacheProvider ? await cacheProvider() : null;
      const key = cacheKey(new URL(canonicalUrl(route)).pathname);
      const hit = cache ? await cache.match(key) : undefined;
      if (hit) {
        meta = (await hit.json()) as ShareMeta;
      } else {
        meta = await lookup(c.env.DB, route);
        // Only found entities are cached, so a page indexed a minute after a miss is not stuck on
        // the default card. Keyed on the canonical path: query strings cannot bust it.
        if (meta && cache) {
          const put = cache.put(key, new Response(JSON.stringify(meta), { headers: { 'Cache-Control': `public, max-age=${SHARE_META_MAX_AGE}` } }));
          try {
            c.executionCtx.waitUntil(put);
          } catch {
            await put.catch(() => {}); // no execution context (tests)
          }
        }
      }
    } catch {
      meta = null; // D1 or cache trouble: the default card, never an error page
    }
    if (!meta) return finish(shell.body, shell);
    return finish(await rewrite(shell, meta).text(), shell);
  };

  for (const prefix of ['/p/*', '/u/*', '/t/*', '/profile/*', '/p', '/u', '/t', '/profile']) app.get(prefix, handler);
  return app;
}
