# workbench.pub

A social site for makers who show their work as it happens. Post a project (a guitar pedal, a
recording, a ceramic piece) and add updates over days or weeks: photos, notes, links, parts lists.
Follow projects and topics, and reply to individual updates.

It is built on the [AT Protocol](https://atproto.com). You sign in with an existing Bluesky/AT
account, and your projects, updates and replies are stored as records in your own account
(`pub.workbench.*`), not on our servers. This site indexes them and displays them.

Status: in development. The backend is built; the sign-in is built; the pages are in progress.

## How it works

```
your account (PDS) --> Jetstream --> cron Worker --> D1 index --> Hono API --> React app
```

- `src/`: React app (Vite + React Router)
- `functions/`: Hono API (reads, link cards, image proxy, admin and reports)
- `ingest/`: cron Worker that copies new `pub.workbench.*` records from Jetstream into D1
- `shared/`, `lexicons/`, `migrations/`: record schemas and validation, D1 schema
- Everything runs on the Cloudflare free tier.

## Run it locally

```bash
npm install
npm test          # all tests (node, Workers/D1, jsdom)
npm run dev       # Vite dev server; /api is proxied to wrangler on 8787
```

Copy `.dev.vars.example` to `.dev.vars` and set `ADMIN_TOKEN` before running the API locally.
The full design is in `docs/superpowers/specs/` and the build plan is in `docs/superpowers/plans/`.

## Developer notes

### Deployment target: Workers with static assets (not Pages)

Cloudflare's Pages overview currently says "Start new projects with Workers." The compatibility matrix
also shows Cron Triggers and the broader feature set only on Workers, with D1 supported on both. So the
root `wrangler.toml` defines a Worker (`main = "functions/index.ts"`, a Hono app) that serves `dist/` as
static assets with SPA fallback, and runs first only for `/api/*`. D1 binding is `DB` in both
`wrangler.toml` and `ingest/wrangler.toml`.

Caveat: Workers only serves custom domains whose DNS is managed by Cloudflare, so workbench.pub must be
added as a Cloudflare zone. Pages-style file-based routing under `functions/` is not automatic; the Hono
app routes explicitly.

Verified 2026-11-07. Pinned versions: vitest 4.1.x (@cloudflare/vitest-plugin 1.6 accepts ^4.1 or ^5; it is the renamed @cloudflare/vitest-pool-workers), wrangler ^4.158, vite ^8.3, react 19, react-router-dom 7, hono ^4.13, typescript ^6.0.

## Deploying

Every limit below was read from the official Cloudflare docs on 2026-11-07 unless it says "unknown". Nothing here has been run
against a real Cloudflare account yet.

### Free-tier limits (checked 2026-11-07)

| Question | Answer | Source |
|---|---|---|
| D1 queries / subrequests per invocation (Workers Free) | 50 (Paid: 1,000). A `db.batch()` of N statements counts as 1 query. | https://developers.cloudflare.com/d1/platform/limits/ and https://developers.cloudflare.com/workers/platform/limits/ |
| Cron Triggers | Minimum frequency not stated (every minute `* * * * *` is the documented shortest example). 5 triggers per account on Free. CPU time per Cron Trigger: 10 ms on Free. Wall-clock duration: 15 min. Waiting on network, KV or database calls does not count as CPU time. Changes can take up to 15 minutes to propagate; schedules are UTC. | https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/workers/configuration/cron-triggers/ |
| Outbound WebSocket client | `new WebSocket(url)` is supported in Workers; outbound sockets count toward the 6 simultaneous open connections limit. Whether idle waiting on an open socket counts as CPU time: not documented (only network/KV/database waits are documented as not counting). | https://developers.cloudflare.com/workers/runtime-apis/websockets/ and the limits page |
| D1 Free | 5 million rows read/day, 100,000 rows written/day, 5 GB total storage (500 MB max per database, 10 databases). Resets 00:00 UTC. Hitting a limit makes queries fail until reset. | https://developers.cloudflare.com/d1/platform/pricing/ and /d1/platform/limits/ |
| Workers Free requests | 100,000/day, resets at midnight UTC (Error 1027 after). Requests to static assets are "free and unlimited". Requests that match `run_worker_first` still invoke the Worker and, past the daily limit, get a 429 instead of falling back to assets. | https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ |
| Custom domain | Needs an active Cloudflare zone (the docs do not spell out "Cloudflare DNS", but the zone is a Cloudflare zone, so the domain's nameservers must point to Cloudflare). No existing CNAME may exist on the hostname. Apex domains are supported. Cloudflare creates the DNS record and an Advanced Certificate with no extra subscription. | https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ |
| Static assets config | `run_worker_first` accepts an array of globs (up to 100; `!` prefix for negatives). `not_found_handling = "single-page-application"` serves `/index.html` with 200 for unmatched paths. The docs' flowchart says non-listed navigation requests are served from assets without invoking the Worker; the prose does not state it directly, so confirm in the smoke test that `/topics/electronics` loads and `/api/nope` returns the API 404. Limits: 20,000 files, 25 MiB per file. | https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/ and /workers/static-assets/binding/ |

Consequence for the ingest Worker: the 50 query limit and the 10 ms CPU limit are real constraints. See "Known risks" item 3.

### Prerequisites

- A Cloudflare account (free) and Node 20 or newer.
- `workbench.pub` added to Cloudflare as a zone (nameservers changed at the registrar, zone shows Active), with no existing CNAME on the apex.
- You run `npx wrangler login` yourself (opens a browser). The steps below assume the repo root as the working directory and `npm install` already done.

### Steps

1. Create the D1 database. Copy the `database_id` it prints.

   ```bash
   npx wrangler d1 create workbench
   ```

2. Paste that id into `database_id` in both `wrangler.toml` and `ingest/wrangler.toml` (replace `00000000-0000-0000-0000-000000000000`). Nothing else needs editing: names, binding `DB`, the cron `* * * * *`, the assets block and `compatibility_date = "2026-11-01"` are already set.

3. Apply the migrations to the remote database (reads `migrations_dir = "migrations"` from `wrangler.toml`; answer `y` to the prompt):

   ```bash
   npm run db:migrate:remote
   ```

4. Build and deploy the web Worker (runs typecheck, `vite build`, then `wrangler deploy`). With the `[[routes]]` block in `wrangler.toml` this also attaches `workbench.pub` as a Custom Domain. If the domain step fails, fix the zone/CNAME problem and redeploy, or delete the `[[routes]]` block and add the domain in the dashboard (Workers & Pages, workbench-pub, Settings, Domains & Routes).

   ```bash
   npm run deploy:web
   ```

5. Set the secrets (after the first deploy, so the Worker exists). Generate each value with `openssl rand -hex 32`, then paste it at the prompt. Do not put them in a file, a command-line argument or git.

   ```bash
   openssl rand -hex 32          # copy the output
   npx wrangler secret put ADMIN_TOKEN
   openssl rand -hex 32
   npx wrangler secret put IP_HASH_SALT
   ```

   Keep the ADMIN_TOKEN in your password manager; you need it for the admin curl commands below.

6. Deploy the ingest Worker (cron):

   ```bash
   npm run deploy:ingest
   ```

7. Check the OAuth client metadata is served as JSON and matches production:

   ```bash
   curl -sD - https://workbench.pub/client-metadata.json
   ```

   Expect `200`, a `content-type` of `application/json`, `"client_id": "https://workbench.pub/client-metadata.json"` and `"redirect_uris": ["https://workbench.pub/"]`. If it comes back as HTML, the SPA fallback is shadowing it; check that `dist/client-metadata.json` exists after the build.

8. Create the dedicated site account on the workbench.pub domain and an app password for it, put them in `.env` (see "Seeding topics"), and run once:

   ```bash
   npm run seed:topics
   ```

   Topics appear on the site after the next cron run.

### Smoke test

1. Open https://workbench.pub in a private window; `/topics/electronics` and a hard refresh on it must load the app.
2. Sign in with a real account. If the PDS rejects the scopes, see risk 1.
3. Create a topic and a project; post an update with a photo and a GitHub link.
4. Wait one cron interval (one minute, plus up to 15 minutes the first time for the cron to propagate). Check `npx wrangler tail workbench-ingest --format pretty` for a `jetstream drain` line with `applied > 0` (`ignored` counts identity/account and foreign traffic and does not prove indexing). Also check the CPU time of the cron invocation in the dashboard (Workers & Pages, workbench-ingest, Metrics or the invocation logs): it must stay under the 10 ms Free limit. A line `jetstream drain stopped on a D1 error (errored runs in a row: N)` with N growing means a poison event: the preceding `ingest apply error` line names the error and the event's uri and collection.
5. In a signed-out window the project, update and photo appear.
6. Report and admin (use an environment variable so the token never appears in shell history files via a literal; `read -s` keeps it off the screen):

   ```bash
   read -s ADMIN_TOKEN; export ADMIN_TOKEN
   curl -s -X POST https://workbench.pub/api/report -H 'content-type: application/json' \
     -d '{"uri":"at://did:plc:EXAMPLE/pub.workbench.update/EXAMPLE","reason":"smoke test"}'
   curl -s https://workbench.pub/api/admin/reports -H "Authorization: Bearer $ADMIN_TOKEN"
   curl -s -X POST https://workbench.pub/api/admin/hide -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H 'content-type: application/json' -d '{"uri":"at://did:plc:EXAMPLE/pub.workbench.update/EXAMPLE"}'
   curl -s -X POST https://workbench.pub/api/admin/block -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H 'content-type: application/json' -d '{"did":"did:plc:EXAMPLE"}'
   curl -s -o /dev/null -w '%{http_code}\n' https://workbench.pub/api/admin/reports   # expect 401
   ```

   Replace the `EXAMPLE` values with real ones from your test content (use a throwaway test account for the block test). Reports return 201, admin calls return `{"ok":true}`.

### Logs and rollback

- Live logs: `npx wrangler tail workbench-pub` (web) and `npx wrangler tail workbench-ingest` (cron). The ingest Worker logs `jetstream drain {...}`, `jetstream gap` and `jetstream drain stopped on a D1 error`.
- Roll back a Worker to its previous version: `npx wrangler rollback` (web, from the repo root) or `npx wrangler rollback --config ingest/wrangler.toml` (ingest). Rollback does not undo D1 migrations or secrets.

### Known risks and fallbacks

1. Granular OAuth scopes. Sign-in requests `repo:pub.workbench.*` per collection plus `blob:image/*`; whether every PDS has shipped these is not documented. If sign-in fails with a scope error, change `scope` to `atproto transition:generic` in both `src/auth/config.ts` and `public/client-metadata.json` (a test checks they match), rebuild and redeploy.
2. Jetstream v1 vs v2. The ingest uses the legacy v1 host and `wantedCollections`/microsecond `cursor`. They are documented only in the legacy repo, not marked removed, and worked in a live run. v2 is what the current docs recommend; move before v1 is retired (no date is published).
3. D1 per-invocation query limit (50 on Free). `applyEvent` costs 3 queries for a normal event (see below), so one run can safely apply about 15 events. More than that in one run makes a D1 call throw, the drain stops with `errored`, and the closing `setCursor` also fails, so the cursor does not advance and every later run replays the same first events: the ingest stalls permanently while a backlog above about 15 events exists. Smallest fix, not yet implemented: cap events per run at 15 (close the socket and `setCursor` once the budget `2 + 3 x events` reaches 47), guard `setCursor` so a failure cannot hide progress, and run the cron every minute (`crons = ["* * * * *"]`, 15 events/minute is about 21,600/day) so the backlog drains. A second option is a single `db.batch` per drain that collects events during the socket window, since a batch counts as one query. Also unknown: whether 15 events fit in the 10 ms Free cron CPU limit.
4. Link cards: a Worker cannot resolve DNS, so the SSRF check (`shared/ssrf.ts`) is hostname- and literal-IP-based; a public-looking hostname that resolves to a private address (DNS rebinding, nip.io-style names) is not caught. Residual risk; Cloudflare's network egress limits the blast radius but this is not verified.
5. Follow state is not persistent across devices: there is no "my follows" API, so the follow record uri is remembered in the browser's localStorage (`src/follows.ts`) per signed-in did. A new browser shows everything as not followed.
6. Optimistic items are removed only when the server later returns the same `uri` (`src/optimistic.ts`); if indexing rejects the record, or ingest is stalled, the item stays visible.
7. `/api/admin/block` stops future ingest from a DID and hides everything it already has indexed (its topics, projects, updates, replies and follows). The edge-cached global feed and topic list can still show it for up to 30 seconds, and already-cached images stay cached at the edge.

## Scripts

`npm run dev` (Vite, proxies `/api` to wrangler on 8787), `npm run build`, `npm test`, `npm run typecheck`, and for deploys `npm run db:migrate:remote`, `npm run deploy:web`, `npm run deploy:ingest` (thin wrappers over wrangler; see Deploying).

## Seeding topics

The starter topics (electronics, music-production, ceramics, woodworking, illustration, 3d-printing) are `pub.workbench.topic` records in a dedicated site account's repo. Create that account on the workbench.pub domain, then create an app password for it in its settings. Copy `.env.example` to `.env` (gitignored) and fill in `SEED_IDENTIFIER` (the site account's handle) and `SEED_APP_PASSWORD`, then run `npm run seed:topics` once after deploy. It skips topics that already exist, so re-running is safe. Never commit credentials or paste the app password anywhere else; revoke it when you are done.

## Tests

`vitest.workspace.ts` defines three projects: `node` (shared/, ingest/, scripts/), `workers` (D1 tests in the
Workers runtime: `shared/db.test.ts`, `ingest/src/apply.test.ts`, `ingest/src/drain.test.ts`, `functions/**`; applies `migrations/` when
it exists) and `jsdom` (React, `src/`). Vitest 4 has no workspace file, so `vitest.config.ts` loads it as
`test.projects`.

## Jetstream drain (ingest/)

The cron Worker (`* * * * *`, every minute) connects to `wss://jetstream2.us-east.bsky.network/subscribe` with
`wantedCollections=pub.workbench.*&cursor=<saved time_us minus 5s>`, applies events, stores the highest
`time_us` seen, and disconnects after 3 s of silence or 20 s total. It stops without advancing the cursor
past an event if D1 fails. A saved cursor that fails immediately triggers one retry without a cursor and
`gap: true` in the log.

Re-verified 2026-11-07. The current official docs (https://bsky.network/docs/jetstream/) recommend Jetstream v2
(`jetstream.us-east.bsky.network`, path `/xrpc/network.bsky.jetstream.subscribeEvents`, params `collections`/`dids`/`kinds`/`cursor`,
`seq` cursors, replay only on v2, 36 hour lookback on Bluesky-hosted instances per https://bsky.network/docs/jetstream-replay) and list
`jetstream1.us-west` / `jetstream2.us-east` as v1 (legacy), not marked as removed. The v1 parameters are documented only in the legacy repo
README (https://github.com/bluesky-social/jetstream-legacy): `wantedCollections` supports NSID path prefixes such as `app.bsky.graph.*` (so
`pub.workbench.*` is valid), and `cursor` is a unix microseconds timestamp. The current docs do not state a v1 shutdown date. This host and
these params are therefore documented (legacy repo) and worked in a live `wrangler dev --test-scheduled` run, but they are the legacy path.
Moving to v2 needs a URL and param change plus reading the v2 event shape (v2 events carry a `cursor` field; whether they also carry `time_us`
is not stated), so it is a code task, not a config one.

## Sign-in (AT Protocol OAuth)

Public browser client (`@atproto/oauth-client-browser` 0.5.x, `BrowserOAuthClient`), no backend session and no secrets.
Tokens are DPoP-bound and kept by the library in IndexedDB. `src/auth/oauth.ts` wraps the client (`signIn`,
`restoreSession`, `signOut`); `src/auth/SessionContext.tsx` provides `useSession()`; `/signin` is the page.
There is no separate callback route: the redirect URI is the site root (`https://workbench.pub/`), and
`restoreSession()` runs on every app load and completes the login if the URL carries callback parameters.

**Scope used (verified 2026-11-07 against https://atproto.com/specs/permission and /specs/oauth):**
`atproto repo:pub.workbench.topic repo:pub.workbench.project repo:pub.workbench.update repo:pub.workbench.reply repo:pub.workbench.follow blob:image/*`.
Granular `repo:` and `blob:` scopes are defined in the current permission spec, so `transition:generic` is not
requested. The spec does not allow partial wildcards (`repo:pub.workbench.*` is invalid), so each collection is
listed explicitly; adding a collection means updating `src/auth/config.ts` and `public/client-metadata.json`
(a test checks they match). `blob:image/*` matches the lexicons' `image/*` blob accept. The spec does not say which
authorization servers have shipped granular scopes. If a user's PDS rejects them, fall back to
`atproto transition:generic` in both files. This was not tested against a live server.

**`public/client-metadata.json`** (served at `https://workbench.pub/client-metadata.json`; `client_id` must equal that URL exactly):
`client_id`, `client_name`, `client_uri`, `redirect_uris` = `["https://workbench.pub/"]`, `scope` (above),
`response_types` = `["code"]`, `grant_types` = `["authorization_code","refresh_token"]`,
`token_endpoint_auth_method` = `"none"`, `application_type` = `"web"`, `dpop_bound_access_tokens` = `true`.
No `jwks`: that is only for confidential clients.

**Development** uses the library's loopback mode: client id `http://localhost?scope=...&redirect_uri=http://127.0.0.1:<port>/`
(built in `buildLoopbackClientId`). Open the dev server via `http://127.0.0.1:<port>/`; the library redirects `localhost` there.
Any non-loopback origin other than workbench.pub (previews) will fail the redirect check.

Query budget: Workers Free allows 50 D1 queries per invocation (a `db.batch` counts as 1), so the drain budgets by
queries, not events. `ingest/src/queryBudget.ts` counts every query; before each event the drain requires
`used + 3 (worst-case applyEvent) + 1 (setCursor reserve) <= 50`, otherwise it stops, saves the cursor at the last
handled event and reports `capped` so the next run continues. Real costs: foreign, identity and replay-skipped events 0,
a blocked DID 1, a rejected record 2, a normal event 3. With all-normal events a run fits (50 - 1 getCursor - 1 setCursor) / 3
= 16 events; the first is the event at the saved cursor, which a capped run re-applies (idempotent) because
only events strictly below the cursor are skipped, so a capped run nets about 15 new events (16 on a fresh cursor), which
is roughly 21,600 per day at one run a minute (cheaper events raise it). A failed cursor save is logged and reported as
`errored` rather than thrown. The Free-plan 10 ms CPU limit for cron invocations is untested: whether 16 events fit is
unknown until a deploy smoke test (watch `wrangler tail`).
