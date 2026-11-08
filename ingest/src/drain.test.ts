import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockDid, getCursor, setCursor } from '../../shared/db';
import { drainJetstream, type SocketLike } from './drain';
import { countQueries } from './queryBudget';

const db = (env as unknown as { DB: D1Database }).DB;
const ENDPOINT = 'wss://example.test/subscribe';
const BASE = `${ENDPOINT}?wantedCollections=pub.workbench.*`;
const A = 'did:plc:a';

beforeEach(async () => {
  for (const t of ['projects', 'cursor', 'blocked_dids', 'ingest_counts']) await db.prepare(`DELETE FROM ${t}`).run();
});

class FakeSocket implements SocketLike {
  closed = false;
  private fns: Record<string, Array<(e: unknown) => void>> = {};
  constructor(
    readonly url: string,
    private script: (s: FakeSocket) => void,
  ) {
    // Let the drain attach its listeners before the script runs.
    setTimeout(() => this.script(this), 0);
  }
  addEventListener(type: 'message' | 'close' | 'error', fn: (e: any) => void) {
    (this.fns[type] ??= []).push(fn);
  }
  emit(type: string, e: unknown = {}) {
    if (!this.closed) for (const f of this.fns[type] ?? []) f(e);
  }
  send(ev: unknown) {
    this.emit('message', { data: JSON.stringify(ev) });
  }
  close() {
    this.closed = true;
  }
}

const identity = (timeUs: number) => ({ did: A, time_us: timeUs, kind: 'identity' });
const project = (timeUs: number, rkey: string) => ({
  did: A,
  time_us: timeUs,
  kind: 'commit',
  commit: {
    operation: 'create',
    collection: 'pub.workbench.project',
    rkey,
    record: {
      $type: 'pub.workbench.project',
      title: 't',
      summary: 's',
      topic: 'robots',
      status: 'in-progress',
      createdAt: '2026-01-01T00:00:00Z',
    },
  },
});

function harness(scripts: Array<(s: FakeSocket) => void>) {
  const sockets: FakeSocket[] = [];
  const connect = (url: string) => {
    const s = new FakeSocket(url, scripts[sockets.length] ?? (() => {}));
    sockets.push(s);
    return s;
  };
  return { sockets, connect };
}
const run = (connect: (u: string) => SocketLike, maxMs = 2000, idleMs = 30) =>
  drainJetstream({ db, connect, endpoint: ENDPOINT, maxMs, idleMs, nowMs: () => 1_800_000_000_000 });

describe('drainJetstream', () => {
  it('connects with the saved cursor minus 5s, applies events, stores the highest time_us', async () => {
    await setCursor(db, 10_000_000);
    const h = harness([
      (s) => {
        s.send(project(11_000_000, 'p1'));
        s.send(identity(13_000_000));
        s.send(project(12_000_000, 'p2'));
      },
    ]);
    const r = await run(h.connect);
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].url).toBe(`${BASE}&cursor=5000000`);
    expect(r).toEqual({ applied: 2, rejected: 0, ignored: 1, cursor: 13_000_000, gap: false, errored: false, errorStreak: 0, capped: false, caughtUp: false });
    expect(await getCursor(db)).toBe(13_000_000);
    const n = await db.prepare('SELECT COUNT(*) AS n FROM projects').first<{ n: number }>();
    expect(n?.n).toBe(2);
    expect(h.sockets[0].closed).toBe(true);
  });

  it('connects without a cursor when none is saved', async () => {
    const h = harness([(s) => s.send(identity(7))]);
    const r = await run(h.connect);
    expect(h.sockets[0].url).toBe(BASE);
    expect(r.cursor).toBe(7);
    expect(await getCursor(db)).toBe(7);
  });

  it('never rewinds the stored cursor when only replayed events arrive', async () => {
    await setCursor(db, 10_000_000);
    const h = harness([(s) => s.send(identity(8_000_000))]);
    const r = await run(h.connect);
    expect(r.cursor).toBe(10_000_000);
    expect(await getCursor(db)).toBe(10_000_000);
  });

  it('stops at maxMs even if events keep coming', async () => {
    let t = 1;
    const h = harness([
      (s) => {
        const iv = setInterval(() => {
          if (s.closed) clearInterval(iv);
          else s.send(identity(t++));
        }, 5);
      },
    ]);
    const started = Date.now();
    const r = await run(h.connect, 120, 1000);
    expect(Date.now() - started).toBeLessThan(900);
    expect(r.ignored).toBeGreaterThan(0);
    expect(h.sockets[0].closed).toBe(true);
  });

  it('ignores malformed frames without counting them', async () => {
    const h = harness([
      (s) => {
        s.emit('message', { data: 'not json' });
        s.send(identity(5));
      },
    ]);
    expect(await run(h.connect)).toMatchObject({ applied: 0, rejected: 0, ignored: 1 });
  });

  it('without a saved cursor, an error before any message is a gap and leaves the cursor alone', async () => {
    const h = harness([(s) => s.emit('error')]);
    const r = await run(h.connect);
    expect(h.sockets).toHaveLength(1);
    expect(r).toEqual({ applied: 0, rejected: 0, ignored: 0, cursor: null, gap: true, errored: false, errorStreak: 0, capped: false, caughtUp: false });
    expect(await getCursor(db)).toBeNull();
  });

  it('a stale cursor that fails immediately is retried once without a cursor and flagged as a gap', async () => {
    await setCursor(db, 10_000_000);
    const h = harness([(s) => s.emit('close'), (s) => s.send(identity(99_000_000))]);
    const r = await run(h.connect);
    expect(h.sockets.map((s) => s.url)).toEqual([`${BASE}&cursor=5000000`, BASE]);
    expect(r).toEqual({ applied: 0, rejected: 0, ignored: 1, cursor: 99_000_000, gap: true, errored: false, errorStreak: 0, capped: false, caughtUp: false });
    expect(await getCursor(db)).toBe(99_000_000);
  });

  it('if the retry also fails, the cursor does not advance', async () => {
    await setCursor(db, 10_000_000);
    const h = harness([(s) => s.emit('error'), (s) => s.emit('close')]);
    const r = await run(h.connect);
    expect(h.sockets).toHaveLength(2);
    expect(r).toEqual({ applied: 0, rejected: 0, ignored: 0, cursor: 10_000_000, gap: true, errored: false, errorStreak: 0, capped: false, caughtUp: false });
    expect(await getCursor(db)).toBe(10_000_000);
  });

  it('stops on a D1 error and keeps the cursor at the last event before it', async () => {
    const h = harness([
      (s) => {
        s.send(identity(1_000));
        s.send(project(2_000, 'p1'));
      },
    ]);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A db whose prepare fails only for the project insert; cursor and block checks still work.
    const flaky = new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (sql.includes('INSERT INTO projects')) throw new Error('D1 down');
            return target.prepare(sql);
          };
        }
        const v = (target as any)[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const r = await drainJetstream({
      db: flaky,
      connect: h.connect,
      endpoint: ENDPOINT,
      maxMs: 2000,
      idleMs: 30,
      nowMs: () => 1_800_000_000_000,
    });
    expect(r).toEqual({ applied: 0, rejected: 0, ignored: 1, cursor: 1_000, gap: false, errored: true, errorStreak: 1, capped: false, caughtUp: false });
    expect(errSpy).toHaveBeenCalledWith('ingest apply error', {
      name: 'Error',
      uri: `at://${A}/pub.workbench.project/p1`,
      collection: 'pub.workbench.project',
    });
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain('robots'); // no record contents
    expect(await getCursor(db)).toBe(1_000);
    expect(h.sockets[0].closed).toBe(true);
    errSpy.mockRestore();
  });

  it('a quiet but healthy connection is not a gap and does not retry', async () => {
    await setCursor(db, 10_000_000);
    const h = harness([() => {}]);
    const r = await run(h.connect);
    expect(h.sockets).toHaveLength(1);
    expect(r).toEqual({ applied: 0, rejected: 0, ignored: 0, cursor: 10_000_000, gap: false, errored: false, errorStreak: 0, capped: false, caughtUp: false });
  });
});

// ---- D1 query budget (Workers Free: 50 queries per invocation, a batch counts as 1) ----

/** Mimics the platform: counts queries and throws once more than `limit` have been issued. */
function limited(real: D1Database, limit: number) {
  const c = countQueries(real, limit);
  return { db: c.db, state: { get count() { return c.used(); } } };
}

/** A Jetstream stand-in: replays every event with time_us >= the cursor in the url, like the real thing. */
const feed = (events: Array<{ time_us: number }>) => (s: FakeSocket) => {
  const m = /cursor=(\d+)/.exec(s.url);
  const from = m ? Number(m[1]) : 0;
  for (const e of events) if (e.time_us >= from) s.send(e);
};

const drainWith = (db: D1Database, connect: (u: string) => SocketLike) =>
  drainJetstream({ db, connect, endpoint: ENDPOINT, maxMs: 2000, idleMs: 30, nowMs: () => 1_800_000_000_000 });

describe('drainJetstream query budget', () => {
  it('applies a 40-event backlog across three runs, once each, never above 50 queries', async () => {
    const events = Array.from({ length: 40 }, (_, i) => project(10_000_000 + i * 1_000_000, `p${i}`));
    const results = [];
    const cursors: Array<number | null> = [];
    for (let run = 0; run < 3; run++) {
      const { db: counted, state } = limited(db, 50);
      const h = harness([feed(events)]);
      results.push(await drainWith(counted, h.connect));
      expect(state.count).toBeLessThanOrEqual(50);
      cursors.push(await getCursor(db));
    }
    expect(results.map((r) => r.errored)).toEqual([false, false, false]);
    expect(results.map((r) => r.capped)).toEqual([true, true, false]);
    expect(cursors[0]).toBeLessThan(cursors[1]!);
    expect(cursors[1]).toBeLessThan(cursors[2]!);
    expect(cursors[2]).toBe(10_000_000 + 39 * 1_000_000);
    const rows = await db.prepare('SELECT rkey FROM projects').all<{ rkey: string }>();
    expect(rows.results.map((r) => r.rkey).sort()).toEqual(events.map((_, i) => `p${i}`).sort());
    const idx = await db.prepare('SELECT SUM(count) AS n FROM ingest_counts').first<{ n: number }>();
    // The last event of each capped run sits exactly at the saved cursor, so the next run re-applies it (idempotent upsert):
    // 40 events + 2 tie replays. Everything below the cursor was skipped for free.
    expect(idx?.n).toBe(42);
  });

  it('foreign and identity events do not spend the budget', async () => {
    const noise = Array.from({ length: 100 }, (_, i) =>
      i % 2 ? identity(1_000 + i) : { did: A, time_us: 1_000 + i, kind: 'commit', commit: { operation: 'create', collection: 'app.bsky.feed.post', rkey: `x${i}`, record: {} } },
    );
    const real = [project(2_000, 'r1'), project(2_001, 'r2'), project(2_002, 'r3')];
    const { db: counted, state } = limited(db, 50);
    const h = harness([feed([...noise, ...real])]);
    const r = await drainWith(counted, h.connect);
    expect(r.capped).toBe(false);
    expect(r.errored).toBe(false);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM projects').first<{ n: number }>())?.n).toBe(3);
    expect(state.count).toBeLessThanOrEqual(3 * 3 + 2);
  });

  it('replayed events below the saved cursor cost zero queries', async () => {
    await setCursor(db, 100_000_000);
    const old = Array.from({ length: 20 }, (_, i) => project(95_000_000 + i * 100_000, `old${i}`));
    const { db: counted, state } = limited(db, 50);
    const h = harness([(s) => old.forEach((e) => s.send(e))]);
    const r = await drainWith(counted, h.connect);
    expect(state.count).toBe(1); // getCursor only
    expect(r).toEqual({ applied: 0, rejected: 0, ignored: 20, cursor: 100_000_000, gap: false, errored: false, errorStreak: 0, capped: false, caughtUp: false });
    expect((await db.prepare('SELECT COUNT(*) AS n FROM projects').first<{ n: number }>())?.n).toBe(0);
  });

  it('still applies an event whose time_us equals the saved cursor', async () => {
    await setCursor(db, 100_000_000);
    const h = harness([(s) => s.send(project(100_000_000, 'tie'))]);
    const r = await drainWith(db, h.connect);
    expect(r.applied).toBe(1);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM projects').first<{ n: number }>())?.n).toBe(1);
  });

  it('a setCursor failure is reported as errored and does not throw', async () => {
    const failing = new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (sql.includes('INSERT INTO cursor')) throw new Error('D1 down');
            return target.prepare(sql);
          };
        }
        const v = (target as any)[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const h = harness([(s) => s.send(identity(5))]);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await drainWith(failing, h.connect);
    expect(spy).toHaveBeenCalledWith('jetstream cursor save failed', 'Error');
    spy.mockRestore();
    expect(r.errored).toBe(true);
    expect(r.cursor).toBeNull();
    expect(await getCursor(db)).toBeNull();
  });

  it('a blocked-DID flood spends 1 query per event, never breaks the limit, and the cursor still advances', async () => {
    const SPAM = 'did:plc:spam';
    await blockDid(db, SPAM);
    const spam = Array.from({ length: 60 }, (_, i) => ({ ...project(10_000_000 + i * 1_000_000, `s${i}`), did: SPAM }));
    const real = [0, 1, 2].map((i) => project(70_000_000 + i * 1_000_000, `r${i}`));
    const feedAll = feed([...spam, ...real]);
    const caps: boolean[] = [];
    const cursors: Array<number | null> = [];
    for (let run = 0; run < 5; run++) {
      const { db: counted, state } = limited(db, 50);
      const r = await drainWith(counted, harness([feedAll]).connect);
      expect(r.errored).toBe(false);
      expect(state.count).toBeLessThanOrEqual(50);
      caps.push(r.capped);
      cursors.push(await getCursor(db));
      if (!r.capped) break;
    }
    expect(caps[0]).toBe(true);
    expect(caps.at(-1)).toBe(false);
    expect(cursors[0]).toBeGreaterThan(10_000_000);
    expect(cursors[0]).toBeLessThan(cursors[1]!);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM projects').first<{ n: number }>())?.n).toBe(3);
  });

  it('exact boundary: 15 normal events use 47 D1 queries (+2 sockets reserved) and are not capped; 16 are capped after 15', async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => project(10_000_000 + i * 1_000_000, `b${i}`));
    {
      const { db: counted, state } = limited(db, 50);
      const r = await drainWith(counted, harness([feed(mk(15))]).connect);
      expect(r).toMatchObject({ applied: 15, capped: false, errored: false });
      expect(state.count).toBe(47);
    }
    for (const t of ['projects', 'cursor', 'ingest_counts']) await db.prepare(`DELETE FROM ${t}`).run();
    {
      const { db: counted, state } = limited(db, 50);
      const r = await drainWith(counted, harness([feed(mk(16))]).connect);
      expect(r).toMatchObject({ applied: 15, capped: true, errored: false });
      expect(state.count).toBe(47);
      expect(state.count + 2).toBeLessThanOrEqual(50); // with both possible sockets counted as subrequests
      expect((await db.prepare('SELECT COUNT(*) AS n FROM projects').first<{ n: number }>())?.n).toBe(15);
    }
  });

  it('counts applied, rejected and ignored separately', async () => {
    const bad = { ...project(3_000, 'bad'), commit: { ...project(3_000, 'bad').commit, record: { $type: 'pub.workbench.project' } } };
    const foreign = { did: A, time_us: 4_000, kind: 'commit', commit: { operation: 'create', collection: 'app.bsky.feed.post', rkey: 'x', record: {} } };
    const h = harness([feed([identity(1_000), project(2_000, 'ok'), bad, foreign])]);
    expect(await drainWith(db, h.connect)).toMatchObject({ applied: 1, rejected: 1, ignored: 2, cursor: 4_000 });
  });

  it('stops as soon as events reach the time the run started, leaving that event for the next run', async () => {
    const startMs = 1_800_000_000_000;
    let sent = 0;
    const h = harness([
      (s) => {
        s.send(project(startMs * 1000 - 2, 'before'));
        s.send(identity(startMs * 1000 - 1));
        s.send(project(startMs * 1000, 'live'));
        sent = 3;
        // Then keep the socket busy; a run that did not stop would sit here until maxMs.
        const iv = setInterval(() => (s.closed ? clearInterval(iv) : s.send(identity(startMs * 1000 + 5))), 5);
      },
    ]);
    const t0 = Date.now();
    const r = await drainJetstream({ db, connect: h.connect, endpoint: ENDPOINT, maxMs: 5000, idleMs: 1000, nowMs: () => startMs });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(sent).toBe(3);
    expect(r).toMatchObject({ applied: 1, ignored: 1, caughtUp: true, cursor: startMs * 1000 - 1 });
    const rows = await db.prepare('SELECT rkey FROM projects').all<{ rkey: string }>();
    expect(rows.results.map((x) => x.rkey)).toEqual(['before']);
  });

  it('never JSON.parses identity or account frames', async () => {
    const parse = vi.spyOn(JSON, 'parse');
    const h = harness([
      (s) => {
        for (let i = 0; i < 20; i++) s.send(identity(1_000 + i));
        s.send({ did: A, time_us: 2_000, kind: 'account', account: { active: true } });
        s.send(project(3_000, 'p'));
      },
    ]);
    const r = await drainWith(db, h.connect);
    // Jetstream frames only (D1's own response parsing also goes through JSON.parse).
    const parsedFrames = parse.mock.calls.filter(([text]) => typeof text === 'string' && text.startsWith('{"did"'));
    parse.mockRestore();
    expect(parsedFrames).toHaveLength(1);
    expect(r).toMatchObject({ applied: 1, ignored: 21, cursor: 3_000 });
  });

  it('keeps a streak of consecutive errored runs and resets it on a clean advancing run', async () => {
    await setCursor(db, 1_000);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (sql.includes('INSERT INTO projects')) throw new Error('D1 down');
            return target.prepare(sql);
          };
        }
        const v = (target as any)[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const poison = feed([project(2_000, 'poison')]);
    expect((await drainWith(failing, harness([poison]).connect)).errorStreak).toBe(1);
    expect((await drainWith(failing, harness([poison]).connect)).errorStreak).toBe(2);
    const ok = await drainWith(db, harness([poison]).connect);
    expect(ok).toMatchObject({ errored: false, errorStreak: 0, applied: 1 });
    expect((await drainWith(failing, harness([feed([project(3_000, 'again')])]).connect)).errorStreak).toBe(1);
    errSpy.mockRestore();
  });

  it('countQueries counts without throwing when no limit is set', async () => {
    const c = countQueries(db);
    for (let i = 0; i < 60; i++) await c.db.prepare('SELECT 1').first();
    await c.db.batch([c.db.prepare('SELECT 1'), c.db.prepare('SELECT 2')]);
    expect(c.used()).toBe(61);
  });
});
