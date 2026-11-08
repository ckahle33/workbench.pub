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
