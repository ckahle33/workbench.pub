import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  blockDid,
  bumpAndCheckRate,
  deleteByUri,
  getCursor,
  hideUri,
  isBlocked,
  setCursor,
  upsertFollow,
  upsertProject,
  upsertReply,
  upsertTopic,
  upsertUpdate,
} from './db';

const db = (env as unknown as { DB: D1Database }).DB;

const meta = (uri: string) => ({ uri, did: 'did:plc:a', rkey: uri.split('/').pop()!, indexedAt: 1000 });
const count = async (table: string) =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

beforeEach(async () => {
  for (const t of ['topics', 'projects', 'updates', 'replies', 'follows', 'cursor', 'blocked_dids', 'ingest_counts']) {
    await db.prepare(`DELETE FROM ${t}`).run();
  }
});

const project = (title: string) => ({
  $type: 'pub.workbench.project' as const,
  title,
  summary: 's',
  topic: 'robots',
  status: 'in-progress' as const,
  createdAt: '2026-01-01T00:00:00Z',
});

describe('upserts', () => {
  it('upserting the same project twice yields one row, latest content', async () => {
    const uri = 'at://did:plc:a/pub.workbench.project/p1';
    await upsertProject(db, meta(uri), project('one'));
    await upsertProject(db, meta(uri), project('two'));
    expect(await count('projects')).toBe(1);
    const row = await db.prepare('SELECT title FROM projects WHERE uri = ?').bind(uri).first<{ title: string }>();
    expect(row!.title).toBe('two');
  });

  it('keeps hidden when a record is re-upserted', async () => {
    const uri = 'at://did:plc:a/pub.workbench.project/p1';
    await upsertProject(db, meta(uri), project('one'));
    await hideUri(db, uri);
    await upsertProject(db, meta(uri), project('two'));
    const row = await db.prepare('SELECT hidden FROM projects WHERE uri = ?').bind(uri).first<{ hidden: number }>();
    expect(row!.hidden).toBe(1);
  });

  it('upsertTopic keeps the first uri for a slug', async () => {
    const base = { slug: 'robots', name: 'Robots', description: 'd', ownerDid: 'did:plc:a', indexedAt: 1 };
    await upsertTopic(db, { ...base, uri: 'at://did:plc:a/pub.workbench.topic/first' });
    await upsertTopic(db, { ...base, uri: 'at://did:plc:b/pub.workbench.topic/second', ownerDid: 'did:plc:b' });
    expect(await count('topics')).toBe(1);
    const row = await db.prepare('SELECT uri FROM topics WHERE slug = ?').bind('robots').first<{ uri: string }>();
    expect(row!.uri).toBe('at://did:plc:a/pub.workbench.topic/first');
  });

  it('stores updates, replies and follows', async () => {
    await upsertUpdate(db, meta('at://did:plc:a/pub.workbench.update/u1'), {
      $type: 'pub.workbench.update',
      project: 'at://did:plc:a/pub.workbench.project/p1',
      heading: 'h',
      body: 'b',
      links: [{ url: 'https://example.com' }],
      createdAt: '2026-01-01T00:00:00Z',
    });
    await upsertReply(db, meta('at://did:plc:a/pub.workbench.reply/r1'), {
      $type: 'pub.workbench.reply',
      subject: 'at://did:plc:a/pub.workbench.update/u1',
      body: 'hi',
      createdAt: '2026-01-01T00:00:00Z',
    });
    await upsertFollow(db, meta('at://did:plc:a/pub.workbench.follow/f1'), {
      $type: 'pub.workbench.follow',
      kind: 'topic',
      subject: 'robots',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(await count('updates')).toBe(1);
    expect(await count('replies')).toBe(1);
    expect(await count('follows')).toBe(1);
  });
});

describe('deleteByUri', () => {
  it('removes content rows but never topics', async () => {
    const topicUri = 'at://did:plc:a/pub.workbench.topic/t1';
    await upsertTopic(db, { uri: topicUri, slug: 'robots', name: 'R', description: '', ownerDid: 'did:plc:a', indexedAt: 1 });
    const pUri = 'at://did:plc:a/pub.workbench.project/p1';
    await upsertProject(db, meta(pUri), project('one'));
    await deleteByUri(db, topicUri);
    expect(await count('topics')).toBe(1);
    await deleteByUri(db, pUri);
    expect(await count('projects')).toBe(0);
  });
});

describe('cursor', () => {
  it('is null initially and round-trips', async () => {
    expect(await getCursor(db)).toBeNull();
    await setCursor(db, 1700000000000000);
    expect(await getCursor(db)).toBe(1700000000000000);
    await setCursor(db, 1700000000000001);
    expect(await getCursor(db)).toBe(1700000000000001);
  });
});

describe('blocks', () => {
  it('blockDid then isBlocked', async () => {
    expect(await isBlocked(db, 'did:plc:x')).toBe(false);
    await blockDid(db, 'did:plc:x');
    await blockDid(db, 'did:plc:x');
    expect(await isBlocked(db, 'did:plc:x')).toBe(true);
  });

  it('blocking hides everything that DID already has indexed, in all five tables, and upserts keep it hidden', async () => {
    const X = 'did:plc:x';
    const m = (col: string, rkey: string, did = X) => ({ uri: `at://${did}/${col}/${rkey}`, did, rkey, indexedAt: 1000 });
    await upsertTopic(db, { slug: 'robots', name: 'R', description: '', uri: `at://${X}/pub.workbench.topic/robots`, ownerDid: X, indexedAt: 1 });
    await upsertProject(db, m('pub.workbench.project', 'p1'), project('mine'));
    const upd = { $type: 'pub.workbench.update' as const, project: `at://${X}/pub.workbench.project/p1`, heading: 'h', body: 'b', createdAt: '2026-01-01T00:00:00Z' };
    await upsertUpdate(db, m('pub.workbench.update', 'u1'), upd);
    const rep = { $type: 'pub.workbench.reply' as const, subject: 'at://did:plc:y/pub.workbench.update/u9', body: 'hi', createdAt: '2026-01-01T00:00:00Z' };
    await upsertReply(db, m('pub.workbench.reply', 'r1'), rep);
    await upsertFollow(db, m('pub.workbench.follow', 'f1'), { $type: 'pub.workbench.follow', kind: 'topic', subject: 'robots', createdAt: '2026-01-01T00:00:00Z' } as never);
    // Someone else's reply must stay visible.
    await upsertReply(db, m('pub.workbench.reply', 'r2', 'did:plc:y'), rep);

    let batches = 0;
    const spy = new Proxy(db, {
      get(t, p) {
        if (p === 'batch') return (s: D1PreparedStatement[]) => (batches++, t.batch(s));
        const v = (t as any)[p];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    await blockDid(spy, X);
    expect(batches).toBe(1);
    for (const table of ['topics', 'projects', 'updates', 'replies', 'follows']) {
      const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE did = ? AND hidden = 0`).bind(X).first<{ n: number }>();
      expect(r!.n, table).toBe(0);
    }
    expect((await db.prepare('SELECT hidden FROM replies WHERE did = ?').bind('did:plc:y').first<{ hidden: number }>())!.hidden).toBe(0);
    // A re-ingest of the same records stays hidden.
    await upsertProject(db, m('pub.workbench.project', 'p1'), project('again'));
    await upsertUpdate(db, m('pub.workbench.update', 'u1'), upd);
    await upsertReply(db, m('pub.workbench.reply', 'r1'), rep);
    for (const table of ['projects', 'updates', 'replies']) {
      const r = await db.prepare(`SELECT hidden FROM ${table} WHERE did = ?`).bind(X).first<{ hidden: number }>();
      expect(r!.hidden, table).toBe(1);
    }
    // Idempotent.
    await blockDid(db, X);
    expect(await isBlocked(db, X)).toBe(true);
  });

  it('blocking an unknown DID only records the block', async () => {
    await upsertProject(db, meta('at://did:plc:a/pub.workbench.project/p1'), project('a'));
    await blockDid(db, 'did:plc:nobody');
    expect(await isBlocked(db, 'did:plc:nobody')).toBe(true);
    expect((await db.prepare('SELECT hidden FROM projects').first<{ hidden: number }>())!.hidden).toBe(0);
  });
});

describe('bumpAndCheckRate', () => {
  it('false on call cap+1, true again next hour', async () => {
    const t = 10 * 3600_000 + 5;
    expect(await bumpAndCheckRate(db, 'did:plc:a', t, 2)).toBe(true);
    expect(await bumpAndCheckRate(db, 'did:plc:a', t, 2)).toBe(true);
    expect(await bumpAndCheckRate(db, 'did:plc:a', t, 2)).toBe(false);
    expect(await bumpAndCheckRate(db, 'did:plc:b', t, 2)).toBe(true);
    expect(await bumpAndCheckRate(db, 'did:plc:a', t + 3600_000, 2)).toBe(true);
  });
});
