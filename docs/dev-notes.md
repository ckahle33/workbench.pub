# Developer notes

Platform choice, test layout, the ingest drain and the sign-in client. Moved out of the README; content unchanged.

### Deployment target: Workers with static assets (not Pages)

Cloudflare's Pages overview currently says "Start new projects with Workers." The compatibility matrix
also shows Cron Triggers and the broader feature set only on Workers, with D1 supported on both. So the
root `wrangler.toml` defines a Worker (`main = "functions/index.ts"`, a Hono app) that serves `dist/` as
static assets with SPA fallback, and runs first only for `/api/*` and the share pages `/p/*`, `/u/*`, `/t/*`, `/profile/*` (see "Share cards"). D1 binding is `DB` in both
`wrangler.toml` and `ingest/wrangler.toml`.

Caveat: Workers only serves custom domains whose DNS is managed by Cloudflare, so workbench.pub must be
added as a Cloudflare zone. Pages-style file-based routing under `functions/` is not automatic; the Hono
app routes explicitly.

Verified 2026-11-07. Pinned versions: vitest 4.1.x (@cloudflare/vitest-plugin 1.6 accepts ^4.1 or ^5; it is the renamed @cloudflare/vitest-pool-workers), wrangler ^4.158, vite ^8.3, react 19, react-router-dom 7, hono ^4.13, typescript ^6.0.

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

## Cross-posting

New update form only, opt-in ("Also post this to Bluesky", unchecked by default, remembered per account in localStorage as `wb.crosspost:<did>`).
Code: `src/records/crosspost.ts` (caption, record, `createCrosspost`), `src/components/CrosspostBox.tsx`, wiring in `src/pages/NewUpdate.tsx`.

- Order: the workbench update is created first; only after it succeeds is the Bluesky post created, as a separate `createRecord` of `app.bsky.feed.post`. A failed Bluesky post never rolls back the update, is never retried, and shows a notice ("Your update is posted. The Bluesky post did not go through: <code> (crosspost)...") with a `[crosspost]` console line (stage, status, error name only). Error stage is `crosspost` (`src/records/errors.ts`).
- Post: text is `caption`, a newline, then the permalink `https://workbench.pub/u/<did>/<rkey>`; a link facet covers the URL using UTF-8 byte offsets (`TextEncoder`); embed is `app.bsky.embed.external` (title `Project: Heading`, description first 200 characters of the notes). The caption budget is 300 graphemes (`Intl.Segmenter`) minus the link and the newline, assuming a 13 character record key.
- Thumb: the first photo's blob from the update step is reused when its size is at most 1,000,000 bytes (the lexicon limit for external thumbs). Otherwise the original file is re-resized to 1000px (`resizeImage`, JPEG) and uploaded as a separate blob; if that fails the post goes out without a thumb. The photos are never posted as an image set.
- Scope: `repo:app.bsky.feed.post?action=create` (syntax from https://atproto.com/specs/permission, `repo:<collection>?action=...`). Sessions created before the scope existed get a scope error from the PDS; the message tells the person to sign out and in. Not verified against a live server: whether Bluesky's own authorization server grants this scope to third-party clients.
- Not cross-posted: replies, topics, follows, projects.

## Sign-in (AT Protocol OAuth)

Public browser client (`@atproto/oauth-client-browser` 0.5.x, `BrowserOAuthClient`), no backend session and no secrets.
Tokens are DPoP-bound and kept by the library in IndexedDB. `src/auth/oauth.ts` wraps the client (`signIn`,
`restoreSession`, `signOut`); `src/auth/SessionContext.tsx` provides `useSession()`; `/signin` is the page.
There is no separate callback route: the redirect URI is the site root (`https://workbench.pub/`), and
`restoreSession()` runs on every app load and completes the login if the URL carries callback parameters.

**Scope used (verified 2026-11-07 against https://atproto.com/specs/permission and /specs/oauth):**
`atproto repo:pub.workbench.topic repo:pub.workbench.project repo:pub.workbench.update repo:pub.workbench.reply repo:pub.workbench.follow repo:app.bsky.feed.post?action=create blob:image/*`.
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
`used + 3 (worst-case applyEvent) + 1 (cursor save) + 2 (WebSocket subrequests, in case they share the limit) <= 50`,
otherwise it stops, saves the cursor at the last handled event and reports `capped` so the next run continues. Fixed
costs per run: `getCursor` 1, one bounded `ingest_counts` prune (50 rows older than 2 days) 1, the cursor save 1. Real
event costs: identity/account frames (skipped without `JSON.parse`), foreign collections and replay-skipped events 0, a
blocked DID 1, a rejected record 2, a normal event 3. With all-normal events a run fits floor((50 - 3 - 2) / 3) = 15
events (48 D1 queries plus 2 sockets); a capped run re-applies the event at the saved cursor (idempotent), so it nets
about 14 new events, about 20,000 per day at one run a minute (14 x 1440). A run also stops as soon as an event's `time_us` reaches
the time the run started (`caughtUp`), so a live-tail run does not idle on network-wide traffic. The log line reports
`applied`, `rejected` and `ignored` separately and `errorStreak`, the number of consecutive runs that stopped on a D1 error
(persisted in `cursor.error_streak`). A failed cursor save is logged and reported as `errored` rather than thrown. The
Free-plan 10 ms CPU limit for cron invocations is untested until a deploy smoke test (watch `wrangler tail` and the
dashboard CPU time).

## Share cards

Link-preview crawlers (Bluesky, Slack, iMessage, Discord, X) do not run JavaScript, so they only see the tags in the HTML shell.

- Default card: `public/og.png` (1200x630 PNG, about 46 KB), rendered from `scripts/og/og.html` with headless Chrome by `sh scripts/og/render.sh` (also renders `public/apple-touch-icon.png` and packs `public/favicon.ico`, 32+16 PNG-in-ICO; see `scripts/og/README.md`). `index.html` carries the full default set: canonical, description, `og:*` with image size and alt, `twitter:card` `summary_large_image`, favicon, theme colour. `DEFAULT_*` in `functions/shareMeta.ts` must match it (tested).
- Per-page meta: `wrangler.toml` `run_worker_first = ["/api/*", "/p/*", "/u/*", "/t/*", "/profile/*"]` (globs, `*` matches deeply; verified against https://developers.cloudflare.com/workers/static-assets/binding/ on 2026-11-08). `functions/shareMeta.ts` (mounted last in `functions/app.ts`) fetches the shell with `env.ASSETS.fetch(<origin>/)`, parses the path (`/p/:did/:rkey`, `/u/:did/:rkey`, `/t/:slug`, `/profile/:did`; anything else, such as `/p/:did/:rkey/update`, gets the shell unchanged without touching D1), runs ONE D1 query with the read API's visibility rules, and rewrites `<title>`, description, `og:title/description/url/type/image/image:alt`, `twitter:*` and the canonical link with `HTMLRewriter`. Misses, hidden or blocked content and malformed paths return 200 with the default tags; the SPA shows its own not-found.
- Text: user text goes through `cleanText` (lone surrogates replaced, whitespace collapsed, C0/C1 and bidi-control characters removed, truncated by graphemes: titles 70, descriptions 200, with `…`) and is written only through `setAttribute` / `setInnerContent`. `setAttribute` escapes only `"`, so `&`, `<`, `>` are encoded before it (tests pin this).
- Image: project = first photo of the latest owner update that has photos, else the project cover; update = its first photo, else the project cover. Used only when the blob proxy would serve it (resolvable DID, CID, raster type from the record) and the record's `size` is at most 900,000 bytes (Bluesky's thumbnail limit is about 1 MB and the proxy serves the original); otherwise `og.png`. Photo cards drop `og:image:width/height/type` (unknown). Local demo data uses fake DIDs and SVG placeholders, so locally every card shows `og.png`.
- Cache: a found entity's meta (small JSON) is kept in `caches.default` for 5 minutes under `https://cache.internal/share-meta/v1<canonical path>` (query strings cannot bust it); misses are not cached, so a page indexed a minute later gets its card. Hidden or blocked content can keep its card for up to 5 minutes. The HTML itself is not edge-cached and keeps the shell's `Cache-Control` (`public, max-age=0, must-revalidate`), so a deploy never leaves a cached shell pointing at old asset hashes.
- Headers: Cloudflare documents that `_headers` is not applied to Worker responses, so the share routes set `SECURITY_HEADERS` (`functions/securityHeaders.ts`) themselves; a test keeps it equal to the `/*` block of `public/_headers`. The shell's `ETag` is dropped because the body changed.
- Limits: every share-page request is a Worker invocation (counts toward the 100,000/day Free limit; past it those pages get Cloudflare's 429 instead of the static shell), and at most one D1 query.
