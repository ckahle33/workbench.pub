import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { blockDid } from '../../shared/db';
import { applyEvent, HOURLY_WRITE_CAP, type JetstreamEvent } from './apply';

const db = (env as unknown as { DB: D1Database }).DB;
const NOW = 1_800_000_000_000;
const TABLES = ['topics', 'projects', 'updates', 'replies', 'follows'];

beforeEach(async () => {
  for (const t of [...TABLES, 'cursor', 'blocked_dids', 'ingest_counts']) await db.prepare(`DELETE FROM ${t}`).run();
});

const commit = (
  did: string,
  operation: 'create' | 'update' | 'delete',
  collection: string,
  rkey: string,
  record?: unknown,
): JetstreamEvent => ({ did, time_us: 1, kind: 'commit', commit: { operation, collection, rkey, record } });

const project = (title: string) => ({
  $type: 'pub.workbench.project',
  title,
  summary: 's',
  topic: 'robots',
  status: 'in-progress',
  createdAt: '2026-01-01T00:00:00Z',
});
const update = (projectUri: string, body = 'hello') => ({
  $type: 'pub.workbench.update',
  project: projectUri,
  heading: 'h',
  body,
  createdAt: '2026-01-02T00:00:00Z',
});
const topic = (name: string, slug: string) => ({
  $type: 'pub.workbench.topic',
  name,
  slug,
  description: 'd',
  createdAt: '2026-01-01T00:00:00Z',
});

const A = 'did:plc:a';
const P = 'pub.workbench.project';
const U = 'pub.workbench.update';
const T = 'pub.workbench.topic';
const count = async (t: string) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n;
const dump = async () => {
  const out: Record<string, unknown[]> = {};
  for (const t of TABLES) out[t] = (await db.prepare(`SELECT * FROM ${t} ORDER BY uri`).all()).results;
  return out;
};

describe('applyEvent', () => {
  it('create then update changes the row', async () => {
    expect(await applyEvent(db, commit(A, 'create', P, 'p1', project('one')), NOW)).toBe('applied');
    expect(await applyEvent(db, commit(A, 'update', P, 'p1', project('two')), NOW)).toBe('applied');
    expect(await count('projects')).toBe(1);
    const row = await db.prepare('SELECT title FROM projects').first<{ title: string }>();
    expect(row!.title).toBe('two');
  });

  it('delete removes the row', async () => {
    await applyEvent(db, commit(A, 'create', P, 'p1', project('one')), NOW);
    expect(await applyEvent(db, commit(A, 'delete', P, 'p1'), NOW)).toBe('applied');
    expect(await count('projects')).toBe(0);
  });

  it('replaying the same event list twice leaves identical tables', async () => {
    const puri = `at://${A}/${P}/p1`;
    const events = [
      commit(A, 'create', T, 't1', topic('Robots', 'robots')),
      commit(A, 'create', P, 'p1', project('one')),
      commit(A, 'create', U, 'u1', update(puri)),
      commit(A, 'create', 'pub.workbench.reply', 'r1', {
        $type: 'pub.workbench.reply',
        subject: puri,
        body: 'nice',
        createdAt: '2026-01-03T00:00:00Z',
      }),
      commit(A, 'create', 'pub.workbench.follow', 'f1', {
        $type: 'pub.workbench.follow',
        subject: puri,
        createdAt: '2026-01-03T00:00:00Z',
      }),
      commit(A, 'update', P, 'p1', project('two')),
    ];
    for (const e of events) await applyEvent(db, e, NOW);
    const first = await dump();
    for (const e of events) await applyEvent(db, e, NOW);
    expect(await dump()).toEqual(first);
    expect(first.projects).toHaveLength(1);
  });

  it('stores an update whose project does not exist yet', async () => {
    const r = await applyEvent(db, commit(A, 'create', U, 'u1', update(`at://${A}/${P}/missing`)), NOW);
    expect(r).toBe('applied');
    expect(await count('updates')).toBe(1);
  });

  it('rejects an oversize body and writes nothing', async () => {
    const r = await applyEvent(db, commit(A, 'create', U, 'u1', update(`at://${A}/${P}/p1`, 'x'.repeat(6000))), NOW);
    expect(r).toBe('rejected');
    expect(await count('updates')).toBe(0);
  });

  it('rejects a record that fails validation, never throwing', async () => {
    expect(await applyEvent(db, commit(A, 'create', P, 'p1', { nope: 1 }), NOW)).toBe('rejected');
    expect(await applyEvent(db, commit(A, 'create', P, 'p1'), NOW)).toBe('rejected');
    expect(await count('projects')).toBe(0);
  });

  it('ignores a blocked DID', async () => {
    await blockDid(db, A);
    expect(await applyEvent(db, commit(A, 'create', P, 'p1', project('one')), NOW)).toBe('ignored');
    expect(await count('projects')).toBe(0);
  });

  it('rejects the 201st write in an hour from one DID', async () => {
    expect(HOURLY_WRITE_CAP).toBe(200);
    for (let i = 0; i < 200; i++) {
      expect(await applyEvent(db, commit(A, 'create', P, `p${i}`, project('t')), NOW)).toBe('applied');
    }
    expect(await applyEvent(db, commit(A, 'create', P, 'p200', project('t')), NOW)).toBe('rejected');
    expect(await count('projects')).toBe(200);
  });

  it('topic slug collision: first ingested owns the single row', async () => {
    await applyEvent(db, commit('did:plc:a', 'create', T, 't1', topic('Electronics', 'Electronics')), NOW);
    await applyEvent(db, commit('did:plc:b', 'create', T, 't2', topic('electronics', 'electronics ')), NOW + 1);
    expect(await count('topics')).toBe(1);
    const row = await db.prepare('SELECT slug, did FROM topics').first<{ slug: string; did: string }>();
    expect(row).toEqual({ slug: 'electronics', did: 'did:plc:a' });
  });

  it('rejects a topic whose slug normalises to nothing', async () => {
    expect(await applyEvent(db, commit(A, 'create', T, 't1', topic('X', '!!!')), NOW)).toBe('rejected');
    expect(await count('topics')).toBe(0);
  });

  it('ignores foreign collections and non-commit events without counting them', async () => {
    expect(await applyEvent(db, commit(A, 'create', 'app.bsky.feed.post', 'x', { text: 'hi' }), NOW)).toBe('ignored');
    expect(await applyEvent(db, { did: A, time_us: 1, kind: 'identity' }, NOW)).toBe('ignored');
    expect(await count('ingest_counts')).toBe(0);
  });
});
