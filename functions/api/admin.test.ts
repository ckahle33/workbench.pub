import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyEvent } from '../../ingest/src/apply';
import { REPORTS_MAX_ROWS, REPORTS_PER_IP_PER_DAY, upsertProject, upsertTopic, upsertUpdate } from '../../shared/db';
import app from '../index';

const db = (env as unknown as { DB: D1Database }).DB;
const TOKEN = 'test-admin-token-not-a-secret';
const bindings: Record<string, unknown> = { ...(env as unknown as Record<string, unknown>), ADMIN_TOKEN: TOKEN };
const ALICE = 'did:plc:alice';
const P1 = `at://${ALICE}/pub.workbench.project/p1`;
const U1 = `at://${ALICE}/pub.workbench.update/u1`;

const call = (path: string, init: RequestInit = {}, b: Record<string, unknown> = bindings) => app.request(path, init, b);
const post = (path: string, body: unknown, headers: Record<string, string> = {}, b = bindings) =>
  call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }, b);
const auth = { Authorization: `Bearer ${TOKEN}` };
const report = (body: unknown, ip = '203.0.113.1') => post('/api/report', body, { 'CF-Connecting-IP': ip });

beforeEach(async () => {
  for (const t of ['topics', 'projects', 'updates', 'reports', 'blocked_dids', 'ingest_counts']) await db.prepare(`DELETE FROM ${t}`).run();
  await upsertTopic(db, { slug: 'woodworking', name: 'W', description: 'd', uri: `at://${ALICE}/pub.workbench.topic/w`, ownerDid: ALICE, indexedAt: 1 });
  await upsertProject(db, { uri: P1, did: ALICE, rkey: 'p1', indexedAt: 100 }, {
    $type: 'pub.workbench.project', title: 't', summary: 's', topic: 'woodworking', status: 'in-progress', createdAt: '2026-01-01T00:00:00.000Z',
  });
  await upsertUpdate(db, { uri: U1, did: ALICE, rkey: 'u1', indexedAt: 101 }, {
    $type: 'pub.workbench.update', project: P1, heading: 'h', body: 'b', createdAt: '2026-01-01T00:00:00.000Z',
  });
});

describe('admin auth', () => {
  const withHeaders = (name: string, h: Record<string, string>, b: Record<string, unknown> = bindings) => {
    if (name === 'hide') return post('/api/admin/hide', { uri: P1 }, h, b);
    if (name === 'block') return post('/api/admin/block', { did: ALICE }, h, b);
    return call('/api/admin/reports', { headers: h }, b);
  };

  for (const name of ['hide', 'block', 'reports']) {
    it(`${name}: 401 without a token`, async () => {
      expect((await withHeaders(name, {})).status).toBe(401);
    });
    it(`${name}: 401 with a wrong token, wrong scheme or prefix of the token`, async () => {
      for (const h of ['Bearer nope', `Basic ${TOKEN}`, `Bearer ${TOKEN.slice(0, -1)}`, `Bearer ${TOKEN}x`, 'Bearer ', TOKEN]) {
        expect((await withHeaders(name, { Authorization: h })).status).toBe(401);
      }
    });
    it(`${name}: closed (401, not 500) when ADMIN_TOKEN is unset or empty`, async () => {
      for (const tok of [undefined, '']) {
        const b = { ...bindings, ADMIN_TOKEN: tok };
        for (const h of [auth, { Authorization: 'Bearer ' }, { Authorization: 'Bearer undefined' }, {}]) {
          expect((await withHeaders(name, h, b)).status).toBe(401);
        }
      }
    });
  }
});

describe('admin actions', () => {
  it('hide removes the project from the feed and the update permalink', async () => {
    expect(((await (await call('/api/feed')).json()) as { items: unknown[] }).items).toHaveLength(1);
    expect((await call(`/api/updates/${ALICE}/u1`)).status).toBe(200);
    expect((await post('/api/admin/hide', { uri: P1 }, auth)).status).toBe(200);
    expect(((await (await call('/api/feed')).json()) as { items: unknown[] }).items).toHaveLength(0);
    expect((await call(`/api/updates/${ALICE}/u1`)).status).toBe(404);
  });

  it('block makes applyEvent ignore that DID', async () => {
    const ev = { did: ALICE, time_us: 1, kind: 'commit' as const, commit: { operation: 'delete' as const, collection: 'pub.workbench.project', rkey: 'x' } };
    expect(await applyEvent(db, ev, 1_800_000_000_000)).toBe('applied');
    expect((await post('/api/admin/block', { did: ALICE }, auth)).status).toBe(200);
    expect(await applyEvent(db, ev, 1_800_000_000_000)).toBe('ignored');
  });

  it('validates bodies: malformed JSON, non-objects, wrong types, bad uri and did', async () => {
    for (const body of ['{nope', '[]', 'null', '"x"', { uri: 5 }, { uri: 'https://x.test' }, { uri: 'at://' + 'a'.repeat(600) }, {}]) {
      expect((await post('/api/admin/hide', body, auth)).status).toBe(400);
    }
    for (const body of ['{nope', { did: 5 }, { did: 'alice' }, { did: 'did:plc:' }, { did: 'did:plc:a b' }, { did: 'did:plc:' + 'a'.repeat(300) }, {}]) {
      expect((await post('/api/admin/block', body, auth)).status).toBe(400);
    }
  });

  it('lists reports without exposing ip hashes', async () => {
    await report({ uri: P1, reason: 'spam' });
    const r = await call('/api/admin/reports', { headers: auth });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(JSON.parse(text).items).toEqual([expect.objectContaining({ subjectUri: P1, reason: 'spam' })]);
    expect(text).not.toMatch(/ip|203\.0\.113/);
  });
});

describe('POST /api/report', () => {
  const rows = async () => (await db.prepare('SELECT * FROM reports').all<Record<string, unknown>>()).results;

  it('stores a row with a hashed, not raw, IP', async () => {
    expect((await report({ uri: P1, reason: 'spam' })).status).toBe(201);
    const [row] = await rows();
    expect(row).toMatchObject({ subject_uri: P1, reason: 'spam' });
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('203.0.113.1');
  });

  it('accepts 500 chars and rejects 501 with 400', async () => {
    expect((await report({ uri: P1, reason: 'a'.repeat(500) })).status).toBe(201);
    expect((await report({ uri: P1, reason: 'a'.repeat(501) }, '203.0.113.9')).status).toBe(400);
    expect(await rows()).toHaveLength(1);
  });

  it('rejects malformed input', async () => {
    for (const body of ['{nope', '[]', { uri: P1 }, { uri: P1, reason: 5 }, { uri: 'https://x.test', reason: '' }, { uri: 'at://' + 'a'.repeat(600), reason: '' }]) {
      expect((await report(body)).status).toBe(400);
    }
  });

  it('refuses a second report from the same IP for the same uri (429), allows other IPs and other uris', async () => {
    expect((await report({ uri: P1, reason: 'a' })).status).toBe(201);
    expect((await report({ uri: P1, reason: 'b' })).status).toBe(429);
    expect((await report({ uri: P1, reason: 'c' }, '203.0.113.2')).status).toBe(201);
    expect((await report({ uri: U1, reason: 'd' })).status).toBe(201);
    expect(await rows()).toHaveLength(3);
  });

  it('allows the same IP again once a day has passed', async () => {
    expect((await report({ uri: P1, reason: 'a' })).status).toBe(201);
    await db.prepare('UPDATE reports SET created_at = created_at - ?').bind(25 * 3_600_000).run();
    expect((await report({ uri: P1, reason: 'b' })).status).toBe(201);
  });
  const uriN = (n: number) => `at://${ALICE}/pub.workbench.update/n${n}`;

  it('caps one IP at 20 reports per day across distinct uris; other IPs are unaffected', async () => {
    expect(REPORTS_PER_IP_PER_DAY).toBe(20);
    for (let i = 0; i < 20; i++) expect((await report({ uri: uriN(i), reason: '' })).status).toBe(201);
    expect((await report({ uri: uriN(20), reason: '' })).status).toBe(429);
    expect(await rows()).toHaveLength(20);
    expect((await report({ uri: uriN(20), reason: '' }, '203.0.113.50')).status).toBe(201);
  });

  it('prunes reports older than 30 days on insert (bounded batch of 50)', async () => {
    const old = Date.now() - 31 * 24 * 3_600_000;
    for (let i = 0; i < 60; i++) {
      await db.prepare('INSERT INTO reports (subject_uri, reason, ip_hash, created_at) VALUES (?, ?, ?, ?)').bind(uriN(i), '', 'h', old).run();
    }
    expect((await report({ uri: P1, reason: '' })).status).toBe(201);
    expect(await rows()).toHaveLength(60 - 50 + 1);
  });

  it('refuses new reports with 503 once the table is at its ceiling', async () => {
    const now = Date.now();
    await db.batch(
      Array.from({ length: REPORTS_MAX_ROWS }, (_, i) =>
        db.prepare('INSERT INTO reports (subject_uri, reason, ip_hash, created_at) VALUES (?, ?, ?, ?)').bind(uriN(i), '', `h${i % 500}`, now),
      ),
    );
    expect((await report({ uri: P1, reason: '' })).status).toBe(503);
    expect(await rows()).toHaveLength(REPORTS_MAX_ROWS);
  });
});
