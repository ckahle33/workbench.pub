import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getCursor, setCursor } from '../../shared/db';
import { drainJetstream, type SocketLike } from './drain';

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
    expect(r).toEqual({ events: 3, cursor: 13_000_000, gap: false, errored: false });
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
    expect(r.events).toBeGreaterThan(0);
    expect(h.sockets[0].closed).toBe(true);
  });

  it('ignores malformed frames without counting them', async () => {
    const h = harness([
      (s) => {
        s.emit('message', { data: 'not json' });
        s.send(identity(5));
      },
    ]);
    expect((await run(h.connect)).events).toBe(1);
  });

  it('without a saved cursor, an error before any message is a gap and leaves the cursor alone', async () => {
    const h = harness([(s) => s.emit('error')]);
    const r = await run(h.connect);
    expect(h.sockets).toHaveLength(1);
    expect(r).toEqual({ events: 0, cursor: null, gap: true, errored: false });
    expect(await getCursor(db)).toBeNull();
  });

  it('a stale cursor that fails immediately is retried once without a cursor and flagged as a gap', async () => {
    await setCursor(db, 10_000_000);
    const h = harness([(s) => s.emit('close'), (s) => s.send(identity(99_000_000))]);
    const r = await run(h.connect);
    expect(h.sockets.map((s) => s.url)).toEqual([`${BASE}&cursor=5000000`, BASE]);
    expect(r).toEqual({ events: 1, cursor: 99_000_000, gap: true, errored: false });
    expect(await getCursor(db)).toBe(99_000_000);
  });

  it('if the retry also fails, the cursor does not advance', async () => {
    await setCursor(db, 10_000_000);
    const h = harness([(s) => s.emit('error'), (s) => s.emit('close')]);
    const r = await run(h.connect);
    expect(h.sockets).toHaveLength(2);
    expect(r).toEqual({ events: 0, cursor: 10_000_000, gap: true, errored: false });
    expect(await getCursor(db)).toBe(10_000_000);
  });

  it('stops on a D1 error and keeps the cursor at the last event before it', async () => {
    const h = harness([
      (s) => {
        s.send(identity(1_000));
        s.send(project(2_000, 'p1'));
      },
    ]);
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
    expect(r).toEqual({ events: 1, cursor: 1_000, gap: false, errored: true });
    expect(await getCursor(db)).toBe(1_000);
    expect(h.sockets[0].closed).toBe(true);
  });

  it('a quiet but healthy connection is not a gap and does not retry', async () => {
    await setCursor(db, 10_000_000);
    const h = harness([() => {}]);
    const r = await run(h.connect);
    expect(h.sockets).toHaveLength(1);
    expect(r).toEqual({ events: 0, cursor: 10_000_000, gap: false, errored: false });
  });
});
