# workbench.pub design

Status: draft for approval. Date: 2026-11-07. Owner: Craig.

## Intent

workbench.pub is a social site for makers who show a thing as it gets made:
electronics and pedal building, music recording, crafts, art. The unit of
content is a **project**: a titled thing someone is making, with a timeline of
**updates** (photos, notes, links, parts, demos). People follow projects and
reply to specific updates.

Why: photo-sharing sites already cover "here is a finished thing". Nothing
covers "here is how it is going", with the half-built pedal, the breadboard,
the rough take. Building on AT Protocol means every project, update and reply
lives in the author's own account (their PDS), so people own their work and
can sign in with an existing Bluesky/AT identity. The site is an index and a
viewer on top of that data.

The idea started as a social version of the wikicircles hobby wikis
(~/src/wikicircles, a MediaWiki farm with one subdomain per hobby). It
narrowed to makers and process, and to a single app instead of per-hobby sites.

## Goals

- A maker can sign in with an AT account, create a project, and post updates
  over days or weeks, each with photos and notes and optional links.
- Anyone can read projects without signing in.
- People can follow projects and topics, and reply to individual updates.
- A **topic** is a maker discipline (electronics, music production, ceramics,
  woodworking, textiles, illustration, 3D printing). Anyone can create one.
- Runs entirely on free tiers. Real recurring cost is the domain only
  (workbench.pub, about $30/year first year; renewal price not confirmed).
- All user content is stored as AT Protocol records in the author's own repo
  under the `pub.workbench.*` namespace. We store only an index.

## Non-goals

- Not a general hobby network. Mountain biking and photography are welcome only
  as build logs (a bike build, a photo series with process), not as the pitch.
- No direct messages, no live/real-time features, no video hosting of our own,
  no payments, no marketplace.
- No custom per-service integrations (RideWithGPS, Strava and similar are out).
- No moderation team or reputation system in v1.

## Anti-goals (failure even if it works)

- Posting feels like filling in a form: friction beats the "just show your
  work" feel.
- The site ends up holding user media or data that users cannot take with them.
- Costs appear unexpectedly (a free-tier limit hit silently turns into a bill).

## Constraints

- Hosting: Cloudflare free tier (Pages, Workers, D1). No VM.
- Index lag: aim for about one minute, but **cost outranks lag** (decided by
  Craig). If the free tier cannot run a one-minute ingest, relax the lag to
  5 to 15 minutes. If that still does not fit, move ingest to a free VM. Do
  not pay for anything in the early stages.
- Language and tooling: TypeScript throughout.
- Craig's call on frontend: **React** (Vite + React Router), not SvelteKit.
- Moderation: **open posting** for now (decided by Craig). Fix spam later.

## Decisions (by Craig)

1. One app at workbench.pub; topics are communities inside it, not
   subdomains.
2. Anyone can create a topic.
3. Content type is a project with a vertical timeline of updates, newest on
   top (chosen from three mockups).
4. Frontend is React.
5. Link cards for GitHub and similar, not RideWithGPS.
6. Ingest lag of a minute is fine, and slower (5 to 15 minutes) is fine too
   if that is what keeps it free. Reducing early-stage cost matters more than
   freshness.
7. Open posting; revisit moderation if spam appears.
8. Name is workbench.pub, record namespace `pub.workbench`.
9. The community unit is called a **topic** (not "circle"), chosen for
   clarity.
10. Design principle: **easy to reason about.** Prefer the plainest model
    that works: few record types, one obvious way to do each thing, plain
    names, no clever indirection. Where a choice is between simple and
    flexible, pick simple. The builder should be able to explain the whole
    data flow (PDS to Jetstream to D1 to page) in a minute.

## Design

### Records (AT Protocol lexicons, namespace `pub.workbench`)

All records live in the author's repo. Names and fields below are the intended
shape; the builder finalises the lexicon JSON.

- `pub.workbench.topic`: `name`, `slug`, `description`, `createdAt`. First
  claimant of a slug is canonical (see "Topics").
- `pub.workbench.project`: `title`, `summary`, `topic` (slug),
  `status` (`in-progress` | `finished` | `paused`), `cover` (blob, optional),
  `createdAt`.
- `pub.workbench.update`: `project` (at-uri), `heading`, `body` (text),
  `images` (blobs, up to a small cap, with alt text), `links` (url + optional
  title), `parts` (optional list of item/quantity/note), `createdAt`.
- `pub.workbench.reply`: `subject` (at-uri of an update or another reply),
  `body`, `createdAt`.
- `pub.workbench.follow`: `subject` (at-uri of a project or topic),
  `createdAt`.
- `pub.workbench.defs`: shared types (link, part, image).

### Architecture

```
Browser (React SPA) --OAuth--> user's PDS (writes records, uploads blobs)
        |
        v
Cloudflare Pages: static React app + Pages Functions (Hono API)
        |  reads
        v
D1 (index of projects/updates/replies/follows/topics + ingest cursor)
        ^  writes
Cron Worker (every minute): connect to Jetstream with saved cursor,
drain events for `pub.workbench.*`, upsert/delete into D1, save cursor,
disconnect.
```

- Reads go to D1. Writes go straight to the author's PDS from the signed-in
  client; they appear in the index when the cron Worker next ingests them.
  The UI should show the author's own new post immediately (optimistic) so the
  lag is invisible to them.
- Edits and deletes arrive as Jetstream update/delete events and are applied
  the same way. The ingest must be idempotent (replaying from an earlier
  cursor must not duplicate rows).
- Cursor safety: if the cron Worker is late, Jetstream replay from the cursor
  covers the gap. The builder must handle the case where the saved cursor is
  older than Jetstream's replay window (fall back to a recent cursor and log a
  gap).

### Auth

AT Protocol OAuth from the browser (public client, with a
`client-metadata.json` served over HTTPS at the production origin). Users sign
in with a handle; the app asks for permission to read and write `pub.workbench.*`
records and upload blobs. No passwords and no user table beyond a cached
profile (handle, display name, avatar) for display.

### Link cards

Pasting a URL in an update shows a card. A Pages Function fetches the page,
reads Open Graph tags (title, description, image), and caches the result in D1
with an expiry. GitHub repository URLs get a small special case: repo name,
description, and latest activity from the public GitHub API, cached. All
fetching must be server-side, time-limited, size-limited, and must refuse
private/internal addresses (SSRF protection).

### Topics

A topic page lists recent projects and updates tagged to it, with a follow
button. Creating a topic writes a `pub.workbench.topic` record. Slug
collisions: the earliest record wins as canonical; later duplicates are
shown but marked as aliases candidates. Merging and aliasing are later work.
Seed roughly six topics at launch (electronics, music production, ceramics,
woodworking, illustration, 3D printing) so the site is not empty.

### Moderation (v1)

Open posting. The index has a small admin capability (protected by Craig's own
AT identity or an admin token): hide a post, and block an account from
indexing. No reports UI beyond a "report" link that emails or logs. Revisit
if spam appears.

### Pages

Home feed (updates from followed projects and topics; a global recent list
when signed out), topic page, project page (vertical timeline, newest first),
update permalink with replies, profile page (a person's projects), new
project / new update composer, sign-in.

## Hosting and cost

- Cloudflare Pages (static site + Functions), D1, one cron Worker.
- Free-tier limits (D1 reads/writes per day, Workers requests, cron
  subrequests, Jetstream connect duration) have **not been verified** and must
  be checked before the build commits to them.
- Domain: workbench.pub, **purchased by Craig** (about $30/year). The
  `pub.workbench` namespace is therefore safe to use. Add the domain to
  Cloudflare (nameservers or registrar) before wiring the Pages custom domain
  and the OAuth client metadata origin.

## Unverified assumptions (builder must check)

- Public Jetstream endpoints stay available and support cursor replay long
  enough for a one-minute cron to catch up.
- A cron Worker can connect, drain, and disconnect within free-tier time
  limits at expected volume.
- Cloudflare Pages Functions vs. Workers with static assets: use whichever is
  currently recommended for a new project with D1.
- Lexicon publication: record schemas can be published for resolution (a DNS
  TXT record on the `workbench.pub` domain) but resolution tooling is still
  evolving; do not make the app depend on it in v1.

## Claude's calls (not yet confirmed by Craig)

These were settled by Claude during review. Craig should check them.

- **Topic references:** `project.topic` and `follow.subject` for topics use
  the **slug** (a string), not an at-uri. The index resolves a slug to its
  canonical topic record. Projects attach to a slug, so a duplicate record
  never splits a topic.
- **Topic deletion:** the index keeps a topic row even if the canonical
  record is deleted, so projects are not re-pointed. Deleting your topic
  record does not delete the topic from the index.
- **Seed topics:** owned by a dedicated site account, not Craig's personal
  one (handle on the workbench.pub domain once it is owned).
- **Ingest validation:** validate every record against its lexicon, cap field
  and image sizes, apply a per-DID write cap per hour, and drop anything over.
  The cap exists to protect the D1 write quota from spam.
- **Images:** served from the author's PDS blob endpoint (resolve DID to PDS,
  fetch via `com.atproto.sync.getBlob`), cached at the Cloudflare edge. Resize
  client-side before upload. No images stored by the site.
- **OAuth scopes:** request granular scopes for `pub.workbench.*` and blob
  upload if the current OAuth implementation supports them; fall back to
  `transition:generic` only if it does not. Builder to verify.
- **Follows and feed:** follows are indexed from Jetstream like everything
  else (same lag). Feed is reverse-chronological with cursor pagination.
- **Admin:** a bearer token held as a Cloudflare secret, not an AT identity.
  A "report" button writes a row to a D1 `reports` table that the admin views.
  No email service.

## Left to the builder

- Exact lexicon JSON and validation.
- D1 schema, indexes, and query shapes for feeds.
- Image handling: upload size limits, resizing client-side before upload,
  alt-text prompt.
- Frontend component structure, styling, accessibility, mobile layout.
- Test strategy, local dev setup (wrangler), CI.
- Rate-limiting the Functions API and link fetcher.

## Out of scope for the first build

Notifications, search beyond topic/title filtering, moderation tooling beyond
the hide/block switch, per-topic moderators, topic merging, custom domains
per topic, video, payments.
