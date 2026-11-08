import { describeThrown, logFailure, WriteError, type Stage } from './errors';
import type { Session } from '../auth/oauth';
import {
  LIMITS,
  normalizeSlug,
  validateRecord,
  type BlobRef,
  type Collection,
  type ImageDef,
  type LinkDef,
  type PartDef,
  type ProjectStatus,
  type RecordByCollection,
} from '../../shared/lexicons';

export interface WriteOptions {
  /** Test seam for createdAt. */
  now?: () => Date;
}

const createdAt = (o?: WriteOptions) => (o?.now?.() ?? new Date()).toISOString();

/** Validates before any network call; the message is safe to show. */
function checked<C extends Collection>(collection: C, record: unknown): RecordByCollection[C] {
  const r = validateRecord(collection, record);
  if (!r.ok) throw fail(`Invalid ${collection.split('.').pop()}: ${r.reason}`, 'validate');
  return r.value;
}

/** Builds a WriteError and logs it once. For thrown remote failures pass the cause. */
function fail(message: string, stage: Stage, cause?: unknown): WriteError {
  const info = { stage, ...(cause === undefined ? {} : describeThrown(cause)) };
  logFailure(info);
  return new WriteError(message, info);
}

async function put(s: Session, collection: Collection, record: object): Promise<string> {
  try {
    const res = await s.agent.com.atproto.repo.createRecord({ repo: s.did, collection, record: record as Record<string, unknown> });
    return res.data.uri;
  } catch (e) {
    // The server answered 2xx but the reply failed validation: the record exists, so use its uri.
    const body = (e as { responseBody?: { uri?: unknown } } | null)?.responseBody;
    if (describeThrown(e).maybeSaved && typeof body?.uri === 'string' && body.uri.startsWith('at://')) return body.uri;
    throw fail('Could not save to your PDS. Please try again.', 'create', e);
  }
}

async function upload(s: Session, file: File): Promise<BlobRef> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await s.agent.com.atproto.repo.uploadBlob(bytes, { encoding: file.type || 'application/octet-stream' });
    const b = res.data.blob as unknown as { toJSON?: () => unknown };
    return (typeof b.toJSON === 'function' ? b.toJSON() : b) as BlobRef;
  } catch (e) {
    throw fail('Could not upload an image. Please try again.', 'upload', e);
  }
}

export async function createTopic(
  s: Session,
  i: { name: string; description: string },
  o?: WriteOptions,
): Promise<{ uri: string; slug: string }> {
  const slug = normalizeSlug(i.name);
  if (!slug) throw fail('Topic name must contain 2 to 40 letters or numbers', 'validate');
  const record = checked('pub.workbench.topic', {
    $type: 'pub.workbench.topic',
    name: i.name,
    slug,
    description: i.description,
    createdAt: createdAt(o),
  });
  return { uri: await put(s, record.$type, record), slug };
}

export async function createProject(
  s: Session,
  i: { title: string; summary: string; topic: string; status: ProjectStatus; cover?: File },
  o?: WriteOptions,
): Promise<{ uri: string }> {
  const topic = normalizeSlug(i.topic);
  if (!topic) throw fail('Topic must contain 2 to 40 letters or numbers', 'validate');
  const base = {
    $type: 'pub.workbench.project' as const,
    title: i.title,
    summary: i.summary,
    topic,
    status: i.status,
    createdAt: createdAt(o),
  };
  checked('pub.workbench.project', base);
  const record = i.cover ? { ...base, cover: await upload(s, i.cover) } : base;
  checked('pub.workbench.project', record);
  return { uri: await put(s, record.$type, record) };
}

export async function createUpdate(
  s: Session,
  i: {
    project: string;
    heading: string;
    body: string;
    images: { file: File; alt: string }[];
    links: { url: string; title?: string }[];
    parts?: { item: string; quantity: string; note?: string }[];
  },
  o?: WriteOptions,
): Promise<{ uri: string; images: ImageDef[] }> {
  if (i.images.length > LIMITS.images) throw fail(`At most ${LIMITS.images} images per update`, 'validate');
  if (i.images.some((img) => img.alt.trim() === '')) throw fail('Every image needs alt text', 'validate');

  const links: LinkDef[] = i.links.map((l) => (l.title ? { url: l.url, title: l.title } : { url: l.url }));
  const parts: PartDef[] | undefined = i.parts?.map((p) => ({
    item: p.item,
    quantity: p.quantity,
    ...(p.note ? { note: p.note } : {}),
  }));
  const build = (images: ImageDef[]) => ({
    $type: 'pub.workbench.update' as const,
    project: i.project,
    heading: i.heading,
    body: i.body,
    ...(images.length ? { images } : {}),
    ...(links.length ? { links } : {}),
    ...(parts?.length ? { parts } : {}),
    createdAt: createdAt(o),
  });

  // Validate everything except the blob refs first, using placeholders, so a bad
  // record never triggers an upload.
  const placeholder: BlobRef = { $type: 'blob', ref: { $link: 'pending' }, mimeType: 'image/jpeg', size: 0 };
  checked('pub.workbench.update', build(i.images.map((img) => ({ image: placeholder, alt: img.alt }))));

  const images: ImageDef[] = [];
  for (const img of i.images) images.push({ image: await upload(s, img.file), alt: img.alt });
  const record = checked('pub.workbench.update', build(images));
  return { uri: await put(s, record.$type, record), images };
}

export async function createReply(s: Session, i: { subject: string; body: string }, o?: WriteOptions) {
  const record = checked('pub.workbench.reply', {
    $type: 'pub.workbench.reply',
    subject: i.subject,
    body: i.body,
    createdAt: createdAt(o),
  });
  return { uri: await put(s, record.$type, record) };
}

/** Projects are followed by at-uri, topics by canonical slug. */
export async function followSubject(
  s: Session,
  kind: 'project' | 'topic',
  key: string,
  o?: WriteOptions,
): Promise<{ uri: string }> {
  if (kind === 'topic' && normalizeSlug(key) !== key) throw fail('Topic must be a canonical slug', 'validate');
  if (kind === 'project' && !/^at:\/\/[^/]+\/pub\.workbench\.project\/[^/]+$/.test(key)) {
    throw fail('Following a project needs the project record address', 'validate');
  }
  const record = checked('pub.workbench.follow', {
    $type: 'pub.workbench.follow',
    kind,
    subject: key,
    createdAt: createdAt(o),
  });
  return { uri: await put(s, record.$type, record) };
}

export async function deleteRecord(s: Session, uri: string): Promise<void> {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!m) throw fail('Invalid record address', 'validate');
  const [, repo, collection, rkey] = m;
  if (repo !== s.did) throw fail('You can only delete your own records', 'validate');
  if (!collection.startsWith('pub.workbench.')) throw fail('Cannot delete this kind of record', 'validate');
  try {
    await s.agent.com.atproto.repo.deleteRecord({ repo, collection, rkey });
  } catch (e) {
    throw fail('Could not delete the record. Please try again.', 'create', e);
  }
}
