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
  if (!r.ok) throw new Error(`Invalid ${collection.split('.').pop()}: ${r.reason}`);
  return r.value;
}

async function put(s: Session, collection: Collection, record: object): Promise<string> {
  try {
    const res = await s.agent.com.atproto.repo.createRecord({ repo: s.did, collection, record: record as Record<string, unknown> });
    return res.data.uri;
  } catch {
    throw new Error('Could not save to your PDS. Please try again.');
  }
}

async function upload(s: Session, file: File): Promise<BlobRef> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await s.agent.com.atproto.repo.uploadBlob(bytes, { encoding: file.type || 'application/octet-stream' });
    const b = res.data.blob as unknown as { toJSON?: () => unknown };
    return (typeof b.toJSON === 'function' ? b.toJSON() : b) as BlobRef;
  } catch {
    throw new Error('Could not upload an image. Please try again.');
  }
}

export async function createTopic(
  s: Session,
  i: { name: string; description: string },
  o?: WriteOptions,
): Promise<{ uri: string; slug: string }> {
  const slug = normalizeSlug(i.name);
  if (!slug) throw new Error('Topic name must contain 2 to 40 letters or numbers');
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
  if (!topic) throw new Error('Topic must contain 2 to 40 letters or numbers');
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
): Promise<{ uri: string }> {
  if (i.images.length > LIMITS.images) throw new Error(`At most ${LIMITS.images} images per update`);
  if (i.images.some((img) => img.alt.trim() === '')) throw new Error('Every image needs alt text');

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
  return { uri: await put(s, record.$type, record) };
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

/**
 * Projects are followed by at-uri. The follow lexicon only accepts an at-uri
 * subject, so a topic must also be given as the topic record's at-uri; a bare
 * slug is rejected rather than writing a record ingest would drop.
 */
export async function followSubject(
  s: Session,
  kind: 'project' | 'topic',
  key: string,
  o?: WriteOptions,
): Promise<{ uri: string }> {
  const collection = `pub.workbench.${kind}`;
  if (!key.startsWith('at://')) {
    throw new Error(
      kind === 'topic' ? 'Following a topic needs the topic record address' : 'Following a project needs its address',
    );
  }
  if (!key.includes(`/${collection}/`)) throw new Error(`That is not a ${kind} address`);
  const record = checked('pub.workbench.follow', {
    $type: 'pub.workbench.follow',
    subject: key,
    createdAt: createdAt(o),
  });
  return { uri: await put(s, record.$type, record) };
}

export async function deleteRecord(s: Session, uri: string): Promise<void> {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!m) throw new Error('Invalid record address');
  const [, repo, collection, rkey] = m;
  if (repo !== s.did) throw new Error('You can only delete your own records');
  if (!collection.startsWith('pub.workbench.')) throw new Error('Cannot delete this kind of record');
  try {
    await s.agent.com.atproto.repo.deleteRecord({ repo, collection, rkey });
  } catch {
    throw new Error('Could not delete the record. Please try again.');
  }
}
