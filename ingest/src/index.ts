import { drainJetstream } from './drain';

interface Env {
  DB: D1Database;
}

const ENDPOINT = 'wss://jetstream2.us-east.bsky.network/subscribe';

export default {
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const r = await drainJetstream({
      db: env.DB,
      connect: (url) => new WebSocket(url),
      endpoint: ENDPOINT,
      maxMs: 20_000,
      idleMs: 3_000,
      nowMs: Date.now,
    });
    if (r.gap) console.warn('jetstream gap: could not resume from the saved cursor', r);
    if (r.capped) console.warn('jetstream backlog: run hit the event budget, continuing next run', r);
    // Counts and flags only; never record contents.
    if (r.errored) console.error(`jetstream drain stopped on a D1 error (errored runs in a row: ${r.errorStreak})`, r);
    else console.log('jetstream drain', r);
  },
};
