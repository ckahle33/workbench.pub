import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import headersFile from '../public/_headers?raw';
import wranglerToml from '../wrangler.toml?raw';
import { blockDid, hideUri, putProfile, upsertProject, upsertReply, upsertTopic, upsertUpdate } from '../shared/db';
import type { ImageDef } from '../shared/types';
import { createApp, type AppOptions } from './app';
import { SECURITY_HEADERS } from './securityHeaders';
import { cleanText } from '../shared/cleanText';
import { DEFAULT_DESCRIPTION, DEFAULT_IMAGE, DEFAULT_IMAGE_ALT, DEFAULT_TITLE, OG_PHOTO_MAX_BYTES } from './shareMeta';

const realDb = (env as unknown as { DB: D1Database }).DB;

// Real-looking ids: the blob proxy only serves did:plc (24 base32 chars) / did:web and CIDv1/v0.
const ALICE = 'did:plc:' + 'a'.repeat(24);
const BOB = 'did:plc:' + 'b'.repeat(24);
const CID1 = 'bafkrei' + 'c'.repeat(45);
const CID2 = 'bafkrei' + 'd'.repeat(45);
const CID3 = 'bafkrei' + 'e'.repeat(45);
const P1 = `at://${ALICE}/pub.workbench.project/p1`;
const DATE = '2026-11-07T12:00:00.000Z';

/** Counts prepared statements, so a cache hit is visible as 0 D1 queries. */
function countingDb() {
  const counter = { prepares: 0 };
  const db = new Proxy(realDb, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        return (sql: string) => {
          counter.prepares++;
          return target.prepare(sql);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return { db, counter };
}

/** Stands in for the ASSETS binding: serves the source index.html shell with an asset-like header. */
const assets = {
  fetch: async (req: Request) => {
    const path = new URL(req.url).pathname;
    if (path !== '/') return new Response('unexpected asset path ' + path, { status: 500 });
    return new Response(indexHtml, { headers: { 'content-type': 'text/html; charset=utf-8', etag: '"abc"', 'cache-control': 'public, max-age=0, must-revalidate' } });
  },
} as unknown as Fetcher;

let n = 0;
async function setup(withCache = true, assetsBinding: Fetcher | null = assets, shareRewrite?: AppOptions['shareRewrite']) {
  const cache = await caches.open(`share-test-${++n}-${Math.random()}`);
  const { db, counter } = countingDb();
  const app = createApp({ edgeCache: false, shareCache: withCache ? async () => cache : false, shareRewrite });
  const get = (path: string, init: RequestInit = {}) =>
    app.request(`https://workbench.pub${path}`, init, { ...env, DB: db, ASSETS: assetsBinding ?? undefined });
  return { get, counter, cache };
}

/** Parses the head meta tags with HTMLRewriter (so the test reads what a crawler's parser reads). */
async function readHead(res: Response) {
  const meta: Record<string, string> = {};
  let title = '';
  let canonical: string | null = null;
  let scripts = 0;
  let injected = 0;
  await new HTMLRewriter()
    .on('title', { text: (t) => void (title += t.text) })
    .on('meta', {
      element: (e) => {
        const k = e.getAttribute('property') ?? e.getAttribute('name');
        if (k) meta[k] = decode(e.getAttribute('content') ?? '');
      },
    })
    .on('link[rel="canonical"]', { element: (e) => void (canonical = e.getAttribute('href')) })
    .on('script', { element: () => void scripts++ })
    .on('b, img, iframe, style', { element: () => void injected++ })
    .transform(res)
    .text();
  return { title: decode(title), meta, canonical, scripts, injected };
}
const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const img = (cid: string, size = 200_000, mimeType = 'image/jpeg', alt = 'The pedal on the bench'): ImageDef => ({
  image: { $type: 'blob', ref: { $link: cid }, mimeType, size },
  alt,
});

const seedProject = (o: { did?: string; rkey?: string; title?: string; summary?: string; cover?: ImageDef['image'] } = {}) => {
  const did = o.did ?? ALICE;
  const rkey = o.rkey ?? 'p1';
  return upsertProject(realDb, { uri: `at://${did}/pub.workbench.project/${rkey}`, did, rkey, indexedAt: 10 }, {
    $type: 'pub.workbench.project', title: o.title ?? 'Fuzz pedal', summary: o.summary ?? 'A one-knob fuzz from a magazine schematic.',
    topic: 'electronics', status: 'in-progress', cover: o.cover, createdAt: DATE,
  });
};
const seedUpdate = (rkey: string, o: { did?: string; project?: string; heading?: string; body?: string; images?: ImageDef[]; indexedAt?: number } = {}) => {
  const did = o.did ?? ALICE;
  return upsertUpdate(realDb, { uri: `at://${did}/pub.workbench.update/${rkey}`, did, rkey, indexedAt: o.indexedAt ?? 20 }, {
    $type: 'pub.workbench.update', project: o.project ?? P1, heading: o.heading ?? 'Breadboard works',
    body: o.body ?? 'It fuzzes. It also hums.', images: o.images, createdAt: DATE,
  });
};

beforeEach(async () => {
  for (const t of ['topics', 'projects', 'updates', 'replies', 'follows', 'profiles', 'blocked_dids']) await realDb.prepare(`DELETE FROM ${t}`).run();
  await upsertTopic(realDb, {
    slug: 'electronics', name: 'Electronics', description: 'Circuits, pedals and synths.', uri: `at://${ALICE}/pub.workbench.topic/electronics`,
    ownerDid: ALICE, indexedAt: 1,
  });
});

function expectDefault(h: Awaited<ReturnType<typeof readHead>>) {
  expect(h.title).toBe(DEFAULT_TITLE);
  expect(h.meta['og:title']).toBe(DEFAULT_TITLE);
  expect(h.meta['description']).toBe(DEFAULT_DESCRIPTION);
  expect(h.meta['og:image']).toBe(DEFAULT_IMAGE);
  expect(h.meta['og:url']).toBe('https://workbench.pub/');
  expect(h.meta['og:type']).toBe('website');
  expect(h.canonical).toBe('https://workbench.pub/');
}

describe('share meta: projects', () => {
  it('injects the project title, summary, url and article type, and keeps the SPA shell', async () => {
    await seedProject();
    await seedUpdate('u1');
    const { get } = await setup();
    const r = await get('/p/' + ALICE + '/p1');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^text\/html/);
    const h = await readHead(r);
    expect(h.title).toBe('Fuzz pedal · workbench.pub');
    expect(h.meta['og:title']).toBe('Fuzz pedal');
    expect(h.meta['twitter:title']).toBe('Fuzz pedal');
    expect(h.meta['description']).toBe('A one-knob fuzz from a magazine schematic.');
    expect(h.meta['og:description']).toBe('A one-knob fuzz from a magazine schematic.');
    expect(h.meta['twitter:description']).toBe('A one-knob fuzz from a magazine schematic.');
    expect(h.meta['og:url']).toBe(`https://workbench.pub/p/${ALICE}/p1`);
    expect(h.canonical).toBe(`https://workbench.pub/p/${ALICE}/p1`);
    expect(h.meta['og:type']).toBe('article');
    expect(h.meta['twitter:card']).toBe('summary_large_image');
    expect(h.meta['og:site_name']).toBe('workbench.pub');
    expect(h.meta['og:image']).toBe(DEFAULT_IMAGE);
    expect(h.meta['og:image:width']).toBe('1200');
    expect(h.meta['robots']).toBeUndefined();
    expect(h.scripts).toBe(1); // the SPA entry script is still there
  });

  it('falls back to the latest update notes when the summary is empty', async () => {
    await seedProject({ summary: '' });
    await seedUpdate('u1', { body: 'Older notes', indexedAt: 20 });
    await seedUpdate('u2', { body: 'Newer notes\n\nwith a second paragraph', indexedAt: 30 });
    const { get } = await setup();
    const h = await readHead(await get(`/p/${ALICE}/p1`));
    expect(h.meta['description']).toBe('Newer notes with a second paragraph');
  });

  it('uses the latest update photo, else the cover, else the default image', async () => {
    await seedProject({ cover: img(CID3).image });
    await seedUpdate('u1', { images: [img(CID1, 100_000, 'image/png', 'Older photo')], indexedAt: 20 });
    await seedUpdate('u2', { images: [img(CID2)], indexedAt: 30 });
    await seedUpdate('u3', { indexedAt: 40 }); // newest, no photo
    const { get } = await setup(false);
    let h = await readHead(await get(`/p/${ALICE}/p1`));
    expect(h.meta['og:image']).toBe(`https://workbench.pub/api/blob/${ALICE}/${CID2}`);
    expect(h.meta['twitter:image']).toBe(`https://workbench.pub/api/blob/${ALICE}/${CID2}`);
    expect(h.meta['og:image:alt']).toBe('The pedal on the bench');
    expect(h.meta['twitter:image:alt']).toBe('The pedal on the bench');
    // Photo dimensions are unknown: the default image's width/height tags are removed.
    expect(h.meta['og:image:width']).toBeUndefined();
    expect(h.meta['og:image:height']).toBeUndefined();
    expect(h.meta['og:image:type']).toBeUndefined();

    await hideUri(realDb, `at://${ALICE}/pub.workbench.update/u2`);
    await hideUri(realDb, `at://${ALICE}/pub.workbench.update/u1`);
    h = await readHead(await get(`/p/${ALICE}/p1`));
    expect(h.meta['og:image']).toBe(`https://workbench.pub/api/blob/${ALICE}/${CID3}`);
    expect(h.meta['og:image:alt']).toBe('Cover photo for Fuzz pedal');
  });

  it('never uses a photo by another DID on the project (non-owner update)', async () => {
    await seedProject();
    await seedUpdate('evil', { did: BOB, images: [img(CID1)], body: 'not the owner' });
    const { get } = await setup();
    const h = await readHead(await get(`/p/${ALICE}/p1`));
    expect(h.meta['og:image']).toBe(DEFAULT_IMAGE);
  });

  it('serves default meta (200) for a hidden project, a blocked author, an unknown rkey and a malformed DID', async () => {
    await seedProject({ title: 'Secret hidden title' });
    await seedProject({ did: BOB, rkey: 'pb', title: 'Blocked title' });
    await hideUri(realDb, P1);
    await blockDid(realDb, BOB);
    const { get } = await setup();
    for (const path of [`/p/${ALICE}/p1`, `/p/${BOB}/pb`, `/p/${ALICE}/nope`, '/p/not-a-did/p1', '/p/did:plc:x/%E0%A4%A', '/p/x/y/z', '/p/', '/p']) {
      const r = await get(path);
      expect(r.status, path).toBe(200);
      const html = await r.clone().text();
      expect(html).not.toContain('Secret');
      expect(html).not.toContain('Blocked');
      expectDefault(await readHead(r));
    }
  });

  it('serves the unmodified shell for the New update form without touching D1', async () => {
    await seedProject();
    const { get, counter } = await setup();
    const r = await get(`/p/${ALICE}/p1/update`);
    expect(r.status).toBe(200);
    expectDefault(await readHead(r));
    expect(counter.prepares).toBe(0);
  });
});

describe('share meta: updates', () => {
  it('injects heading, project title, notes and the first photo', async () => {
    await seedProject();
    await seedUpdate('u1', { heading: 'Stripboard layout', body: 'Cut the tracks with a drill bit.', images: [img(CID1), img(CID2)] });
    const { get } = await setup();
    const h = await readHead(await get(`/u/${ALICE}/u1`));
    expect(h.title).toBe('Stripboard layout — Fuzz pedal · workbench.pub');
    expect(h.meta['og:title']).toBe('Stripboard layout — Fuzz pedal');
    expect(h.meta['description']).toBe('Cut the tracks with a drill bit.');
    expect(h.meta['og:url']).toBe(`https://workbench.pub/u/${ALICE}/u1`);
    expect(h.meta['og:type']).toBe('article');
    expect(h.meta['og:image']).toBe(`https://workbench.pub/api/blob/${ALICE}/${CID1}`);
  });

  it('truncates long notes to about 200 characters with an ellipsis', async () => {
    await seedProject();
    await seedUpdate('u1', { body: 'word '.repeat(200) });
    const { get } = await setup();
    const h = await readHead(await get(`/u/${ALICE}/u1`));
    expect([...h.meta['description']].length).toBeLessThanOrEqual(200);
    expect(h.meta['description'].endsWith('…')).toBe(true);
  });

  it('falls back to the default image for an oversize, non-raster or malformed photo', async () => {
    await seedProject();
    await seedUpdate('big', { images: [img(CID1, OG_PHOTO_MAX_BYTES + 1)] });
    await seedUpdate('svg', { images: [img(CID1, 1000, 'image/svg+xml')] });
    await seedUpdate('bad', { images: [{ image: { $type: 'blob', ref: { $link: 'not a cid"><x' }, mimeType: 'image/png', size: 10 }, alt: 'x' }] });
    const { get } = await setup();
    for (const rkey of ['big', 'svg', 'bad']) {
      const h = await readHead(await get(`/u/${ALICE}/${rkey}`));
      expect(h.meta['og:image'], rkey).toBe(DEFAULT_IMAGE);
      expect(h.meta['og:image:width'], rkey).toBe('1200');
    }
  });

  it('serves default meta for a hidden update, an update by another DID, and an update on a hidden project', async () => {
    await seedProject();
    await seedUpdate('hid', { heading: 'Hidden heading' });
    await hideUri(realDb, `at://${ALICE}/pub.workbench.update/hid`);
    await seedUpdate('evil', { did: BOB, heading: 'Evil heading' });
    await seedProject({ rkey: 'p2', title: 'Hidden project' });
    await seedUpdate('onhidden', { project: `at://${ALICE}/pub.workbench.project/p2`, heading: 'Visible heading on hidden project' });
    await hideUri(realDb, `at://${ALICE}/pub.workbench.project/p2`);
    const { get } = await setup();
    for (const path of [`/u/${ALICE}/hid`, `/u/${BOB}/evil`, `/u/${ALICE}/onhidden`, `/u/${ALICE}/missing`]) {
      const r = await get(path);
      expect(r.status, path).toBe(200);
      const html = await r.clone().text();
      expect(html).not.toMatch(/Hidden heading|Evil heading|Visible heading/);
      expectDefault(await readHead(r));
    }
  });
});

describe('share meta: topics and profiles', () => {
  it('injects the topic name and description', async () => {
    const { get } = await setup();
    const h = await readHead(await get('/t/electronics'));
    expect(h.title).toBe('Electronics on workbench.pub');
    expect(h.meta['og:title']).toBe('Electronics on workbench.pub');
    expect(h.meta['description']).toBe('Circuits, pedals and synths.');
    expect(h.meta['og:type']).toBe('website');
    expect(h.meta['og:url']).toBe('https://workbench.pub/t/electronics');
    expect(h.meta['og:image']).toBe(DEFAULT_IMAGE);
  });

  it('uses a true generic line for a topic without a description; hidden or bad slugs get default meta', async () => {
    await upsertTopic(realDb, { slug: 'ceramics', name: 'Ceramics', description: '', uri: `at://${ALICE}/pub.workbench.topic/ceramics`, ownerDid: ALICE, indexedAt: 2 });
    await upsertTopic(realDb, { slug: 'secret', name: 'Secret topic', description: '', uri: `at://${ALICE}/pub.workbench.topic/secret`, ownerDid: ALICE, indexedAt: 3 });
    await hideUri(realDb, `at://${ALICE}/pub.workbench.topic/secret`);
    const { get } = await setup();
    expect((await readHead(await get('/t/ceramics'))).meta['description']).toBe('Ceramics projects on workbench.pub, each a dated timeline of photos and notes.');
    for (const path of ['/t/secret', '/t/NOPE!', '/t/' + 'a'.repeat(300), '/t/electronics/extra']) {
      const r = await get(path);
      expect(r.status, path).toBe(200);
      expectDefault(await readHead(r));
    }
  });

  it('names a profile from the cached profile row, only for DIDs with indexed content', async () => {
    await seedProject();
    await putProfile(realDb, { did: ALICE, handle: 'alice.example.com', displayName: 'Alice Maker', fetchedAt: Date.now() });
    await putProfile(realDb, { did: BOB, handle: 'bob.example.com', displayName: 'Bob Nobody', fetchedAt: Date.now() });
    const { get } = await setup();
    const h = await readHead(await get(`/profile/${ALICE}`));
    expect(h.title).toBe('Alice Maker on workbench.pub');
    expect(h.meta['description']).toBe('Projects by Alice Maker (@alice.example.com) on workbench.pub.');
    expect(h.meta['og:url']).toBe(`https://workbench.pub/profile/${ALICE}`);
    expect(h.meta['og:type']).toBe('website');
    // Bob has a cached profile but no visible content: default meta, nothing about Bob.
    const r = await get(`/profile/${BOB}`);
    expect(await r.clone().text()).not.toContain('Bob');
    expectDefault(await readHead(r));
    expectDefault(await readHead(await get('/profile/not-a-did')));
  });

  it('uses a generic line for a profile with content but no cached profile; a reply alone counts as content', async () => {
    await upsertReply(realDb, { uri: `at://${BOB}/pub.workbench.reply/r1`, did: BOB, rkey: 'r1', indexedAt: 5 }, {
      $type: 'pub.workbench.reply', subject: `at://${ALICE}/pub.workbench.update/u1`, body: 'Nice', createdAt: DATE,
    });
    const { get } = await setup();
    const h = await readHead(await get(`/profile/${BOB}`));
    expect(h.title).toBe('A maker on workbench.pub');
    expect(h.meta['description']).toBe('Projects and updates by a maker on workbench.pub.');
  });
});

describe('share meta: hostile text', () => {
  const hostile = [
    '"><script>alert(1)</script>',
    "it's a \"quoted\" & <b>bold</b> title &amp; &quot;",
    '</title><script>x</script>',
    'Pedal 🎸👩🏽‍🔧 build',
    'مشروع جديد \u202eevil\u202c done',
    'x'.repeat(5000),
  ];

  for (const title of hostile) {
    it(`escapes a hostile project title: ${title.slice(0, 30)}`, async () => {
      await seedProject({ title, summary: title });
      const { get } = await setup(false);
      const r = await get(`/p/${ALICE}/p1`);
      const html = await r.clone().text();
      // Raw text: no tag-like sequence anywhere, not even inside an attribute value.
      expect(html.match(/<script/g)?.length).toBe(1);
      expect(html).not.toMatch(/<b>|<\/title>.*<\/title>/s);
      // Parsed like a crawler would: exactly one script element (the SPA entry), no injected elements.
      const h = await readHead(r);
      expect(h.scripts).toBe(1);
      expect(h.injected).toBe(0);
      // The title element holds text only: no raw '<' survives inside it.
      expect(html.match(/<title>([^]*?)<\/title>/)![1]).not.toContain('<');
      const expected = cleanText(title, 70);
      expect(h.meta['og:title']).toBe(expected);
      expect(h.title).toBe(`${expected} · workbench.pub`);
      expect([...new Intl.Segmenter().segment(h.meta['og:title'])].length).toBeLessThanOrEqual(70);
      expect(h.meta['og:title']).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/);
    });
  }
});

describe('share meta: caching and headers', () => {
  it('serves a repeat request for the same page without touching D1', async () => {
    await seedProject();
    const { get, counter } = await setup();
    const r1 = await get(`/p/${ALICE}/p1`);
    expect((await readHead(r1)).meta['og:title']).toBe('Fuzz pedal');
    const after1 = counter.prepares;
    expect(after1).toBe(1); // one D1 query per lookup
    const r2 = await get(`/p/${ALICE}/p1?utm_source=x`);
    expect((await readHead(r2)).meta['og:title']).toBe('Fuzz pedal');
    expect(counter.prepares).toBe(after1);
  });

  it('does not cache a miss, so content indexed a moment later is picked up', async () => {
    const { get, counter } = await setup();
    expectDefault(await readHead(await get(`/p/${ALICE}/p1`)));
    await seedProject();
    const before = counter.prepares;
    expect((await readHead(await get(`/p/${ALICE}/p1`))).meta['og:title']).toBe('Fuzz pedal');
    expect(counter.prepares).toBe(before + 1);
  });

  it('every lookup costs exactly one D1 query', async () => {
    await seedProject();
    await seedUpdate('u1');
    const { get, counter } = await setup(false);
    for (const path of [`/p/${ALICE}/p1`, `/u/${ALICE}/u1`, '/t/electronics', `/profile/${ALICE}`]) {
      const before = counter.prepares;
      await (await get(path)).text();
      expect(counter.prepares - before, path).toBe(1);
    }
  });

  it('sets the security headers from public/_headers and drops the asset ETag', async () => {
    await seedProject();
    const { get } = await setup();
    for (const path of [`/p/${ALICE}/p1`, `/p/${ALICE}/missing`, `/p/${ALICE}/p1/update`]) {
      const r = await get(path);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(r.headers.get(k), `${path} ${k}`).toBe(v);
      expect(r.headers.get('etag')).toBeNull();
      expect(r.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    }
  });

  it('SECURITY_HEADERS matches the /* block of public/_headers exactly', () => {
    const lines = headersFile.split('\n');
    const start = lines.indexOf('/*');
    const parsed: Record<string, string> = {};
    for (const line of lines.slice(start + 1)) {
      if (!/^\s+\S/.test(line)) break;
      const i = line.indexOf(':');
      parsed[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    expect(Object.keys(parsed).length).toBeGreaterThan(3);
    expect(SECURITY_HEADERS).toEqual(parsed);
  });

  it('leaves /api routes alone', async () => {
    const { get } = await setup();
    const r = await get('/api/topics');
    expect(r.headers.get('content-type')).toMatch(/json/);
  });
});

describe('share meta: failures never become an error page', () => {
  const shellResponse = () => new Response(indexHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  /** An ASSETS stub whose first `failures` calls misbehave via `fail`, then serves the shell. */
  const flaky = (failures: number, fail: () => Response) => {
    let calls = 0;
    return { fetch: async () => (++calls <= failures ? fail() : shellResponse()) } as unknown as Fetcher;
  };
  const expectShell = async (r: Response) => {
    expect(r.status).toBe(200);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(r.headers.get(k), k).toBe(v);
    expectDefault(await readHead(r));
  };

  it('serves the unmodified shell when ASSETS.fetch throws once', async () => {
    await seedProject();
    const { get } = await setup(true, flaky(1, () => { throw new Error('assets down'); }));
    await expectShell(await get(`/p/${ALICE}/p1`));
  });

  it('serves the unmodified shell when the rewriter throws, synchronously or while reading', async () => {
    await seedProject();
    const throwsNow = () => {
      throw new Error('rewriter broke');
    };
    const throwsLater = () =>
      new Response(new ReadableStream({ pull: (ctrl) => ctrl.error(new Error('rewriter broke mid-stream')) }));
    for (const rw of [throwsNow, throwsLater]) {
      const { get } = await setup(false, assets, rw);
      await expectShell(await get(`/p/${ALICE}/p1`));
    }
  });

  it('answers 503 text with the security headers when the shell cannot be read at all', async () => {
    await seedProject();
    for (const binding of [flaky(99, () => { throw new Error('assets down'); }), null]) {
      const { get } = await setup(true, binding);
      const r = await get(`/p/${ALICE}/p1`);
      expect(r.status).toBe(503);
      expect(r.headers.get('content-type')).toMatch(/^text\/plain/);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(r.headers.get(k), k).toBe(v);
    }
  });

  it('reads at most a bounded prefix of long text columns from D1', async () => {
    await seedProject({ summary: '' });
    await seedUpdate('u1', { body: 'x'.repeat(50_000), heading: 'h'.repeat(5_000) });
    const { get } = await setup(false);
    const p = await readHead(await get(`/p/${ALICE}/p1`));
    expect(p.meta['description'].endsWith('…')).toBe(true);
    const u = await readHead(await get(`/u/${ALICE}/u1`));
    expect([...u.meta['og:title']].length).toBeLessThanOrEqual(70 + 3 + 50);
    expect(u.meta['description'].endsWith('…')).toBe(true);
  });
});

describe('static shell and routing config', () => {
  it('index.html carries the full default tag set', async () => {
    const h = await readHead(new Response(indexHtml));
    expect(h.title).toBe(DEFAULT_TITLE);
    expect(h.canonical).toBe('https://workbench.pub/');
    expect(h.meta).toMatchObject({
      description: DEFAULT_DESCRIPTION,
      'og:site_name': 'workbench.pub',
      'og:locale': 'en_US',
      'og:type': 'website',
      'og:url': 'https://workbench.pub/',
      'og:title': DEFAULT_TITLE,
      'og:description': DEFAULT_DESCRIPTION,
      'og:image': DEFAULT_IMAGE,
      'og:image:width': '1200',
      'og:image:height': '630',
      'og:image:alt': DEFAULT_IMAGE_ALT,
      'twitter:card': 'summary_large_image',
      'twitter:title': DEFAULT_TITLE,
      'twitter:description': DEFAULT_DESCRIPTION,
      'twitter:image': DEFAULT_IMAGE,
      'twitter:image:alt': DEFAULT_IMAGE_ALT,
      'theme-color': '#ffffff',
    });
    expect(indexHtml).toMatch(/<link rel="icon" href="\/favicon.svg" type="image\/svg\+xml"/);
    // favicon.ico first (crawlers, RSS readers, older browsers), then the SVG.
    const ico = indexHtml.indexOf('<link rel="icon" href="/favicon.ico" sizes="32x32" />');
    expect(ico).toBeGreaterThan(-1);
    expect(ico).toBeLessThan(indexHtml.indexOf('href="/favicon.svg"'));
    expect(indexHtml).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
  });

  it('run_worker_first sends only /api and the four share routes to the Worker, never static assets', () => {
    const m = wranglerToml.match(/^run_worker_first\s*=\s*(\[.*\])\s*$/m);
    expect(m).not.toBeNull();
    const patterns = JSON.parse(m![1]) as string[];
    expect(patterns).toEqual(['/api/*', '/p/*', '/u/*', '/t/*', '/profile/*']);
    // The docs: `*` matches deeply; negatives (`!`) win. None are used here.
    const toRe = (p: string) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    const hitsWorker = (path: string) => patterns.some((p) => !p.startsWith('!') && toRe(p).test(path)) && !patterns.some((p) => p.startsWith('!') && toRe(p.slice(1)).test(path));
    for (const path of [`/p/${ALICE}/p1`, `/p/${ALICE}/p1/update`, `/u/${ALICE}/u1`, '/t/electronics', `/profile/${ALICE}`, '/api/feed']) {
      expect(hitsWorker(path), path).toBe(true);
    }
    for (const path of ['/', '/feed', '/about', '/new', '/signin', '/assets/index-abc.js', '/assets/inter-tight.woff2', '/og.png', '/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/client-metadata.json', '/index.html', '/profile', '/people/x']) {
      expect(hitsWorker(path), path).toBe(false);
    }
  });
});
