# workbench.pub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build workbench.pub, a social site where makers post projects as timelines of updates, stored as AT Protocol records in each author's own account and indexed on Cloudflare's free tier.

**Architecture:** A React SPA signs users in with AT Protocol OAuth and writes `pub.workbench.*` records straight to their PDS. A cron Worker replays Jetstream from a saved cursor into D1 (the index). A Hono API in Pages Functions reads D1 and serves the SPA's pages, link cards and image proxy.

**Tech Stack:** TypeScript, Vite, React 18, React Router, Hono, Cloudflare Pages Functions + D1 + Workers cron, `@atproto/oauth-client-browser`, `@atproto/api`, Vitest with `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-11-07-workbench-design.md`

## Global Constraints

- Free tier only: Cloudflare Pages, D1, Workers. No VM, nothing paid. Cost outranks freshness.
- Namespace is `pub.workbench`. Records: `topic`, `project`, `update`, `reply`, `follow`, `defs`.
- TypeScript throughout. Frontend is React (Vite + React Router). Not SvelteKit.
- Ingest lag: aim for 1 minute, accept 5 to 15 minutes. Default cron is `*/5 * * * *`.
- Open posting. Only moderation in v1: admin hide, admin block, a report button.
- A community is a **topic**, never "circle". Topics are referenced by slug.
- Design principle: easy to reason about. Fewest record types, plain names, no indirection.
- The site stores no user media. Images are served from the author's PDS and cached at the edge.
- Admin auth is a bearer token in a Cloudflare secret (`ADMIN_TOKEN`), not an AT identity.
- Domain is workbench.pub (owned). Develop on `*.pages.dev` until the custom domain is wired.

## Review Focus

Failure modes the spec implies but no task would otherwise exercise, most likely first. Each has a test in the task that owns the code.

1. **Replay duplicates.** Jetstream replays from an older cursor. Re-applying the same events must change nothing (Task 4).
2. **Hostile records.** A repo writes a huge, malformed or wrong-typed `pub.workbench.update`. It must be rejected without throwing or burning D1 writes (Tasks 2, 4).
3. **SSRF through link cards.** A URL that redirects to `http://169.254.169.254/` or `localhost` must be refused (Task 7).
4. **Orphans and ordering.** An update arrives before its project, or the project is deleted. Pages must not 500 and must not show the orphan (Tasks 4, 6).
5. **Topic slug collisions.** `Electronics`, `electronics ` and a Unicode look-alike must resolve to one canonical topic, and the first indexed record must win (Tasks 2, 4).

## File Structure

```
package.json, tsconfig.json, vite.config.ts, vitest.workspace.ts, .gitignore
wrangler.toml                  Pages project (D1 binding DB, vars)
ingest/wrangler.toml           cron Worker (same D1 binding)
lexicons/pub/workbench/*.json  record schemas
migrations/0001_init.sql       D1 schema
shared/lexicons.ts             validateRecord, normalizeSlug, size caps
shared/types.ts                JetstreamEvent, record types
shared/db.ts                   all SQL, one function per query
ingest/src/apply.ts            applyEvent (pure over db)
ingest/src/drain.ts            drainJetstream (injected socket)
ingest/src/index.ts            scheduled() handler
functions/api/[[route]].ts     Hono app: reads, cards, blobs, admin, reports
functions/api/card.ts, blob.ts, admin.ts, read.ts   route modules
public/client-metadata.json    OAuth client metadata
src/                           React app (see Tasks 9 to 11)
scripts/seed-topics.ts         publishes the seed topics
```

---

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.workspace.ts`, `wrangler.toml`, `ingest/wrangler.toml`, `.gitignore`, `src/main.tsx`, `src/App.tsx`, `src/App.test.tsx`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `test`, `typecheck`; a Vitest workspace with a `node` project (shared, ingest), a `workers` project (D1 tests via `@cloudflare/vitest-pool-workers`) and a `jsdom` project (React).

- [ ] **Step 1: Write the failing test** `src/App.test.tsx`: renders `<App />` in a `MemoryRouter` and asserts `screen.getByRole('heading', { name: /workbench/i })`.
- [ ] **Step 2: Run** `npm test` -> FAIL (no App).
- [ ] **Step 3: Scaffold** Vite + React + TS; add Hono, React Router, `@atproto/api`, `@atproto/oauth-client-browser`, Vitest, Testing Library, `@cloudflare/vitest-pool-workers`, wrangler. `.gitignore` must include `node_modules`, `dist`, `.wrangler`, `.dev.vars`, `.superpowers/`. Run `git init` first (the directory is not a repo yet). The D1 binding is `DB` in both wrangler files; the builder must verify the current recommended Pages-vs-Workers-assets setup for new projects (spec "Unverified assumptions") and record the choice in `README.md`.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` -> PASS.
- [ ] **Step 5: Commit** `chore: scaffold workbench.pub`.

### Task 2: Lexicons and validation

**Files:**
- Create: `lexicons/pub/workbench/{topic,project,update,reply,follow,defs}.json`, `shared/lexicons.ts`, `shared/types.ts`
- Test: `shared/lexicons.test.ts`

**Interfaces:**
- Produces:
  - `type Collection = 'pub.workbench.topic' | 'pub.workbench.project' | 'pub.workbench.update' | 'pub.workbench.reply' | 'pub.workbench.follow'`
  - `validateRecord(collection: Collection, record: unknown): { ok: true; value: T } | { ok: false; reason: string }`
  - `normalizeSlug(input: string): string | null` (NFKC, lowercase, `[a-z0-9-]`, 2 to 40 chars, trimmed hyphens; `null` if it cannot be made valid)
  - `LIMITS`: `{ title: 120, summary: 500, heading: 120, body: 5000, images: 6, links: 8, parts: 40, replyBody: 2000 }`

- [ ] **Step 1: Write failing tests** for: a valid record per collection passes; a 5001-char `body` is rejected; 7 images rejected; `status: 'banana'` rejected; wrong `$type` rejected; `normalizeSlug('Electronics')`, `normalizeSlug(' electronics ')` and `normalizeSlug('ｅｌｅｃｔｒｏｎｉｃｓ')` all return `'electronics'`; `normalizeSlug('!')` returns `null`. **(Review Focus 2, 5)**
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement.** Fields per spec "Records". `project.topic` is a slug string. `update.project` is an at-uri. Hand-validate against `LIMITS` (no schema library needed). Lexicon JSON files document the same shape.
- [ ] **Step 4: Run** -> PASS.
- [ ] **Step 5: Commit** `feat: lexicons and record validation`.

### Task 3: D1 schema and data layer

**Files:**
- Create: `migrations/0001_init.sql`, `shared/db.ts`
- Test: `shared/db.test.ts` (workers project)

**Interfaces:**
- Consumes: `Collection`, record types from Task 2.
- Produces (all `(db: D1Database, ...) => Promise<...>`):
  - `upsertTopic(db, t: { slug; name; description; uri; ownerDid; indexedAt }): Promise<void>` (insert-if-absent: first indexed wins)
  - `upsertProject`, `upsertUpdate`, `upsertReply`, `upsertFollow` (replace by `uri`)
  - `deleteByUri(db, uri: string): Promise<void>` (never deletes from `topics`)
  - `getCursor(db): Promise<number | null>`, `setCursor(db, timeUs: number): Promise<void>`
  - `isBlocked(db, did: string): Promise<boolean>`, `blockDid`, `hideUri(db, uri)`
  - `bumpAndCheckRate(db, did: string, nowMs: number, cap: number): Promise<boolean>` (true while under the cap for the current hour)
- Tables: `topics, projects, updates, replies, follows, profiles, cursor, blocked_dids, reports, link_cache, ingest_counts`; each content table has `uri TEXT PRIMARY KEY, did, rkey, created_at, indexed_at, hidden INTEGER DEFAULT 0`; indexes on `(topic_slug, created_at)`, `(project_uri, created_at)`, `(subject_uri, created_at)`.

- [ ] **Step 1: Write failing tests**: upserting the same project twice yields one row; `upsertTopic` called twice with the same slug keeps the first `uri`; `deleteByUri` on a topic uri leaves the topic row; `bumpAndCheckRate` returns false on call cap+1 and true again in the next hour; `setCursor`/`getCursor` round-trip.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Write** `0001_init.sql` and implement the functions (parameterised SQL only).
- [ ] **Step 4: Run** with migrations applied by the workers pool -> PASS.
- [ ] **Step 5: Commit** `feat: D1 schema and data layer`.

### Task 4: Ingest event handling

**Files:**
- Create: `ingest/src/apply.ts`
- Test: `ingest/src/apply.test.ts` (workers project)

**Interfaces:**
- Consumes: `validateRecord`, `normalizeSlug`, db functions.
- Produces:
  - `interface JetstreamEvent { did: string; time_us: number; kind: 'commit' | 'identity' | 'account'; commit?: { operation: 'create' | 'update' | 'delete'; collection: string; rkey: string; cid?: string; record?: unknown } }`
  - `applyEvent(db: D1Database, ev: JetstreamEvent, nowMs: number): Promise<'applied' | 'ignored' | 'rejected'>`
  - `HOURLY_WRITE_CAP = 200`

- [ ] **Step 1: Write failing tests** (each uses a real D1): create then update changes the row; delete removes it; **applying the same event list twice leaves identical table contents (Review Focus 1)**; an update event whose `project` has no row yet is stored and returns `'applied'` **(Review Focus 4)**; a 6000-char body returns `'rejected'` and writes nothing **(Review Focus 2)**; a blocked DID returns `'ignored'`; the 201st write in an hour from one DID returns `'rejected'`; two topic records `Electronics` and `electronics ` from different DIDs leave one row owned by the first ingested **(Review Focus 5)**; a non-`pub.workbench.*` collection returns `'ignored'`.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement** `applyEvent`: ignore non-commits and foreign collections; check `isBlocked` then `bumpAndCheckRate`; validate; build the uri `at://did/collection/rkey`; dispatch to the db functions. Deletes call `deleteByUri`. Never throw on bad input; return `'rejected'`.
- [ ] **Step 4: Run** -> PASS.
- [ ] **Step 5: Commit** `feat: ingest event handling`.

### Task 5: Jetstream drain and cron Worker

**Files:**
- Create: `ingest/src/drain.ts`, `ingest/src/index.ts`
- Test: `ingest/src/drain.test.ts`

**Interfaces:**
- Consumes: `applyEvent`, `getCursor`, `setCursor`.
- Produces:
  - `interface SocketLike { addEventListener(type: 'message' | 'close' | 'error', fn: (e: any) => void): void; close(): void }`
  - `drainJetstream(opts: { db: D1Database; connect: (url: string) => SocketLike; endpoint: string; maxMs: number; idleMs: number; nowMs: () => number }): Promise<{ events: number; cursor: number | null; gap: boolean }>`
  - default export `{ scheduled(event, env, ctx) }` in `ingest/src/index.ts`

- [ ] **Step 1: Write failing tests** with a fake socket: connects to `endpoint?wantedCollections=pub.workbench.*&cursor=<saved minus 5_000_000 microseconds>`; processes N queued messages then stops after `idleMs` of silence; stores the highest `time_us` seen; stops at `maxMs` even if events keep coming; with no saved cursor connects without `cursor`; on a socket error before any message returns `gap: true` and does not advance the cursor.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement.** The 5-second rewind is safe because Task 4 is idempotent. `scheduled()` calls `drainJetstream` with `endpoint = wss://jetstream2.us-east.bsky.network/subscribe`, `maxMs = 20000`, `idleMs = 3000`. If the saved cursor is older than Jetstream's replay window and the connection is closed immediately, retry once without a cursor and log `gap`. The builder must verify the endpoint and replay window.
- [ ] **Step 4: Run** -> PASS. Then `wrangler dev --test-scheduled` for `ingest/` and hit `/__scheduled`; expect the cursor row to appear.
- [ ] **Step 5: Commit** `feat: Jetstream drain and cron worker`.

### Task 6: Read API

**Files:**
- Create: `functions/api/[[route]].ts`, `functions/api/read.ts`
- Test: `functions/api/read.test.ts` (workers project)

**Interfaces:**
- Consumes: db read helpers (add to `shared/db.ts`: `listFeed`, `getTopic`, `listTopicProjects`, `getProjectWithUpdates`, `getUpdateWithReplies`, `listProfileProjects`).
- Produces JSON routes, all returning `{ items, cursor }` for lists (cursor is `created_at:uri`):
  - `GET /api/feed?following=<did>&cursor=` (global recent when no `following`)
  - `GET /api/topics`, `GET /api/topics/:slug`
  - `GET /api/projects/:did/:rkey` (project + updates newest first)
  - `GET /api/updates/:did/:rkey` (update + replies)
  - `GET /api/profiles/:did` (profile + projects)

- [ ] **Step 1: Write failing tests**: `/api/feed` returns newest first and paginates with the cursor; hidden rows never appear; **an update whose project row is missing is absent from every response and the route returns 200 (Review Focus 4)**; a project deleted after its updates were indexed returns 404 for the project and no updates in the feed; unknown topic slug returns 404.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement** routes with Hono; join updates to existing, unhidden projects. Profiles are looked up lazily from `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile` and cached in `profiles` for 24 hours.
- [ ] **Step 4: Run** -> PASS.
- [ ] **Step 5: Commit** `feat: read API`.

### Task 7: Link cards and image proxy

**Files:**
- Create: `functions/api/card.ts`, `functions/api/blob.ts`, `shared/ssrf.ts`
- Test: `shared/ssrf.test.ts`, `functions/api/card.test.ts`

**Interfaces:**
- Produces:
  - `isSafeUrl(url: string): boolean` (https/http only; rejects loopback, private, link-local, `.local`, and numeric IPs in those ranges)
  - `fetchCard(url: string, fetchImpl: typeof fetch): Promise<{ url; title?; description?; image?; github?: { name; description; stars; pushedAt } }>`
  - `GET /api/card?url=` and `GET /api/blob/:did/:cid` (resolves the DID's PDS from the DID document, fetches `com.atproto.sync.getBlob`, sets `Cache-Control: public, max-age=31536000, immutable`)

- [ ] **Step 1: Write failing tests**: `isSafeUrl` rejects `http://localhost`, `http://127.0.0.1`, `http://10.0.0.5`, `http://169.254.169.254`, `http://[::1]`, `file:///etc/passwd`; **`fetchCard` follows redirects manually and refuses a 302 from a public URL to `http://169.254.169.254/` (Review Focus 3)**; it aborts after 5 seconds and after 512 KB; a GitHub repo URL returns the `github` block from a stubbed API; the second call for the same URL is served from `link_cache` (no fetch).
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement.** Re-check `isSafeUrl` on every redirect hop (max 3). Parse Open Graph tags with a regex over the first 512 KB; no HTML library. Cache 24 hours in `link_cache`. Blob route returns 404 for unknown DIDs and never follows PDS URLs that fail `isSafeUrl`.
- [ ] **Step 4: Run** -> PASS.
- [ ] **Step 5: Commit** `feat: link cards and blob proxy`.

### Task 8: Admin and reports

**Files:**
- Create: `functions/api/admin.ts`
- Test: `functions/api/admin.test.ts`

**Interfaces:**
- Produces: `POST /api/report {uri, reason}` (public, logs to `reports`, max 500-char reason, one per IP per uri per day); `POST /api/admin/hide {uri}`, `POST /api/admin/block {did}`, `GET /api/admin/reports`, all requiring `Authorization: Bearer <ADMIN_TOKEN>`.

- [ ] **Step 1: Write failing tests**: admin routes return 401 without or with a wrong token; hide makes a project disappear from `/api/feed`; block makes `applyEvent` return `'ignored'` for that DID; `/api/report` stores a row and rejects a 501-char reason.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement** with constant-time token comparison.
- [ ] **Step 4: Run** -> PASS.
- [ ] **Step 5: Commit** `feat: admin hide, block and reports`.

### Task 9: Sign-in

**Files:**
- Create: `public/client-metadata.json`, `src/auth/oauth.ts`, `src/auth/SessionContext.tsx`, `src/pages/SignIn.tsx`
- Test: `src/auth/SessionContext.test.tsx`

**Interfaces:**
- Produces:
  - `signIn(handle: string): Promise<void>`, `restoreSession(): Promise<Session | null>`, `signOut(): Promise<void>`
  - `interface Session { did: string; handle: string; agent: Agent }` (an `@atproto/api` `Agent` bound to the OAuth session)
  - `useSession(): { session: Session | null; loading: boolean }`

- [ ] **Step 1: Write failing tests** with a mocked `oauth` module: `useSession` is `loading` then `null` when no session; returns the session after `restoreSession` resolves; `signOut` clears it.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement** with `BrowserOAuthClient`. Scope: granular scopes for `pub.workbench.*` and blob upload if supported, else `transition:generic`. `client-metadata.json` `client_id` is the production URL; development uses the library's loopback mode. The builder must verify scope support and record it in `README.md`.
- [ ] **Step 4: Run** tests -> PASS. Manually sign in with a real test account on the dev server.
- [ ] **Step 5: Commit** `feat: AT Protocol sign-in`.

### Task 10: Writing records

**Files:**
- Create: `src/records/write.ts`, `src/records/image.ts`
- Test: `src/records/write.test.ts`, `src/records/image.test.ts`

**Interfaces:**
- Consumes: `Session`, `validateRecord`.
- Produces:
  - `createTopic(s: Session, i: { name: string; description: string }): Promise<{ uri: string; slug: string }>`
  - `createProject(s, i: { title; summary; topic: string; status; cover?: File }): Promise<{ uri: string }>`
  - `createUpdate(s, i: { project: string; heading; body; images: { file: File; alt: string }[]; links: { url: string; title?: string }[]; parts?: { item: string; qty: number; note?: string }[] }): Promise<{ uri: string }>`
  - `createReply(s, i: { subject: string; body: string })`, `followSubject(s, kind: 'project' | 'topic', key: string)`, `deleteRecord(s, uri: string)`
  - `resizeImage(file: File, maxEdge = 1600): Promise<Blob>`

- [ ] **Step 1: Write failing tests** with a fake agent: `createUpdate` uploads each image blob then calls `com.atproto.repo.createRecord` with collection `pub.workbench.update` and the blob refs; it throws before any network call if `validateRecord` fails; `createTopic` normalises the slug and rejects `null`; `resizeImage` returns a blob whose longest edge is at most 1600 (jsdom canvas stub); alt text is required for every image.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement.** Writes go to the user's PDS only; nothing posts to our API. Return values feed optimistic UI in Task 11.
- [ ] **Step 4: Run** -> PASS.
- [ ] **Step 5: Commit** `feat: record writing and image resize`.

### Task 11: Pages

**Files:**
- Create: `src/pages/{Home,Topic,Project,Update,Profile,NewProject,NewUpdate}.tsx`, `src/components/{Timeline,LinkCard,Composer,Replies}.tsx`, `src/api.ts`, `src/optimistic.ts`; modify `src/App.tsx` routes
- Test: `src/pages/*.test.tsx`

**Interfaces:**
- Consumes: Task 6 routes, `/api/card`, `/api/blob`, Task 10 writers.
- Routes: `/`, `/t/:slug`, `/p/:did/:rkey`, `/u/:did/:rkey`, `/profile/:did`, `/new`, `/p/:did/:rkey/update`.
- Produces: `api.get<T>(path: string): Promise<T>`; `optimistic.add(item)` / `optimistic.mergeWith(serverItems)` so a just-created post shows at once and is dropped once the server returns it.

- [ ] **Step 1: Write failing tests**: `Project` renders updates newest first as a vertical timeline with heading, date, images (via `/api/blob`), notes and link cards; `Project` shows the author's just-created update before the server has it **(spec: lag invisible to the author)**; `Home` shows the global list when signed out and a Following section when signed in; `Topic` lists projects and has a follow button; a title containing emoji, RTL text and 120 characters renders without overflow or errors; `Update` shows replies and a reply box only when signed in.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement** the pages with plain components and CSS; mobile-first; every image has alt text; keyboard-operable composer.
- [ ] **Step 4: Run** -> PASS; check in a browser at phone and desktop widths.
- [ ] **Step 5: Commit** `feat: pages and timeline UI`.

### Task 12: Seed topics

**Files:**
- Create: `scripts/seed-topics.ts`
- Test: `scripts/seed-topics.test.ts`

**Interfaces:**
- Produces: `SEED_TOPICS: { slug: string; name: string; description: string }[]` (electronics, music-production, ceramics, woodworking, illustration, 3d-printing) and `seed(session: Session): Promise<string[]>` (idempotent: skips slugs that already exist).

- [ ] **Step 1: Write failing test**: every seed slug passes `normalizeSlug` unchanged; `seed` called twice creates six records, not twelve.
- [ ] **Step 2: Run** -> FAIL.
- [ ] **Step 3: Implement** using `createTopic`. Run it once, signed in as the dedicated site account (created on the workbench.pub domain by the owner; the builder asks Craig for the credentials, never stores them in the repo).
- [ ] **Step 4: Run** tests -> PASS.
- [ ] **Step 5: Commit** `feat: seed topics`.

### Task 13: Deploy and verify limits

**Files:**
- Modify: `wrangler.toml`, `ingest/wrangler.toml`, `README.md`

- [ ] **Step 1: Verify free-tier limits** against Cloudflare's current docs for D1 (rows read/written per day), Workers cron frequency and CPU time, and Pages Functions requests. Record the numbers and dates in `README.md`. If the cron cannot run every 5 minutes within the free limits, apply the fallback order from the spec (slower, then a free VM) and stop to tell Craig.
- [ ] **Step 2: Create** the D1 database, apply migrations remotely, set `ADMIN_TOKEN` as a secret on the Pages project.
- [ ] **Step 3: Deploy** the Pages project and the `ingest/` Worker with `wrangler`.
- [ ] **Step 4: Wire** the custom domain `workbench.pub` in Cloudflare and update `client-metadata.json`.
- [ ] **Step 5: Smoke test** on the live site: sign in, create a topic and a project, post an update with a photo and a GitHub link, wait for one cron interval, and confirm it appears for a signed-out visitor. Confirm hide and block work with the admin token.
- [ ] **Step 6: Commit** `chore: deploy configuration and runbook`.

---

## Self-Review

- **Spec coverage:** records (Task 2), architecture (3 to 6), auth (9), link cards (7), topics (2, 4, 12), moderation (4, 8), pages (11), hosting and limits (13), image proxy (7), optimistic UI (11), seeds (12), admin token (8). Notifications and search are out of scope per spec.
- **Types:** `Session`, `JetstreamEvent`, `Collection`, `normalizeSlug` and the db function names are used consistently across tasks.
- **One deliberate departure:** the spec says the earliest record wins a slug; the plan makes **first indexed** win, because `createdAt` is author-supplied and forgeable. Tell Craig.
- **Review Focus:** all five have a named test in the owning task.
