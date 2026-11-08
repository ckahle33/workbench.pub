# workbench.pub

React + Vite + React Router frontend, Hono API, Cloudflare D1, and a cron Worker (`ingest/`).

## Deployment target: Workers with static assets (not Pages)

Cloudflare's Pages overview currently says "Start new projects with Workers." The compatibility matrix
also shows Cron Triggers and the broader feature set only on Workers, with D1 supported on both. So the
root `wrangler.toml` defines a Worker (`main = "functions/index.ts"`, a Hono app) that serves `dist/` as
static assets with SPA fallback, and runs first only for `/api/*`. D1 binding is `DB` in both
`wrangler.toml` and `ingest/wrangler.toml`.

Caveat: Workers only serves custom domains whose DNS is managed by Cloudflare, so workbench.pub must be
added as a Cloudflare zone. Pages-style file-based routing under `functions/` is not automatic; the Hono
app routes explicitly.

Verified 2026-11-07. Pinned versions: vitest 4.1.x (@cloudflare/vitest-plugin 1.6 accepts ^4.1 or ^5; it is the renamed @cloudflare/vitest-pool-workers), wrangler ^4.158, vite ^8.3, react 19, react-router-dom 7, hono ^4.13, typescript ^6.0.

## Scripts

`npm run dev` (Vite, proxies `/api` to wrangler on 8787), `npm run build`, `npm test`, `npm run typecheck`.

## Tests

`vitest.workspace.ts` defines three projects: `node` (shared/, ingest/, scripts/), `workers` (D1 tests in the
Workers runtime: `shared/db.test.ts`, `ingest/src/apply.test.ts`, `ingest/src/drain.test.ts`, `functions/**`; applies `migrations/` when
it exists) and `jsdom` (React, `src/`). Vitest 4 has no workspace file, so `vitest.config.ts` loads it as
`test.projects`.

## Jetstream drain (ingest/)

The cron Worker (`*/5 * * * *`) connects to `wss://jetstream2.us-east.bsky.network/subscribe` with
`wantedCollections=pub.workbench.*&cursor=<saved time_us minus 5s>`, applies events, stores the highest
`time_us` seen, and disconnects after 3 s of silence or 20 s total. It stops without advancing the cursor
past an event if D1 fails. A saved cursor that fails immediately triggers one retry without a cursor and
`gap: true` in the log.

Verified 2026-11-07 against https://bsky.network/docs/jetstream/ and a live `wrangler dev --test-scheduled` run:
the docs list `jetstream2.us-east.bsky.network` and `jetstream1.us-west.bsky.network` as v1 hosts and describe a
newer Jetstream v2 (`jetstream.us-east.bsky.network`, recommended for new projects, params `collections`/`dids`/`kinds`/`cursor`,
`seq` cursors, replay only on v2, a bounded lookback window of unstated length). The docs do not document v1 params, so
`wantedCollections` and microsecond `cursor` are unconfirmed in text; they work in practice on the v1 host (a live run
returned a handful of events in 3 s, i.e. filtering is applied, and stored a `time_us` cursor). Revisit moving to v2.
