import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { upsertProject, upsertTopic, upsertUpdate } from '../shared/db';
import { createApp } from './index';

const realDb = (env as unknown as { DB: D1Database }).DB;
const ALICE = 'did:plc:alice';
const P1 = `at://${ALICE}/pub.workbench.project/p1`;

/** Wraps the D1 binding and counts prepared statements, so a cache hit is visible as 0 queries. */
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

let n = 0;
async function setup() {
  // A fresh named cache per test so tests never share entries.
  const cache = await caches.open(`edge-test-${++n}-${Math.random()}`);
  const { db, counter } = countingDb();
  const app = createApp({ edgeCache: async () => cache });
  const get = (path: string, init: RequestInit = {}) => app.request(`https://workbench.pub${path}`, init, { ...env, DB: db });
  return { get, counter, cache };
}

beforeEach(async () => {
  for (const t of ['topics', 'projects', 'updates']) await realDb.prepare(`DELETE FROM ${t}`).run();
  await upsertTopic(realDb, { slug: 'woodworking', name: 'Woodworking', description: '', uri: `at://${ALICE}/pub.workbench.topic/woodworking`, ownerDid: ALICE, indexedAt: 1 });
  await upsertProject(realDb, { uri: P1, did: ALICE, rkey: 'p1', indexedAt: 2 }, {
    $type: 'pub.workbench.project', title: 't', summary: 's', topic: 'woodworking', status: 'in-progress', createdAt: '2026-01-01T00:00:00.000Z',
  });
  await upsertUpdate(realDb, { uri: `at://${ALICE}/pub.workbench.update/u1`, did: ALICE, rkey: 'u1', indexedAt: 3 }, {
    $type: 'pub.workbench.update', project: P1, heading: 'h', body: 'b', createdAt: '2026-01-01T00:00:00.000Z',
  });
});

describe('edge cache for anonymous public lists', () => {
  it('serves the second identical global feed request from the cache without touching D1', async () => {
    const { get, counter } = await setup();
    const r1 = await get('/api/feed?limit=20');
    expect(r1.status).toBe(200);
    expect(r1.headers.get('Cache-Control')).toBe('public, max-age=30');
    const body1 = await r1.json();
    const after1 = counter.prepares;
    expect(after1).toBeGreaterThan(0);
    const r2 = await get('/api/feed?limit=20');
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual(body1);
    expect(counter.prepares).toBe(after1);
  });

  it('caches the topic list, keyed on the full URL including cursor and limit', async () => {
    const { get, counter } = await setup();
    await get('/api/topics?limit=5');
    const after1 = counter.prepares;
    await get('/api/topics?limit=5');
    expect(counter.prepares).toBe(after1);
    await get('/api/topics?limit=6');
    expect(counter.prepares).toBeGreaterThan(after1);
    const after3 = counter.prepares;
    await get('/api/topics?limit=5&cursor=a');
    expect(counter.prepares).toBeGreaterThan(after3);
  });

  it('never caches the following feed', async () => {
    const { get, counter } = await setup();
    const r = await get(`/api/feed?following=${ALICE}`);
    expect(r.headers.get('Cache-Control')).toBeNull();
    const after1 = counter.prepares;
    await get(`/api/feed?following=${ALICE}`);
    expect(counter.prepares).toBeGreaterThan(after1);
  });

  it('never serves or stores a cached response for requests with an Authorization header', async () => {
    const { get, counter, cache } = await setup();
    const auth = { headers: { Authorization: 'Bearer x' } };
    const r = await get('/api/feed', auth);
    expect(r.headers.get('Cache-Control')).toBeNull();
    expect(await cache.match('https://workbench.pub/api/feed')).toBeUndefined();
    await get('/api/feed'); // anonymous: now cached
    const after = counter.prepares;
    await get('/api/feed', auth);
    expect(counter.prepares).toBeGreaterThan(after);
  });

  it('does not cache errors', async () => {
    const { get, cache } = await setup();
    const r = await get('/api/feed?cursor=nonsense');
    expect(r.status).toBe(400);
    expect(r.headers.get('Cache-Control')).toBeNull();
    expect(await cache.match('https://workbench.pub/api/feed?cursor=nonsense')).toBeUndefined();
  });

  it('does not cache other read routes', async () => {
    const { get, counter } = await setup();
    await get('/api/topics/woodworking');
    const after1 = counter.prepares;
    await get('/api/topics/woodworking');
    expect(counter.prepares).toBeGreaterThan(after1);
  });
});
