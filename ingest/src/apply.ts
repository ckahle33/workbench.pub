import {
  bumpAndCheckRate,
  deleteByUri,
  isBlocked,
  upsertFollow,
  upsertProject,
  upsertReply,
  upsertTopic,
  upsertUpdate,
} from '../../shared/db';
import { normalizeSlug, validateRecord, type Collection } from '../../shared/lexicons';

export interface JetstreamEvent {
  did: string;
  time_us: number;
  kind: 'commit' | 'identity' | 'account';
  commit?: {
    operation: 'create' | 'update' | 'delete';
    collection: string;
    rkey: string;
    cid?: string;
    record?: unknown;
  };
}

export const HOURLY_WRITE_CAP = 200;

const COLLECTIONS: readonly string[] = [
  'pub.workbench.topic',
  'pub.workbench.project',
  'pub.workbench.update',
  'pub.workbench.reply',
  'pub.workbench.follow',
] satisfies Collection[];

/** 'rejected' is a bad or hostile record; 'error' is a D1 failure, so the caller must not move past the event. */
export type ApplyOutcome = 'applied' | 'ignored' | 'rejected' | 'error';

export async function applyEvent(
  db: D1Database,
  ev: JetstreamEvent,
  nowMs: number,
): Promise<ApplyOutcome> {
  try {
    const c = ev.kind === 'commit' ? ev.commit : undefined;
    if (!c || !COLLECTIONS.includes(c.collection)) return 'ignored';
    if (await isBlocked(db, ev.did)) return 'ignored';
    if (!(await bumpAndCheckRate(db, ev.did, nowMs, HOURLY_WRITE_CAP))) return 'rejected';

    const uri = `at://${ev.did}/${c.collection}/${c.rkey}`;
    if (c.operation === 'delete') {
      await deleteByUri(db, uri);
      return 'applied';
    }

    const collection = c.collection as Collection;
    const meta = { uri, did: ev.did, rkey: c.rkey, indexedAt: nowMs };
    // Validation is pure; if it throws on a hostile record, that is the record's fault, not D1's.
    let v: ReturnType<typeof validateRecord>;
    try {
      let record = c.record;
      if (collection === 'pub.workbench.topic' && typeof record === 'object' && record !== null) {
        // The validator wants a canonical slug; fold case/whitespace variants onto it first.
        const raw = (record as { slug?: unknown }).slug;
        if (typeof raw === 'string') {
          const slug = normalizeSlug(raw);
          if (slug === null) return 'rejected';
          record = { ...record, slug };
        }
      }
      v = validateRecord(collection, record);
    } catch {
      return 'rejected';
    }
    if (!v.ok) return 'rejected';

    switch (collection) {
      case 'pub.workbench.topic': {
        const r = v.value as import('../../shared/types').TopicRecord;
        await upsertTopic(db, { slug: r.slug, name: r.name, description: r.description, uri, ownerDid: ev.did, indexedAt: nowMs });
        break;
      }
      case 'pub.workbench.project':
        await upsertProject(db, meta, v.value as import('../../shared/types').ProjectRecord);
        break;
      case 'pub.workbench.update': {
        // An update belongs to its project's owner: the project at-uri's repo must be the writer.
        const projectDid = (v.value as import('../../shared/types').UpdateRecord).project.split('/')[2];
        if (projectDid !== ev.did) return 'rejected';
        await upsertUpdate(db, meta, v.value as import('../../shared/types').UpdateRecord);
        break;
      }
      case 'pub.workbench.reply':
        await upsertReply(db, meta, v.value as import('../../shared/types').ReplyRecord);
        break;
      case 'pub.workbench.follow':
        await upsertFollow(db, meta, v.value as import('../../shared/types').FollowRecord);
        break;
    }
    return 'applied';
  } catch (err) {
    // A poison event must be visible to an operator: error name and where it lives, never the record contents.
    const c = ev.kind === 'commit' ? ev.commit : undefined;
    console.error('ingest apply error', {
      name: err instanceof Error ? err.name : 'unknown',
      uri: c ? `at://${ev.did}/${c.collection}/${c.rkey}` : undefined,
      collection: c?.collection,
    });
    return 'error';
  }
}
