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
         status = excluded.status, cover = excluded.cover, created_at = excluded.created_at,
         indexed_at = excluded.indexed_at`,
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
         created_at = excluded.created_at, indexed_at = excluded.indexed_at`,
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
         created_at = excluded.created_at, indexed_at = excluded.indexed_at`,
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

export async function isBlocked(db: D1Database, did: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS x FROM blocked_dids WHERE did = ?').bind(did).first();
  return row !== null;
}

export async function blockDid(db: D1Database, did: string): Promise<void> {
  await db
    .prepare('INSERT INTO blocked_dids (did, blocked_at) VALUES (?, ?) ON CONFLICT(did) DO NOTHING')
    .bind(did, Date.now())
    .run();
}

/** Marks the record hidden in whichever content table holds it. */
export async function hideUri(db: D1Database, uri: string): Promise<void> {
  await db.batch(CONTENT_TABLES.map((t) => db.prepare(`UPDATE ${t} SET hidden = 1 WHERE uri = ?`).bind(uri)));
}

/** Counts one ingest for `did` in the hour containing `nowMs`; true while within `cap`. */
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

/** Global recent updates, or (with `followingDid`) those of followed projects and topics. */
export async function listFeed(
  db: D1Database,
  opts: { followingDid?: string; cursor?: ListCursor; limit: number },
): Promise<Page<FeedItem>> {
  const where = ['u.hidden = 0', 'p.hidden = 0'];
  const binds: unknown[] = [];
  if (opts.followingDid) {
    where.push(
      `(p.uri IN (SELECT subject_uri FROM follows WHERE did = ? AND hidden = 0)
        OR p.topic_slug IN (SELECT t.slug FROM follows f JOIN topics t ON t.uri = f.subject_uri
                            WHERE f.did = ? AND f.hidden = 0 AND t.hidden = 0))`,
    );
    binds.push(opts.followingDid, opts.followingDid);
  }
  if (opts.cursor) {
    where.push('(u.indexed_at < ? OR (u.indexed_at = ? AND u.uri < ?))');
    binds.push(opts.cursor.indexedAt, opts.cursor.indexedAt, opts.cursor.uri);
  }
  const { results } = await db
    .prepare(
      `SELECT u.*, p.did AS p_did, p.rkey AS p_rkey, p.title AS p_title, p.topic_slug AS p_topic
       FROM updates u JOIN projects p ON p.uri = u.project_uri
       WHERE ${where.join(' AND ')}
       ORDER BY u.indexed_at DESC, u.uri DESC LIMIT ?`,
    )
    .bind(...binds, opts.limit + 1)
    .all<Row>();
  const rows = results.map(
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
  return paginate(rows, opts.limit);
}

export async function listTopics(db: D1Database): Promise<TopicRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM topics WHERE hidden = 0 ORDER BY name COLLATE NOCASE, slug')
    .all<Row>();
  return results.map(toTopic);
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
  const { results } = await db
    .prepare(
      `SELECT * FROM projects
       WHERE ${column} = ?1 AND hidden = 0
         AND (?2 IS NULL OR indexed_at < ?2 OR (indexed_at = ?2 AND uri < ?3))
       ORDER BY indexed_at DESC, uri DESC LIMIT ?4`,
    )
    .bind(value, cursor?.indexedAt ?? null, cursor?.uri ?? '', limit + 1)
    .all<Row>();
  return paginate(results.map(toProject), limit);
}

export const listTopicProjects = (db: D1Database, slug: string, cursor: ListCursor | undefined, limit: number) =>
  listProjects(db, 'topic_slug', slug, cursor, limit);

export const listProfileProjects = (db: D1Database, did: string, cursor: ListCursor | undefined, limit: number) =>
  listProjects(db, 'did', did, cursor, limit);

/** The project plus its visible updates, newest first; null when missing or hidden. */
export async function getProjectWithUpdates(
  db: D1Database,
  uri: string,
  updateLimit = 200,
): Promise<{ project: ProjectView; updates: UpdateView[] } | null> {
  const p = await db.prepare('SELECT * FROM projects WHERE uri = ? AND hidden = 0').bind(uri).first<Row>();
  if (!p) return null;
  const { results } = await db
    .prepare(
      `SELECT * FROM updates WHERE project_uri = ? AND hidden = 0
       ORDER BY indexed_at DESC, uri DESC LIMIT ?`,
    )
    .bind(uri, updateLimit)
    .all<Row>();
  return { project: toProject(p), updates: results.map(toUpdate) };
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
       WHERE u.uri = ? AND u.hidden = 0 AND p.hidden = 0`,
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
