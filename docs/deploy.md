# Deploying workbench.pub

The full runbook: free-tier limits, deploy steps, smoke test, rate limiting, logs and rollback, known risks, and seeding the starter topics. Moved out of the README; content unchanged.

## Deploying

Every limit below was read from the official Cloudflare docs on 2026-11-07 unless it says "unknown". The site is deployed at
https://workbench.pub (web Worker, ingest cron and D1 are live). Still to be verified live: sign-in against a real account and first posts.

### Free-tier limits (checked 2026-11-07)

| Question | Answer | Source |
|---|---|---|
| D1 queries / subrequests per invocation (Workers Free) | 50 (Paid: 1,000). A `db.batch()` of N statements counts as 1 query. | https://developers.cloudflare.com/d1/platform/limits/ and https://developers.cloudflare.com/workers/platform/limits/ |
| Cron Triggers | Minimum frequency not stated (every minute `* * * * *` is the documented shortest example). 5 triggers per account on Free. CPU time per Cron Trigger: 10 ms on Free. Wall-clock duration: 15 min. Waiting on network, KV or database calls does not count as CPU time. Changes can take up to 15 minutes to propagate; schedules are UTC. | https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/workers/configuration/cron-triggers/ |
| Outbound WebSocket client | `new WebSocket(url)` is supported in Workers; outbound sockets count toward the 6 simultaneous open connections limit. Whether idle waiting on an open socket counts as CPU time: not documented (only network/KV/database waits are documented as not counting). | https://developers.cloudflare.com/workers/runtime-apis/websockets/ and the limits page |
| D1 Free | 5 million rows read/day, 100,000 rows written/day, 5 GB total storage (500 MB max per database, 10 databases). Resets 00:00 UTC. Hitting a limit makes queries fail until reset. | https://developers.cloudflare.com/d1/platform/pricing/ and /d1/platform/limits/ |
| Workers Free requests | 100,000/day, resets at midnight UTC (Error 1027 after). Requests to static assets are "free and unlimited". Requests that match `run_worker_first` still invoke the Worker and, past the daily limit, get a 429 instead of falling back to assets. | https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ |
| Custom domain | Needs an active Cloudflare zone (the docs do not spell out "Cloudflare DNS", but the zone is a Cloudflare zone, so the domain's nameservers must point to Cloudflare). No existing CNAME may exist on the hostname. Apex domains are supported. Cloudflare creates the DNS record and an Advanced Certificate with no extra subscription. | https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ |
| Static assets config | `run_worker_first` accepts an array of globs (up to 100; `!` prefix for negatives). `not_found_handling = "single-page-application"` serves `/index.html` with 200 for unmatched paths. The docs' flowchart says non-listed navigation requests are served from assets without invoking the Worker; the prose does not state it directly, so confirm in the smoke test that `/t/electronics` loads and `/api/nope` returns the API 404. Limits: 20,000 files, 25 MiB per file. | https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/ and /workers/static-assets/binding/ |

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

8. Create the dedicated site account on the workbench.pub domain and an app password for it, put them in `.env` (see "Seeding topics"), and run once. The handle must be verified with a DNS TXT record, not the HTTP method: add `_atproto.workbench.pub` with the value `did=<the account's DID>` in Cloudflare DNS. The `/.well-known/atproto-did` HTTP method does not work here because the SPA fallback answers that path with `index.html`.

   ```bash
   npm run seed:topics
   ```

   Topics appear on the site after the next cron run.

### Smoke test

1. Open https://workbench.pub in a private window; `/t/electronics` and a hard refresh on it must load the app. Check the headers are served (`curl -sI https://workbench.pub/ | grep -iE 'content-security-policy|x-frame-options'`; if missing, see "Edge caching and security headers"), open the browser console on a few pages (home, a project with photos and a link card, sign-in) and confirm there are no CSP violations.
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

### Rate limiting on /api/* (add after the first deploy)

The Worker caps link-card fetches per IP and edge-caches the anonymous feed, topic list and images, but nothing stops a single client from hammering other `/api/*` routes and burning the free Worker and D1 quotas. Add one free Cloudflare WAF rate limiting rule in the dashboard:

1. Select the `workbench.pub` zone, then Security, then WAF, then the Rate limiting rules tab, then Create rule.
2. Name it `api`. Under "If incoming requests match", choose "Custom expression" or the field picker: Field `URI Path`, Operator `starts with`, Value `/api/`.
3. Under "With the same characteristics", keep `IP` (the only characteristic on Free).
4. "When rate exceeds": for example 100 requests per 10 seconds (Free offers only the 10 second period).
5. "Then take action": Block, for the duration offered (10 seconds on Free). Deploy.

What I could not verify: these menu names and the Free plan's exact options are from memory of Cloudflare's docs (one free rate limiting rule, IP-only characteristic, 10 s period and 10 s mitigation timeout); the docs could not be fetched while writing this. Check https://developers.cloudflare.com/waf/rate-limiting-rules/ and adjust. The navigation has moved between "Security, WAF" and "Security, Security rules" in recent dashboard versions.

### Edge caching and security headers

- `GET /api/feed` without `following` and `GET /api/topics` are cached in `caches.default` for 30 s (`Cache-Control: public, max-age=30`), keyed on the full URL; requests with an `Authorization` header and non-200 responses are never cached. Images from `/api/blob` are cached at the edge (CID-addressed, immutable) and DID-to-PDS lookups for an hour. The Cache API only works on the custom domain, not on `*.workers.dev`. A hide or block can take up to 30 s to leave the cached lists.
- `public/_headers` is meant to set nosniff, a referrer policy, `X-Frame-Options: DENY` and a CSP on the static assets (the HTML shell, JS/CSS, `client-metadata.json`). UNVERIFIED in production: whether deployed Workers static assets honour `_headers` (local `wrangler dev` 4.158 does: it logs "Parsed 1 valid header rule" and serves the headers on `/`, SPA routes and `client-metadata.json`). The smoke test checks it with `curl -sI https://workbench.pub/ | grep -i content-security-policy`. If the headers are missing, set them from the Worker instead: add `/` and the HTML routes to `run_worker_first` and have the Worker fetch the asset from `env.ASSETS` and add the headers to the HTML response. `connect-src` and `img-src` allow any `https:` origin because the OAuth client talks to each user's own PDS and authorization server, and link-card images are arbitrary. `/api/*` responses come from the Worker and are not affected.

### Logs and rollback

- Live logs: `npx wrangler tail workbench-pub` (web) and `npx wrangler tail workbench-ingest` (cron). The ingest Worker logs `jetstream drain {...}` (counts and flags only), `jetstream gap`, `jetstream drain stopped on a D1 error (errored runs in a row: N)` and, for a poison event, `ingest apply error` with the error name, uri and collection.
- Roll back a Worker to its previous version: `npx wrangler rollback` (web, from the repo root) or `npx wrangler rollback --config ingest/wrangler.toml` (ingest). Rollback does not undo D1 migrations or secrets.

### Known risks and fallbacks

1. Granular OAuth scopes. Sign-in requests `repo:pub.workbench.*` per collection plus `repo:app.bsky.feed.post?action=create` (cross-posting an update to Bluesky) and `blob:image/*`; whether every PDS has shipped these is not documented. The Bluesky post permission is requested on every new sign-in (the consent screen shows it as creating Bluesky posts). Sessions created before it was added do not have it: cross-posting from them fails with a scope error and the person must sign out and sign in again. Nothing else breaks for them. If sign-in fails with a scope error, change `scope` to `atproto transition:generic` in both `src/auth/config.ts` and `public/client-metadata.json` (a test checks they match), rebuild and redeploy.
2. Jetstream v1 vs v2. The ingest uses the legacy v1 host and `wantedCollections`/microsecond `cursor`. They are documented only in the legacy repo, not marked removed, and worked in a live run. v2 is what the current docs recommend; move before v1 is retired (no date is published).
3. D1 per-invocation query limit (50 on Free). Implemented: the drain budgets by D1 queries (`ingest/src/drain.ts`): `applyEvent` costs at most 3 queries per event, the run reserves 1 for `getCursor`, 1 for the `ingest_counts` prune, 1 for the closing cursor save and 2 for the WebSocket subrequests (in case subrequests share the limit), so a run applies at most 15 events and stops cleanly with `capped`; the cron runs every minute. A capped run re-applies the event at its saved cursor, so a sustained backlog drains at about 14 new events per run, 14 x 1440 = about 20,000 events/day. A cursor-save failure is non-fatal. Still unknown: whether 15 events fit in the 10 ms Free cron CPU limit (check in the smoke test, step 4).
4. Link cards: a Worker cannot resolve DNS, so the SSRF check (`shared/ssrf.ts`) is hostname- and literal-IP-based; a public-looking hostname that resolves to a private address (DNS rebinding, nip.io-style names) is not caught. Residual risk; Cloudflare's network egress limits the blast radius but this is not verified.
5. Follow state is not persistent across devices: there is no "my follows" API, so the follow record uri is remembered in the browser's localStorage (`src/follows.ts`) per signed-in did. A new browser shows everything as not followed.
6. Optimistic items are removed only when the server later returns the same `uri` (`src/optimistic.ts`); if indexing rejects the record, or ingest is stalled, the item stays visible.
7. `/api/admin/block` stops future ingest from a DID and hides everything it already has indexed (its topics, projects, updates, replies and follows). The edge-cached global feed and topic list can still show it for up to 30 seconds, and already-cached images stay cached at the edge. Blocking a DID that owns a topic hides that topic for everyone, and its slug cannot be reclaimed (topics are first-indexed-wins and the hidden row still holds the slug). There is no unblock route yet: undoing a block needs manual SQL (delete the `blocked_dids` row and reset `hidden` on that DID's rows).


## Seeding topics

The starter topics (electronics, music-production, ceramics, woodworking, illustration, 3d-printing) are `pub.workbench.topic` records in a dedicated site account's repo. Create that account on the workbench.pub domain, then create an app password for it in its settings. Copy `.env.example` to `.env` (gitignored) and fill in `SEED_IDENTIFIER` (the site account's handle) and `SEED_APP_PASSWORD`, then run `npm run seed:topics` once after deploy. It skips topics that already exist, so re-running is safe. Never commit credentials or paste the app password anywhere else; revoke it when you are done.
