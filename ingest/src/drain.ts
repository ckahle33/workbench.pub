import { getCursor, setCursor } from '../../shared/db';
import { applyEvent, type JetstreamEvent } from './apply';

export interface SocketLike {
  addEventListener(type: 'message' | 'close' | 'error', fn: (e: any) => void): void;
  close(): void;
}

export interface DrainOptions {
  db: D1Database;
  connect: (url: string) => SocketLike;
  endpoint: string;
  /** Hard cap on one connection's lifetime. */
  maxMs: number;
  /** Stop after this long without a message. */
  idleMs: number;
  nowMs: () => number;
}

export interface DrainResult {
  events: number;
  /** The stored cursor (microseconds) after this run, or null if none has ever been stored. */
  cursor: number | null;
  /** True when we could not resume from the saved cursor (or could not connect at all). */
  gap: boolean;
  /** True when a D1 failure stopped processing early. */
  errored: boolean;
  /** True when the per-run event budget was hit; a backlog remains for the next run. */
  capped: boolean;
}

/**
 * Workers Free allows 50 D1 queries per invocation (a db.batch counts as 1). A run spends 2 on the cursor
 * (getCursor, setCursor) and applyEvent spends 3 per event that reaches D1, so (50 - 2) / 3 = 16; we take 15
 * for margin (15 * 3 + 2 = 47). Events that return before any D1 call (foreign collections, identity and
 * account events) and replayed events below the saved cursor are free and do not count.
 */
export const MAX_EVENTS_PER_RUN = 15;

/** Re-read this much before the saved cursor; safe because applyEvent is idempotent. */
const REWIND_US = 5_000_000;
const WANTED = 'wantedCollections=pub.workbench.*';

interface Pass {
  events: number;
  /** Highest time_us of an event that was fully handled (not errored). */
  lastUs: number | null;
  errored: boolean;
  capped: boolean;
  /** The server closed or errored before delivering a single message (not our own idle/max stop). */
  failedEarly: boolean;
}

function onePass(o: DrainOptions, url: string, saved: number | null): Promise<Pass> {
  return new Promise((resolve) => {
    const pass: Pass = { events: 0, lastUs: null, errored: false, capped: false, failedEarly: false };
    const sock = o.connect(url);
    let sawMessage = false;
    let spent = 0;
    let done = false;
    let chain: Promise<void> = Promise.resolve();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    let serverEnded = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(idleTimer);
      clearTimeout(maxTimer);
      try {
        sock.close();
      } catch {
        // already closed
      }
      // Let in-flight D1 writes land before reporting.
      chain.then(() => {
        pass.failedEarly = serverEnded && !sawMessage;
        resolve(pass);
      });
    };
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, o.idleMs);
    };
    const maxTimer = setTimeout(finish, o.maxMs);
    armIdle();

    sock.addEventListener('message', (e) => {
      if (done) return;
      sawMessage = true;
      armIdle();
      chain = chain.then(async () => {
        if (pass.errored || pass.capped) return;
        let ev: JetstreamEvent;
        try {
          ev = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data));
        } catch {
          return;
        }
        if (typeof ev?.time_us !== 'number') return;
        // Replay of the rewind window: already applied, so skip without touching D1. Ties are re-applied (idempotent).
        if (saved !== null && ev.time_us < saved) return;
        const outcome = await applyEvent(o.db, ev, o.nowMs());
        if (outcome === 'error') {
          pass.errored = true;
          finish();
          return;
        }
        pass.events++;
        pass.lastUs = Math.max(pass.lastUs ?? 0, ev.time_us);
        if (outcome !== 'ignored' && ++spent >= MAX_EVENTS_PER_RUN) {
          pass.capped = true;
          finish();
        }
      });
    });
    const onServerEnd = () => {
      serverEnded = true;
      finish();
    };
    sock.addEventListener('close', onServerEnd);
    sock.addEventListener('error', onServerEnd);
  });
}

/**
 * Connect to Jetstream from the saved cursor, apply events until idle or maxMs, store the cursor, disconnect.
 */
export async function drainJetstream(o: DrainOptions): Promise<DrainResult> {
  const saved = await getCursor(o.db);
  const base = `${o.endpoint}?${WANTED}`;
  let gap = false;

  let pass = await onePass(o, saved === null ? base : `${base}&cursor=${Math.max(0, saved - REWIND_US)}`, saved);
  if (pass.failedEarly && !pass.errored) {
    gap = true;
    if (saved !== null) {
      // Probably older than Jetstream's replay window: take what is live instead.
      pass = await onePass(o, base, null);
    }
  }

  let cursor = saved;
  let errored = pass.errored;
  // Only move forward: replayed events inside the rewind must not drag the cursor back.
  if (pass.lastUs !== null && (saved === null || pass.lastUs > saved)) {
    try {
      await setCursor(o.db, pass.lastUs);
      cursor = pass.lastUs;
    } catch (err) {
      // Not fatal: the next run replays from the old cursor, which is idempotent.
      console.error('jetstream cursor save failed', err instanceof Error ? err.name : 'unknown');
      errored = true;
    }
  }
  return { events: pass.events, cursor, gap, errored, capped: pass.capped };
}
