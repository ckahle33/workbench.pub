import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { FEED_SCAN_MULTIPLIER, FEED_SCAN_WINDOW, feedScanWindow, hideUri, upsertFollow, upsertProject, upsertReply, upsertTopic, upsertUpdate } from '../../shared/db';
import { createApp } from '../index';

// Edge caching is tested in functions/edgeCache.test.ts; off here so tests see fresh D1 data.
const app = createApp({ edgeCache: false });
import { readRoutes } from './read';

const db = (env as unknown as { DB: D1Database }).DB;
const bindings = env as unknown as Record<string, unknown>;

const ALICE = 'did:plc:alice';
const BOB = 'did:plc:bob';
const P1 = `at://${ALICE}/pub.workbench.project/p1`;
const P2 = `at://${BOB}/pub.workbench.project/p2`;

const get = (path: string) => app.request(path, {}, bindings);

const seedProject = (uri: string, topic = 'woodworking', indexedAt = 100) => {
  const [did, , rkey] = uri.slice(5).split('/');
  return upsertProject(db, { uri, did, rkey, indexedAt }, {
    $type: 'pub.workbench.project', title: `title ${rkey}`, summary: 's', topic, status: 'in-progress',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
};
const seedUpdate = (project: string, rkey: string, indexedAt: number, did = ALICE) =>
  upsertUpdate(db, { uri: `at://${did}/pub.workbench.update/${rkey}`, did, rkey, indexedAt }, {
    $type: 'pub.workbench.update', project, heading: `h ${rkey}`, body: 'b', createdAt: '2026-01-01T00:00:00.000Z',
  });
const updUri = (rkey: string, did = ALICE) => `at://${did}/pub.workbench.update/${rkey}`;

beforeEach(async () => {
  for (const t of ['topics', 'projects', 'updates', 'replies', 'follows', 'profiles']) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
  await upsertTopic(db, {
    slug: 'woodworking', name: 'Woodworking', description: 'd', uri: `at://${ALICE}/pub.workbench.topic/woodworking`,
    ownerDid: ALICE, indexedAt: 1,
  });
});

describe('feed', () => {
  it('returns newest indexed first', async () => {
    await seedProject(P1);
    await seedUpdate(P1, 'u1', 200);
    await seedUpdate(P1, 'u2', 300);
    const body = (await (await get('/api/feed')).json()) as { items: { rkey: string }[]; cursor: string | null };
    expect(body.items.map((i) => i.rkey)).toEqual(['u2', 'u1']);
    expect(body.cursor).toBeNull();
  });

  it('paginates with the cursor, each item exactly once (including ties)', async () => {
    await seedProject(P1);
    for (let i = 0; i < 7; i++) await seedUpdate(P1, `u${i}`, 200 + Math.floor(i / 2));
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await get(`/api/feed?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const body = (await res.json()) as { items: { rkey: string }[]; cursor: string | null };
      seen.push(...body.items.map((i) => i.rkey));
      cursor = body.cursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect([...seen].sort()).toEqual(['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
    expect(new Set(seen).size).toBe(7);
  });

  it('ignores an update whose author is not its project\'s owner (feed, timeline, permalink)', async () => {
    await seedProject(P1);
    await seedUpdate(P1, 'good', 200);
    await seedUpdate(P1, 'evil', 300, BOB);
    const feed = (await (await get('/api/feed')).json()) as { items: { rkey: string }[] };
    expect(feed.items.map((i) => i.rkey)).toEqual(['good']);
    const proj = (await (await get('/api/projects/did:plc:alice/p1')).json()) as { items: { rkey: string }[] };
    expect(proj.items.map((i) => i.rkey)).toEqual(['good']);
    const [, , r] = updUri('evil', BOB).slice(5).split('/');
    expect((await get(`/api/updates/${BOB}/${r}`)).status).toBe(404);
  });

  it('rejects a malformed cursor', async () => {
    expect((await get('/api/feed?cursor=nonsense')).status).toBe(400);
  });

  it('never shows hidden updates or updates of hidden projects', async () => {
    await seedProject(P1);
    await seedProject(P2);
    await seedUpdate(P1, 'u1', 200);
    await seedUpdate(P1, 'u2', 210);
    await seedUpdate(P2, 'u3', 220, BOB);
    await hideUri(db, updUri('u1'));
    await hideUri(db, P2);
    const body = (await (await get('/api/feed')).json()) as { items: { rkey: string }[] };
    expect(body.items.map((i) => i.rkey)).toEqual(['u2']);
  });

  it('omits updates whose project row is missing and still returns 200', async () => {
    await seedProject(P1);
    await seedUpdate(P1, 'u1', 200);
    await seedUpdate(`at://${ALICE}/pub.workbench.project/ghost`, 'orphan', 300);
    const res = await get('/api/feed');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: { rkey: string }[] }).items.map((i) => i.rkey)).toEqual(['u1']);
    expect((await get(`/api/updates/${ALICE}/orphan`)).status).toBe(404);
    expect((await get(`/api/profiles/${ALICE}`)).status).toBe(200);
  });

  it('drops updates from the feed once their project is deleted', async () => {
    await seedProject(P1);
    await seedUpdate(P1, 'u1', 200);
    await db.prepare('DELETE FROM projects WHERE uri = ?').bind(P1).run();
    const feed = (await (await get('/api/feed')).json()) as { items: unknown[] };
    expect(feed.items).toEqual([]);
    expect((await get(`/api/projects/${ALICE}/p1`)).status).toBe(404);
    expect((await get(`/api/updates/${ALICE}/u1`)).status).toBe(404);
  });

  it('filters to followed projects and topics with ?following=', async () => {
    await seedProject(P1, 'woodworking');
    await seedProject(P2, 'electronics');
    await seedUpdate(P1, 'u1', 200);
    await seedUpdate(P2, 'u2', 210, BOB);
    const carol = 'did:plc:carol';
    const none = (await (await get(`/api/feed?following=${carol}`)).json()) as { items: unknown[] };
    expect(none.items).toEqual([]);
    await upsertFollow(db, { uri: `at://${carol}/pub.workbench.follow/f1`, did: carol, rkey: 'f1', indexedAt: 1 }, {
      $type: 'pub.workbench.follow', kind: 'project', subject: P2, createdAt: '2026-01-01T00:00:00.000Z',
    });
    await upsertFollow(db, { uri: `at://${carol}/pub.workbench.follow/f2`, did: carol, rkey: 'f2', indexedAt: 1 }, {
      $type: 'pub.workbench.follow', kind: 'topic', subject: 'woodworking', createdAt: '2026-01-01T00:00:00.000Z',
    });
    const both = (await (await get(`/api/feed?following=${carol}`)).json()) as { items: { rkey: string }[] };
    expect(both.items.map((i) => i.rkey)).toEqual(['u2', 'u1']);
  });
});

describe('feed scan bound', () => {
  it('returns a continuing cursor when the head of the index is all orphans', async () => {
    await seedProject(P1);
    await seedUpdate(P1, 'visible', 100);
    const ghost = `at://${ALICE}/pub.workbench.project/ghost`;
    const stmts = [];
    for (let i = 0; i < FEED_SCAN_WINDOW + 5; i++) {
      stmts.push(db.prepare(
        `INSERT INTO updates (uri, did, rkey, project_uri, heading, body, created_at, indexed_at)
         VALUES (?, ?, ?, ?, 'h', 'b', 'x', ?)`,
      ).bind(updUri(`o${i}`), ALICE, `o${i}`, ghost, 1000 + i));
    }
    await db.batch(stmts);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      // limit 100: the scan window is the full FEED_SCAN_WINDOW (min(200, 100 * 3)).
      const res = await get(`/api/feed?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const body = (await res.json()) as { items: { rkey: string }[]; cursor: string | null };
      if (pages === 0) {
        expect(body.items).toEqual([]);
        expect(body.cursor).not.toBeNull();
      }
      seen.push(...body.items.map((i) => i.rkey));
      cursor = body.cursor;
      pages++;
    } while (cursor && pages < 10);
    expect(seen).toEqual(['visible']);
    expect(pages).toBe(2);
  });

  it('sizes the scan window to the request: limit * FEED_SCAN_MULTIPLIER rows', async () => {
    expect(feedScanWindow(5)).toBe(5 * FEED_SCAN_MULTIPLIER);
    expect(feedScanWindow(100)).toBe(FEED_SCAN_WINDOW);
    await seedProject(P1);
    await seedUpdate(P1, 'visible', 100);
    const ghost = `at://${ALICE}/pub.workbench.project/ghost`;
    const stmts = [];
    for (let i = 0; i < feedScanWindow(5) + 1; i++) {
      stmts.push(db.prepare(
        `INSERT INTO updates (uri, did, rkey, project_uri, heading, body, created_at, indexed_at)
         VALUES (?, ?, ?, ?, 'h', 'b', 'x', ?)`,
      ).bind(updUri(`o${i}`), ALICE, `o${i}`, ghost, 1000 + i));
    }
    await db.batch(stmts);
    const first = (await (await get('/api/feed?limit=5')).json()) as { items: unknown[]; cursor: string | null };
    expect(first.items).toEqual([]);
    expect(first.cursor).not.toBeNull();
    const next = (await (await get(`/api/feed?limit=5&cursor=${encodeURIComponent(first.cursor!)}`)).json()) as {
      items: { rkey: string }[];
      cursor: string | null;
    };
    expect(next.items.map((i) => i.rkey)).toEqual(['visible']);
    expect(next.cursor).toBeNull();
  });
});

describe('topics', () => {
  it('paginates the topic list by slug', async () => {
    for (const slug of ['b-topic', 'c-topic', 'a-topic']) {
      await upsertTopic(db, { slug, name: slug, description: '', uri: `at://${ALICE}/pub.workbench.topic/${slug}`, ownerDid: ALICE, indexedAt: 2 });
    }
    const p1 = (await (await get('/api/topics?limit=2')).json()) as { items: { slug: string }[]; cursor: string | null };
    expect(p1.items.map((t) => t.slug)).toEqual(['a-topic', 'b-topic']);
    expect(p1.cursor).toBe('b-topic');
    const p2 = (await (await get(`/api/topics?limit=2&cursor=${p1.cursor}`)).json()) as { items: { slug: string }[]; cursor: string | null };
    expect(p2.items.map((t) => t.slug)).toEqual(['c-topic', 'woodworking']);
    expect(p2.cursor).toBeNull();
  });

  it('lists topics and returns 404 for an unknown slug', async () => {
    const list = (await (await get('/api/topics')).json()) as { items: { slug: string }[] };
    expect(list.items.map((t) => t.slug)).toEqual(['woodworking']);
    expect((await get('/api/topics/nope')).status).toBe(404);
  });

  it('returns a topic with its visible projects', async () => {
    await seedProject(P1, 'woodworking', 100);
    await seedProject(P2, 'woodworking', 200);
    await seedProject(`at://${ALICE}/pub.workbench.project/p3`, 'electronics', 300);
    await hideUri(db, P2);
    const body = (await (await get('/api/topics/woodworking')).json()) as {
      topic: { slug: string }; items: { rkey: string }[];
    };
    expect(body.topic.slug).toBe('woodworking');
    expect(body.items.map((p) => p.rkey)).toEqual(['p1']);
  });
});

describe('projects, updates, profiles', () => {
  it('returns a project with updates newest first, hiding hidden ones', async () => {
    await seedProject(P1);
    await seedUpdate(P1, 'u1', 200);
    await seedUpdate(P1, 'u2', 300);
    await seedUpdate(P1, 'u3', 400);
    await hideUri(db, updUri('u3'));
    const body = (await (await get(`/api/projects/${ALICE}/p1`)).json()) as {
      project: { title: string }; items: { rkey: string }[];
    };
    expect(body.project.title).toBe('title p1');
    expect(body.items.map((u) => u.rkey)).toEqual(['u2', 'u1']);
  });

  it('paginates project updates newest first, exactly once, excluding hidden ones', async () => {
    await seedProject(P1);
    await seedProject(P2);
    for (let i = 1; i <= 5; i++) await seedUpdate(P1, `u${i}`, 100 + i);
    await seedUpdate(P1, 'tie', 103); // same indexed_at as u3: uri breaks the tie
    await seedUpdate(P2, 'other', 999);
    await hideUri(db, updUri('u4'));
    type Body = { project: { title: string }; items: { rkey: string }[]; cursor: string | null };
    const page1 = (await (await get(`/api/projects/${ALICE}/p1?limit=2`)).json()) as Body;
    expect(page1.items.map((u) => u.rkey)).toEqual(['u5', 'u3']);
    expect(page1.cursor).not.toBeNull();
    expect(page1.project.title).toBe('title p1');
    const page2 = (await (await get(`/api/projects/${ALICE}/p1?limit=2&cursor=${encodeURIComponent(page1.cursor!)}`)).json()) as Body;
    expect(page2.project.title).toBe('title p1');
    const page3 = (await (await get(`/api/projects/${ALICE}/p1?limit=2&cursor=${encodeURIComponent(page2.cursor!)}`)).json()) as Body;
    const all = [...page1.items, ...page2.items, ...page3.items].map((u) => u.rkey);
    expect(all.sort()).toEqual(['tie', 'u1', 'u2', 'u3', 'u5']);
    expect(new Set(all).size).toBe(all.length);
    expect(page3.cursor).toBeNull();
  });

  it('rejects a bad project cursor and clamps the limit', async () => {
    await seedProject(P1);
    expect((await get(`/api/projects/${ALICE}/p1?cursor=garbage`)).status).toBe(400);
    expect((await get(`/api/projects/${ALICE}/p1?limit=100000`)).status).toBe(200);
  });

  it('seeks the project updates by index, not a table scan', async () => {
    const plan = await db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM updates WHERE project_uri = ? AND hidden = 0 AND did = ? AND (indexed_at, uri) < (?, ?)
         ORDER BY indexed_at DESC, uri DESC LIMIT ?`,
      )
      .bind(P1, ALICE, 1, 'at://x', 51)
      .all<{ detail: string }>();
    const text = plan.results.map((r) => r.detail).join('\n');
    expect(text).toMatch(/SEARCH updates USING INDEX idx_updates_project_visible/);
    expect(text).not.toMatch(/SCAN|TEMP B-TREE/);
  });

  it('404s a hidden or unknown project', async () => {
    await seedProject(P1);
    await hideUri(db, P1);
    expect((await get(`/api/projects/${ALICE}/p1`)).status).toBe(404);
    expect((await get(`/api/projects/${ALICE}/none`)).status).toBe(404);
  });

  it('returns an update with visible replies', async () => {
    await seedProject(P1);
    await seedUpdate(P1, 'u1', 200);
    const reply = (rkey: string, subject: string, t: number) =>
      upsertReply(db, { uri: `at://${BOB}/pub.workbench.reply/${rkey}`, did: BOB, rkey, indexedAt: t }, {
        $type: 'pub.workbench.reply', subject, body: rkey, createdAt: '2026-01-01T00:00:00.000Z',
      });
    await reply('r1', updUri('u1'), 1);
    await reply('r2', `at://${BOB}/pub.workbench.reply/r1`, 2);
    await reply('r3', updUri('u1'), 3);
    await reply('other', updUri('elsewhere'), 4);
    await hideUri(db, `at://${BOB}/pub.workbench.reply/r3`);
    const body = (await (await get(`/api/updates/${ALICE}/u1`)).json()) as {
      update: { heading: string }; items: { rkey: string }[];
    };
    expect(body.update.heading).toBe('h u1');
    expect(body.items.map((r) => r.rkey)).toEqual(['r1', 'r2']);
  });

  it('returns a profile with projects, fetching and caching via the injected fetch', async () => {
    await seedProject(P1);
    await seedProject(P2);
    let calls = 0;
    const local = readRoutes({
      fetchFn: async () => {
        calls++;
        return Response.json({ did: ALICE, handle: 'alice.test', displayName: 'Alice', avatar: 'https://x/a.jpg' });
      },
    });
    const req = () => local.request(`/profiles/${ALICE}`, {}, bindings);
    const body = (await (await req()).json()) as { profile: { handle: string; displayName: string }; items: { rkey: string }[] };
    expect(body.profile.handle).toBe('alice.test');
    expect(body.items.map((p) => p.rkey)).toEqual(['p1']);
    await req();
    expect(calls).toBe(1);
    // Expired cache refetches.
    await db.prepare('UPDATE profiles SET fetched_at = ?').bind(Date.now() - 25 * 3_600_000).run();
    await req();
    expect(calls).toBe(2);
  });

  it('still succeeds with just the did when the profile fetch fails', async () => {
    const failing = readRoutes({ fetchFn: async () => { throw new Error('offline'); } });
    const res = await failing.request(`/profiles/${ALICE}`, {}, bindings);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { profile: unknown }).profile).toEqual({ did: ALICE });
    const bad = readRoutes({ fetchFn: async () => new Response('no', { status: 500 }) });
    expect((await bad.request(`/profiles/${ALICE}`, {}, bindings)).status).toBe(200);
  });
});
