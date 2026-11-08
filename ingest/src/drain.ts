import { getCursor, pruneIngestCounts, saveRunState } from '../../shared/db';
import { applyEvent, type JetstreamEvent } from './apply';
import { countQueries } from './queryBudget';

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
  /** Events written to (or deleted from) D1. */
  applied: number;
  /** pub.workbench events dropped as invalid, hostile or over the rate cap. */
  rejected: number;
  /** Frames that cost no write: identity/account traffic, foreign collections, blocked DIDs, replays below the cursor. */
  ignored: number;
  /** The stored cursor (microseconds) after this run, or null if none has ever been stored. */
  cursor: number | null;
  /** True when we could not resume from the saved cursor (or could not connect at all). */
  gap: boolean;
  /** True when a D1 failure stopped processing early. */
  errored: boolean;
  /** Consecutive errored runs including this one (0 when this run did not error). */
  errorStreak: number;
  /** True when the run stopped because events reached the time the run started (live tail reached). */
  caughtUp: boolean;
  /** True when the per-run D1 query budget ran out; a backlog remains for the next run. */
  capped: boolean;
}

/**
 * Budget by D1 queries, not events. Workers Free allows PLATFORM_QUERY_LIMIT = 50 per invocation (a db.batch counts
 * as 1). applyEvent spends at most WORST_CASE_EVENT_COST = 3 (blocked check, rate bump, write); foreign, identity and
 * replay-skipped events cost 0, a blocked DID 1, a rejected record 2. The run also needs CURSOR_SAVE_RESERVE = 1 for
 * saveRunState (getCursor and the one bounded ingest_counts prune have already been counted by then).
 *
 * WEBSOCKET_RESERVE = 2: we could not confirm whether D1 queries and subrequests share the 50 limit, so assume they
 * do and keep room for the Jetstream socket plus the gap-retry socket. Before each event we require
 * used + 3 + 1 + 2 <= 50, so all-normal events give floor((50 - 1 getCursor - 1 prune - 1 save - 2 sockets) / 3) = 15
 * per run (48 D1 queries + 2 sockets = 50).
 */
const PLATFORM_QUERY_LIMIT = 50;
const WORST_CASE_EVENT_COST = 3;
const CURSOR_SAVE_RESERVE = 1;
const WEBSOCKET_RESERVE = 2;

/** Cheap pre-filter: only commit frames are parsed; identity/account traffic is skipped unparsed. */
const COMMIT_FRAME = /"kind"\s*:\s*"commit"/;
const TIME_US = /"time_us"\s*:\s*(\d+)/;

/** Re-read this much before the saved cursor; safe because applyEvent is idempotent. */
const REWIND_US = 5_000_000;
const WANTED = 'wantedCollections=pub.workbench.*';

interface Pass {
  applied: number;
  rejected: number;
  ignored: number;
  caughtUp: boolean;
  /** Highest time_us of an event that was fully handled (not errored). */
  lastUs: number | null;
  errored: boolean;
  capped: boolean;
  /** The server closed or errored before delivering a single message (not our own idle/max stop). */
  failedEarly: boolean;
}

function onePass(o: DrainOptions, url: string, saved: number | null, used: () => number, startUs: number): Promise<Pass> {
  return new Promise((resolve) => {
    const pass: Pass = { applied: 0, rejected: 0, ignored: 0, caughtUp: false, lastUs: null, errored: false, capped: false, failedEarly: false };
    const sock = o.connect(url);
    let sawMessage = false;
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
        if (pass.errored || pass.capped || pass.caughtUp) return;
        const data = typeof e.data === 'string' ? e.data : String(e.data);
        if (!COMMIT_FRAME.test(data)) {
          // Identity/account traffic: never parsed. Its timestamp still tells us when we reached the live tail.
          const m = TIME_US.exec(data);
          if (!m) return;
          const t = Number(m[1]);
          if (t >= startUs) {
            pass.caughtUp = true;
            finish();
            return;
          }
          pass.ignored++;
          // Fully handled at zero cost, so the cursor may move past it (else a quiet collection never advances).
          if (saved === null || t >= saved) pass.lastUs = Math.max(pass.lastUs ?? 0, t);
          return;
        }
        let ev: JetstreamEvent;
        try {
          ev = JSON.parse(data);
        } catch {
          return;
        }
        if (typeof ev?.time_us !== 'number') return;
        // Live tail reached: stop instead of idling on network-wide traffic. This event is left for the next run.
        if (ev.time_us >= startUs) {
          pass.caughtUp = true;
          finish();
          return;
        }
        // Replay of the 5 s rewind window: events below the saved cursor were already applied, so skip them at zero
        // D1 cost. Events at the saved time_us are re-applied (idempotent), so a stop inside a tie loses nothing.
        // Edge case: if more events share the saved time_us than one run's budget allows, the cursor cannot advance;
        // microsecond timestamps make that very unlikely.
        if (saved !== null && ev.time_us < saved) {
          pass.ignored++;
          return;
        }
        if (used() + WORST_CASE_EVENT_COST + CURSOR_SAVE_RESERVE + WEBSOCKET_RESERVE > PLATFORM_QUERY_LIMIT) {
          pass.capped = true;
          finish();
          return;
        }
        const outcome = await applyEvent(o.db, ev, o.nowMs());
        if (outcome === 'error') {
          pass.errored = true;
          finish();
          return;
        }
        pass[outcome]++;
        pass.lastUs = Math.max(pass.lastUs ?? 0, ev.time_us);
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
export async function drainJetstream(opts: DrainOptions): Promise<DrainResult> {
  const counted = countQueries(opts.db);
  const o: DrainOptions = { ...opts, db: counted.db };
  const startUs = o.nowMs() * 1000;
  const saved = await getCursor(o.db);
  try {
    await pruneIngestCounts(o.db, o.nowMs());
  } catch (err) {
    // Housekeeping only: never let it stop ingest.
    console.error('ingest_counts prune failed', err instanceof Error ? err.name : 'unknown');
  }
  const base = `${o.endpoint}?${WANTED}`;
  let gap = false;

  let pass = await onePass(o, saved === null ? base : `${base}&cursor=${Math.max(0, saved - REWIND_US)}`, saved, counted.used, startUs);
  if (pass.failedEarly && !pass.errored) {
    gap = true;
    if (saved !== null) {
      // Probably older than Jetstream's replay window: take what is live instead.
      pass = await onePass(o, base, null, counted.used, startUs);
    }
  }

  let cursor = saved;
  let errored = pass.errored;
  let errorStreak = errored ? 1 : 0;
  // Only move forward: replayed events inside the rewind must not drag the cursor back.
  const advance = pass.lastUs !== null && (saved === null || pass.lastUs > saved) ? pass.lastUs : null;
  if (advance !== null || errored) {
    try {
      errorStreak = await saveRunState(o.db, advance, errored);
      if (advance !== null) cursor = advance;
    } catch (err) {
      // Not fatal: the next run replays from the old cursor, which is idempotent.
      console.error('jetstream cursor save failed', err instanceof Error ? err.name : 'unknown');
      if (!errored) errorStreak = 1;
      errored = true;
    }
  }
  return {
    applied: pass.applied,
    rejected: pass.rejected,
    ignored: pass.ignored,
    cursor,
    gap,
    errored,
    errorStreak,
    capped: pass.capped,
    caughtUp: pass.caughtUp,
  };
}
