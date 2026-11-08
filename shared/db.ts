import type { FollowRecord, ProjectRecord, ReplyRecord, UpdateRecord } from './types';

/** Where a record lives in the network, plus when we indexed it. */
export interface RecordMeta {
  uri: string;
  did: string;
  rkey: string;
  indexedAt: number;
}

export interface TopicRow {
  slug: string;
  name: string;
  description: string;
  uri: string;
  ownerDid: string;
  indexedAt: number;
}

const HOUR_MS = 3_600_000;

/** Tables whose rows are keyed by record uri and carry a `hidden` flag. */
const CONTENT_TABLES = ['topics', 'projects', 'updates', 'replies', 'follows'] as const;

const json = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(v));

/** First indexed wins: a later record for the same slug (or uri) is ignored. */
export async function upsertTopic(db: D1Database, t: TopicRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO topics (uri, did, rkey, slug, name, description, created_at, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .bind(t.uri, t.ownerDid, t.uri.split('/').pop() ?? '', t.slug, t.name, t.description, new Date(t.indexedAt).toISOString(), t.indexedAt)
    .run();
}

export async function upsertProject(db: D1Database, m: RecordMeta, r: ProjectRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO projects (uri, did, rkey, topic_slug, title, summary, status, cover, created_at, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uri) DO UPDATE SET
         topic_slug = excluded.topic_slug, title = excluded.title, summary = excluded.summary,
         status = excluded.status, cover = excluded.cover, created_at = excluded.created_at`,
    )
    .bind(m.uri, m.did, m.rkey, r.topic, r.title, r.summary, r.status, json(r.cover), r.createdAt, m.indexedAt)
    .run();
}

export async function upsertUpdate(db: D1Database, m: RecordMeta, r: UpdateRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO updates (uri, did, rkey, project_uri, heading, body, images, links, parts, created_at, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uri) DO UPDATE SET
         project_uri = excluded.project_uri, heading = excluded.heading, body = excluded.body,
         images = excluded.images, links = excluded.links, parts = excluded.parts,
         created_at = excluded.created_at`,
    )
    .bind(m.uri, m.did, m.rkey, r.project, r.heading, r.body, json(r.images), json(r.links), json(r.parts), r.createdAt, m.indexedAt)
    .run();
}

export async function upsertReply(db: D1Database, m: RecordMeta, r: ReplyRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO replies (uri, did, rkey, subject_uri, body, created_at, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uri) DO UPDATE SET
         subject_uri = excluded.subject_uri, body = excluded.body,
         created_at = excluded.created_at`,
    )
    .bind(m.uri, m.did, m.rkey, r.subject, r.body, r.createdAt, m.indexedAt)
    .run();
}

export async function upsertFollow(db: D1Database, m: RecordMeta, r: FollowRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO follows (uri, did, rkey, subject_uri, created_at, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(uri) DO UPDATE SET
         subject_uri = excluded.subject_uri, created_at = excluded.created_at,
         indexed_at = excluded.indexed_at`,
    )
    .bind(m.uri, m.did, m.rkey, r.subject, r.createdAt, m.indexedAt)
    .run();
}

/** Removes a record from every content table except `topics`, which is never deleted. */
export async function deleteByUri(db: D1Database, uri: string): Promise<void> {
  await db.batch(
    CONTENT_TABLES.filter((t) => t !== 'topics').map((t) => db.prepare(`DELETE FROM ${t} WHERE uri = ?`).bind(uri)),
  );
}

export async function getCursor(db: D1Database): Promise<number | null> {
  const row = await db.prepare('SELECT time_us FROM cursor WHERE id = 1').first<{ time_us: number }>();
  return row ? row.time_us : null;
}

export async function setCursor(db: D1Database, timeUs: number): Promise<void> {
  await db
    .prepare('INSERT INTO cursor (id, time_us) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET time_us = excluded.time_us')
    .bind(timeUs)
    .run();
}

/**
 * Records the end of an ingest run in ONE query and returns the error streak (consecutive
 * errored runs since the last run that advanced the cursor without error):
 * - advanced, no error: store `timeUs`, reset the streak to 0;
 * - advanced, errored: store `timeUs`, streak + 1;
 * - not advanced, errored: streak + 1 (if no cursor row exists yet, nothing is stored; returns 1).
 * The caller skips the call when the run neither advanced nor errored.
 */
export async function saveRunState(db: D1Database, timeUs: number | null, errored: boolean): Promise<number> {
  if (timeUs === null) {
    const row = await db
      .prepare('UPDATE cursor SET error_streak = error_streak + 1 WHERE id = 1 RETURNING error_streak')
      .first<{ error_streak: number }>();
    return row?.error_streak ?? 1;
  }
  const row = await db
    .prepare(
      `INSERT INTO cursor (id, time_us, error_streak) VALUES (1, ?1, ?2)
       ON CONFLICT(id) DO UPDATE SET time_us = excluded.time_us,
         error_streak = CASE WHEN ?2 = 0 THEN 0 ELSE error_streak + 1 END
       RETURNING error_streak`,
    )
    .bind(timeUs, errored ? 1 : 0)
    .first<{ error_streak: number }>();
  return row?.error_streak ?? (errored ? 1 : 0);
}

export async function isBlocked(db: D1Database, did: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS x FROM blocked_dids WHERE did = ?').bind(did).first();
  return row !== null;
}

/**
 * Blocks future ingest from `did` and hides everything it already has indexed (topics it owns,
 * projects, updates, replies, follows), in one db.batch (one D1 query). Idempotent; upserts never
 * touch `hidden`, so a later re-ingest of the same records stays hidden.
 */
export async function blockDid(db: D1Database, did: string): Promise<void> {
  await db.batch([
    db.prepare('INSERT INTO blocked_dids (did, blocked_at) VALUES (?, ?) ON CONFLICT(did) DO NOTHING').bind(did, Date.now()),
    ...CONTENT_TABLES.map((t) => db.prepare(`UPDATE ${t} SET hidden = 1 WHERE did = ? AND hidden = 0`).bind(did)),
  ]);
}

/** Marks the record hidden in whichever content table holds it. */
export async function hideUri(db: D1Database, uri: string): Promise<void> {
  await db.batch(CONTENT_TABLES.map((t) => db.prepare(`UPDATE ${t} SET hidden = 1 WHERE uri = ?`).bind(uri)));
}

export interface ReportRow {
  id: number;
  subjectUri: string;
  reason: string;
  createdAt: number;
}

/** Reports accepted per ip_hash per rolling 24h, across all uris. */
export const REPORTS_PER_IP_PER_DAY = 20;
/** Hard ceiling on total rows in `reports`. */
export const REPORTS_MAX_ROWS = 5000;
/** Reports older than this are pruned on insert. */
export const REPORTS_RETENTION_MS = 30 * 24 * 3_600_000;
const REPORTS_PRUNE_BATCH = 50;

export type ReportOutcome = 'stored' | 'duplicate' | 'ip_cap' | 'full';

/** Deletes up to REPORTS_PRUNE_BATCH reports older than the retention window. */
export async function pruneOldReports(db: D1Database, nowMs: number): Promise<void> {
  await db
    .prepare('DELETE FROM reports WHERE id IN (SELECT id FROM reports WHERE created_at < ? LIMIT ?)')
    .bind(nowMs - REPORTS_RETENTION_MS, REPORTS_PRUNE_BATCH)
    .run();
}

/**
 * Prunes a few expired rows, then inserts a report in one atomic statement unless
 * the ip already reported `uri` within `sinceMs`, the ip is at its daily cap, or the
 * table is at its ceiling. The refusal reason is diagnosed only on the failure path.
 */
export async function insertReport(
  db: D1Database,
  r: { uri: string; reason: string; ipHash: string; nowMs: number; sinceMs: number },
): Promise<ReportOutcome> {
  await pruneOldReports(db, r.nowMs);
  const res = await db
    .prepare(
      `INSERT INTO reports (subject_uri, reason, ip_hash, created_at)
       SELECT ?1, ?2, ?3, ?4
       WHERE NOT EXISTS (SELECT 1 FROM reports WHERE ip_hash = ?3 AND subject_uri = ?1 AND created_at >= ?5)
         AND (SELECT COUNT(*) FROM reports WHERE ip_hash = ?3 AND created_at >= ?5) < ?6
         AND (SELECT COUNT(*) FROM reports) < ?7`,
    )
    .bind(r.uri, r.reason, r.ipHash, r.nowMs, r.sinceMs, REPORTS_PER_IP_PER_DAY, REPORTS_MAX_ROWS)
    .run();
  if (res.meta.changes > 0) return 'stored';
  const dup = await db
    .prepare('SELECT 1 AS x FROM reports WHERE ip_hash = ? AND subject_uri = ? AND created_at >= ?')
    .bind(r.ipHash, r.uri, r.sinceMs)
    .first();
  if (dup) return 'duplicate';
  const mine = await db
    .prepare('SELECT COUNT(*) AS n FROM reports WHERE ip_hash = ? AND created_at >= ?')
    .bind(r.ipHash, r.sinceMs)
    .first<{ n: number }>();
  return (mine?.n ?? 0) >= REPORTS_PER_IP_PER_DAY ? 'ip_cap' : 'full';
}

/** Newest reports first. The reporter's ip_hash is deliberately not returned. */
export async function listReports(db: D1Database, limit: number): Promise<ReportRow[]> {
  const { results } = await db
    .prepare('SELECT id, subject_uri, reason, created_at FROM reports ORDER BY created_at DESC, id DESC LIMIT ?')
    .bind(limit)
    .all<Record<string, unknown>>();
  return results.map((r) => ({
    id: r.id as number,
    subjectUri: r.subject_uri as string,
    reason: r.reason as string,
    createdAt: r.created_at as number,
  }));
}

/**
 * Counts one event for `did` in the hour containing `nowMs`; true while within `cap`. Also used
 * with a `card:<ip hash>` key for the link-card per-IP cap.
 */
export async function bumpAndCheckRate(db: D1Database, did: string, nowMs: number, cap: number): Promise<boolean> {
  const hour = Math.floor(nowMs / HOUR_MS);
  const row = await db
    .prepare(
      `INSERT INTO ingest_counts (did, hour, count) VALUES (?, ?, 1)
       ON CONFLICT(did, hour) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(did, hour)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= cap;
}

/** Hourly counters (ingest rate cap, link-card IP cap) are kept this many hours. */
export const INGEST_COUNTS_RETENTION_HOURS = 48;
const INGEST_COUNTS_PRUNE_BATCH = 50;

/** Deletes up to 50 counter rows older than the retention window: one bounded query. */
export async function pruneIngestCounts(db: D1Database, nowMs: number): Promise<void> {
  await db
    .prepare('DELETE FROM ingest_counts WHERE rowid IN (SELECT rowid FROM ingest_counts WHERE hour < ? LIMIT ?)')
    .bind(Math.floor(nowMs / HOUR_MS) - INGEST_COUNTS_RETENTION_HOURS, INGEST_COUNTS_PRUNE_BATCH)
    .run();
}

// Edits (re-upserts) of projects, updates and replies keep the ORIGINAL indexed_at, so an edited
// old item does not jump to the top of lists and spam cannot stay on top by re-editing.

// ---- Read side ---------------------------------------------------------------
// Lists are ordered by `indexed_at` (server-assigned) then `uri`; `created_at` is
// client-supplied and spoofable, so it is returned for display only. Updates are
// only ever returned joined to an existing, unhidden project.

/** Keyset position: rows strictly after (indexedAt, uri) in descending order. */
export interface ListCursor {
  indexedAt: number;
  uri: string;
}

export const encodeCursor = (c: ListCursor): string => `${c.indexedAt}:${c.uri}`;

export function decodeCursor(s: string): ListCursor | null {
  const i = s.indexOf(':');
  const indexedAt = Number(s.slice(0, i));
  const uri = s.slice(i + 1);
  return i > 0 && Number.isSafeInteger(indexedAt) && uri.startsWith('at://') ? { indexedAt, uri } : null;
}

const parseJson = (s: string | null): unknown => (s === null ? undefined : JSON.parse(s));

export interface UpdateView {
  uri: string;
  did: string;
  rkey: string;
  projectUri: string;
  heading: string;
  body: string;
  images?: unknown;
  links?: unknown;
  parts?: unknown;
  createdAt: string;
  indexedAt: number;
}

export interface FeedItem extends UpdateView {
  project: { uri: string; did: string; rkey: string; title: string; topicSlug: string };
}

export interface ProjectView {
  uri: string;
  did: string;
  rkey: string;
  topicSlug: string;
  title: string;
  summary: string;
  status: string;
  cover?: unknown;
  createdAt: string;
  indexedAt: number;
}

export interface ReplyView {
  uri: string;
  did: string;
  rkey: string;
  subjectUri: string;
  body: string;
  createdAt: string;
  indexedAt: number;
}

export interface Page<T> {
  items: T[];
  cursor: string | null;
}

type Row = Record<string, unknown>;

const toUpdate = (r: Row): UpdateView => ({
  uri: r.uri as string,
  did: r.did as string,
  rkey: r.rkey as string,
  projectUri: r.project_uri as string,
  heading: r.heading as string,
  body: r.body as string,
  images: parseJson(r.images as string | null),
  links: parseJson(r.links as string | null),
  parts: parseJson(r.parts as string | null),
  createdAt: r.created_at as string,
  indexedAt: r.indexed_at as number,
});

const toProject = (r: Row): ProjectView => ({
  uri: r.uri as string,
  did: r.did as string,
  rkey: r.rkey as string,
  topicSlug: r.topic_slug as string,
  title: r.title as string,
  summary: r.summary as string,
  status: r.status as string,
  cover: parseJson(r.cover as string | null),
  createdAt: r.created_at as string,
  indexedAt: r.indexed_at as number,
});

const toReply = (r: Row): ReplyView => ({
  uri: r.uri as string,
  did: r.did as string,
  rkey: r.rkey as string,
  subjectUri: r.subject_uri as string,
  body: r.body as string,
  createdAt: r.created_at as string,
  indexedAt: r.indexed_at as number,
});

/** Trims the extra probe row and builds the next cursor from the last kept item. */
function paginate<T extends { indexedAt: number; uri: string }>(rows: T[], limit: number): Page<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, cursor: rows.length > limit && last ? encodeCursor(last) : null };
}

/** Max update-index rows examined per feed request. */
export const FEED_SCAN_WINDOW = 200;
/** Rows scanned per requested item, so small pages read few rows. */
export const FEED_SCAN_MULTIPLIER = 3;

/** Update-index rows one feed request examines: min(FEED_SCAN_WINDOW, limit * FEED_SCAN_MULTIPLIER). */
export const feedScanWindow = (limit: number): number => Math.min(FEED_SCAN_WINDOW, Math.max(1, limit) * FEED_SCAN_MULTIPLIER);

/**
 * Global recent updates, or (with `followingDid`) those of followed projects and topics.
 *
 * Rows read per request are bounded: at most feedScanWindow(limit) rows of the partial
 * update index are examined (keyset seek), each joined to its project by primary key.
 * Rows whose project is missing, hidden or not followed are skipped, so a page may
 * hold fewer than `limit` items; the cursor then points at the last row *scanned*
 * and the client simply continues.
 */
export async function listFeed(
  db: D1Database,
  opts: { followingDid?: string; cursor?: ListCursor; limit: number },
): Promise<Page<FeedItem>> {
  const seek = opts.cursor ? 'AND (indexed_at, uri) < (?, ?)' : '';
  const scanRows = feedScanWindow(opts.limit);
  const followed = opts.followingDid
    ? `AND (p.uri IN (SELECT subject_uri FROM follows WHERE did = ? AND hidden = 0)
        OR p.topic_slug IN (SELECT t.slug FROM follows f JOIN topics t ON t.slug = f.subject_uri
                            WHERE f.did = ? AND f.hidden = 0 AND t.hidden = 0))`
    : '';
  // Placeholder order in the SQL: follow filter (SELECT list) first, then the seek.
  const binds: unknown[] = [
    ...(opts.followingDid ? [opts.followingDid, opts.followingDid] : []),
    ...(opts.cursor ? [opts.cursor.indexedAt, opts.cursor.uri] : []),
  ];
  // Outer LEFT JOIN so the JS side sees every scanned row (needed for the cursor).
  const { results } = await db
    .prepare(
      `SELECT w.*, p.did AS p_did, p.rkey AS p_rkey, p.title AS p_title, p.topic_slug AS p_topic,
              (p.uri IS NOT NULL AND p.hidden = 0 AND p.did = w.did ${followed}) AS visible
       FROM (SELECT * FROM updates WHERE hidden = 0 ${seek}
             ORDER BY indexed_at DESC, uri DESC LIMIT ${scanRows}) w
       LEFT JOIN projects p ON p.uri = w.project_uri
       ORDER BY w.indexed_at DESC, w.uri DESC`,
    )
    .bind(...binds)
    .all<Row>();
  const visible = results.filter((r) => r.visible === 1);
  const items = visible.slice(0, opts.limit).map(
    (r): FeedItem => ({
      ...toUpdate(r),
      project: {
        uri: r.project_uri as string,
        did: r.p_did as string,
        rkey: r.p_rkey as string,
        title: r.p_title as string,
        topicSlug: r.p_topic as string,
      },
    }),
  );
  if (visible.length > opts.limit) return { items, cursor: encodeCursor(items[items.length - 1]) };
  const lastScanned = results[results.length - 1];
  const cursor =
    results.length === scanRows
      ? encodeCursor({ indexedAt: lastScanned.indexed_at as number, uri: lastScanned.uri as string })
      : null;
  return { items, cursor };
}

/** Topics in slug order; the cursor is the last slug returned. */
export async function listTopics(db: D1Database, afterSlug: string | undefined, limit: number): Promise<Page<TopicRow>> {
  const { results } = await db
    .prepare('SELECT * FROM topics WHERE hidden = 0 AND slug > ? ORDER BY slug LIMIT ?')
    .bind(afterSlug ?? '', limit + 1)
    .all<Row>();
  const items = results.slice(0, limit).map(toTopic);
  return { items, cursor: results.length > limit ? items[items.length - 1].slug : null };
}

const toTopic = (r: Row): TopicRow => ({
  slug: r.slug as string,
  name: r.name as string,
  description: r.description as string,
  uri: r.uri as string,
  ownerDid: r.did as string,
  indexedAt: r.indexed_at as number,
});

export async function getTopic(db: D1Database, slug: string): Promise<TopicRow | null> {
  const r = await db.prepare('SELECT * FROM topics WHERE slug = ? AND hidden = 0').bind(slug).first<Row>();
  return r ? toTopic(r) : null;
}

async function listProjects(
  db: D1Database,
  column: 'topic_slug' | 'did',
  value: string,
  cursor: ListCursor | undefined,
  limit: number,
): Promise<Page<ProjectView>> {
  const seek = cursor ? 'AND (indexed_at, uri) < (?, ?)' : '';
  const { results } = await db
    .prepare(
      `SELECT * FROM projects WHERE ${column} = ? AND hidden = 0 ${seek}
       ORDER BY indexed_at DESC, uri DESC LIMIT ?`,
    )
    .bind(...(cursor ? [value, cursor.indexedAt, cursor.uri, limit + 1] : [value, limit + 1]))
    .all<Row>();
  return paginate(results.map(toProject), limit);
}

export const listTopicProjects = (db: D1Database, slug: string, cursor: ListCursor | undefined, limit: number) =>
  listProjects(db, 'topic_slug', slug, cursor, limit);

export const listProfileProjects = (db: D1Database, did: string, cursor: ListCursor | undefined, limit: number) =>
  listProjects(db, 'did', did, cursor, limit);

/**
 * The project plus one page of its visible updates, newest first (keyset on indexed_at, uri);
 * null when the project is missing or hidden. The project row is returned on every page.
 */
export async function getProjectWithUpdates(
  db: D1Database,
  uri: string,
  cursor?: ListCursor,
  limit = 50,
): Promise<{ project: ProjectView & { updateCount: number }; updates: UpdateView[]; cursor: string | null } | null> {
  const p = await db.prepare('SELECT * FROM projects WHERE uri = ? AND hidden = 0').bind(uri).first<Row>();
  if (!p) return null;
  // Total visible updates by the project's author (same filter as the list), so the client can
  // number entries across pages. `+did` keeps the planner on idx_updates_project_visible.
  const counted = await db
    .prepare('SELECT COUNT(*) AS n FROM updates WHERE project_uri = ? AND hidden = 0 AND +did = ?')
    .bind(uri, p.did)
    .first<{ n: number }>();
  const seek = cursor ? 'AND (indexed_at, uri) < (?, ?)' : '';
  const { results } = await db
    .prepare(
      `SELECT * FROM updates WHERE project_uri = ? AND hidden = 0 AND did = ? ${seek}
       ORDER BY indexed_at DESC, uri DESC LIMIT ?`,
    )
    .bind(...(cursor ? [uri, p.did, cursor.indexedAt, cursor.uri, limit + 1] : [uri, p.did, limit + 1]))
    .all<Row>();
  const page = paginate(results.map(toUpdate), limit);
  return { project: { ...toProject(p), updateCount: counted?.n ?? 0 }, updates: page.items, cursor: page.cursor };
}

/**
 * The update plus the visible replies beneath it (direct and nested), oldest first;
 * null when the update is missing, hidden, or its project is missing or hidden.
 */
export async function getUpdateWithReplies(
  db: D1Database,
  uri: string,
): Promise<{ update: FeedItem; replies: ReplyView[] } | null> {
  const r = await db
    .prepare(
      `SELECT u.*, p.did AS p_did, p.rkey AS p_rkey, p.title AS p_title, p.topic_slug AS p_topic
       FROM updates u JOIN projects p ON p.uri = u.project_uri
       WHERE u.uri = ? AND u.hidden = 0 AND p.hidden = 0 AND u.did = p.did`,
    )
    .bind(uri)
    .first<Row>();
  if (!r) return null;
  const { results } = await db
    .prepare(
      `WITH RECURSIVE thread(uri) AS (
         SELECT uri FROM replies WHERE subject_uri = ?1 AND hidden = 0
         UNION
         SELECT c.uri FROM replies c JOIN thread t ON c.subject_uri = t.uri WHERE c.hidden = 0
       )
       SELECT * FROM replies WHERE uri IN (SELECT uri FROM thread)
       ORDER BY created_at, uri`,
    )
    .bind(uri)
    .all<Row>();
  return {
    update: {
      ...toUpdate(r),
      project: {
        uri: r.project_uri as string,
        did: r.p_did as string,
        rkey: r.p_rkey as string,
        title: r.p_title as string,
        topicSlug: r.p_topic as string,
      },
    },
    replies: results.map(toReply),
  };
}

/** True when `did` authored a visible indexed update or reply (projects are checked by the caller's list). */
export async function hasIndexedUpdateOrReply(db: D1Database, did: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT EXISTS(SELECT 1 FROM updates WHERE did = ?1 AND hidden = 0)
           OR EXISTS(SELECT 1 FROM replies WHERE did = ?1 AND hidden = 0) AS known`,
    )
    .bind(did)
    .first<{ known: number }>();
  return row?.known === 1;
}

export interface ProfileRow {
  did: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
  fetchedAt: number;
}

export async function getCachedProfile(db: D1Database, did: string): Promise<ProfileRow | null> {
  const r = await db.prepare('SELECT * FROM profiles WHERE did = ?').bind(did).first<Row>();
  if (!r) return null;
  return {
    did,
    handle: (r.handle as string | null) ?? undefined,
    displayName: (r.display_name as string | null) ?? undefined,
    avatar: (r.avatar as string | null) ?? undefined,
    fetchedAt: r.fetched_at as number,
  };
}

export async function putProfile(db: D1Database, p: ProfileRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO profiles (did, handle, display_name, avatar, fetched_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(did) DO UPDATE SET handle = excluded.handle, display_name = excluded.display_name,
         avatar = excluded.avatar, fetched_at = excluded.fetched_at`,
    )
    .bind(p.did, p.handle ?? null, p.displayName ?? null, p.avatar ?? null, p.fetchedAt)
    .run();
}
