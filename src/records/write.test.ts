import { describe, expect, it, vi } from 'vitest';
import type { Session } from '../auth/oauth';
import { validateRecord } from '../../shared/lexicons';
import { createProject, createReply, createTopic, createUpdate, deleteRecord, followSubject } from './write';

const NOW = () => new Date('2026-11-07T12:00:00.000Z');
const PROJECT = 'at://did:plc:me/pub.workbench.project/abc';

function fake(opts: { uploadFails?: boolean } = {}) {
  let n = 0;
  const createRecord = vi.fn(async (_a: unknown) => ({ data: { uri: 'at://did:plc:me/x/new', cid: 'c' } }));
  const deleteRec = vi.fn(async (_a: unknown) => ({}));
  const uploadBlob = vi.fn(async () => {
    if (opts.uploadFails) throw new Error('boom');
    n += 1;
    return {
      data: { blob: { toJSON: () => ({ $type: 'blob', ref: { $link: `cid${n}` }, mimeType: 'image/png', size: 1 }) } },
    };
  });
  const s = {
    did: 'did:plc:me',
    handle: 'me.test',
    agent: { com: { atproto: { repo: { createRecord, deleteRecord: deleteRec, uploadBlob } } } },
  } as unknown as Session;
  return { s, createRecord, deleteRec, uploadBlob };
}

const png = (name = 'a.png') => new File(['data'], name, { type: 'image/png' });
const update = (over = {}) => ({
  project: PROJECT,
  heading: 'Day 1',
  body: 'Cut the frame',
  images: [{ file: png(), alt: 'frame' }],
  links: [{ url: 'https://example.com' }],
  ...over,
});

describe('createUpdate', () => {
  it('uploads each image then creates the record with blob refs', async () => {
    const { s, createRecord, uploadBlob } = fake();
    const res = await createUpdate(
      s,
      update({
        images: [{ file: png('1.png'), alt: 'one' }, { file: png('2.png'), alt: 'two' }],
        parts: [{ item: 'M3 screw', quantity: '10', note: 'steel' }],
      }),
      { now: NOW },
    );
    expect(res.uri).toBe('at://did:plc:me/x/new');
    expect(res.images.map((i) => i.alt)).toEqual(['one', 'two']);
    expect(uploadBlob).toHaveBeenCalledTimes(2);
    const arg = createRecord.mock.calls[0][0] as { repo: string; collection: string; record: Record<string, unknown> };
    expect(arg.repo).toBe('did:plc:me');
    expect(arg.collection).toBe('pub.workbench.update');
    expect(arg.record.images).toEqual([
      { image: { $type: 'blob', ref: { $link: 'cid1' }, mimeType: 'image/png', size: 1 }, alt: 'one' },
      { image: { $type: 'blob', ref: { $link: 'cid2' }, mimeType: 'image/png', size: 1 }, alt: 'two' },
    ]);
    expect(arg.record.createdAt).toBe('2026-11-07T12:00:00.000Z');
    expect(validateRecord('pub.workbench.update', arg.record).ok).toBe(true);
  });

  it('throws before any network call when the record is invalid', async () => {
    const { s, createRecord, uploadBlob } = fake();
    await expect(createUpdate(s, update({ project: 'not-a-uri' }))).rejects.toThrow(/project/);
    await expect(createUpdate(s, update({ heading: '' }))).rejects.toThrow(/heading/);
    expect(uploadBlob).not.toHaveBeenCalled();
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('requires alt text on every image before uploading', async () => {
    const { s, createRecord, uploadBlob } = fake();
    const images = [{ file: png(), alt: 'ok' }, { file: png(), alt: '  ' }];
    await expect(createUpdate(s, update({ images }))).rejects.toThrow(/alt/i);
    expect(uploadBlob).not.toHaveBeenCalled();
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('rejects more than 6 images before uploading', async () => {
    const { s, uploadBlob } = fake();
    const images = Array.from({ length: 7 }, () => ({ file: png(), alt: 'x' }));
    await expect(createUpdate(s, update({ images }))).rejects.toThrow(/6 images/);
    expect(uploadBlob).not.toHaveBeenCalled();
  });

  it('does not create the record when an upload fails', async () => {
    const { s, createRecord } = fake({ uploadFails: true });
    await expect(createUpdate(s, update())).rejects.toThrow('Could not upload an image');
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('omits empty optional fields and accepts no images', async () => {
    const { s, createRecord } = fake();
    await createUpdate(s, update({ images: [], links: [] }), { now: NOW });
    const rec = (createRecord.mock.calls[0][0] as { record: object }).record;
    expect(Object.keys(rec).sort()).toEqual(['$type', 'body', 'createdAt', 'heading', 'project']);
  });

  it('hides PDS error details', async () => {
    const { s, createRecord } = fake();
    createRecord.mockRejectedValueOnce(new Error('secret token xyz'));
    await expect(createUpdate(s, update({ images: [] }))).rejects.toThrow('Could not save to your PDS. Please try again.');
  });
});

describe('createTopic', () => {
  it('normalises the slug and returns it', async () => {
    const { s, createRecord } = fake();
    const res = await createTopic(s, { name: 'Wood Working!', description: 'd' }, { now: NOW });
    expect(res).toEqual({ uri: 'at://did:plc:me/x/new', slug: 'wood-working' });
    const arg = createRecord.mock.calls[0][0] as { collection: string; record: Record<string, unknown> };
    expect(arg.collection).toBe('pub.workbench.topic');
    expect(arg.record.slug).toBe('wood-working');
  });

  it('rejects names that normalise to null', async () => {
    const { s, createRecord } = fake();
    await expect(createTopic(s, { name: '!!', description: '' })).rejects.toThrow();
    expect(createRecord).not.toHaveBeenCalled();
  });
});

describe('createProject', () => {
  const base = { title: 'Lathe', summary: 's', topic: 'Metal Work', status: 'in-progress' as const };

  it('normalises the topic slug', async () => {
    const { s, createRecord } = fake();
    await createProject(s, base, { now: NOW });
    const arg = createRecord.mock.calls[0][0] as { record: Record<string, unknown> };
    expect(arg.record.topic).toBe('metal-work');
    expect(arg.record.cover).toBeUndefined();
  });

  it('uploads the cover and stores the blob ref', async () => {
    const { s, createRecord, uploadBlob } = fake();
    await createProject(s, { ...base, cover: png() }, { now: NOW });
    expect(uploadBlob).toHaveBeenCalledTimes(1);
    const arg = createRecord.mock.calls[0][0] as { record: Record<string, unknown> };
    expect(arg.record.cover).toEqual({ $type: 'blob', ref: { $link: 'cid1' }, mimeType: 'image/png', size: 1 });
  });

  it('throws before any network call for an unusable topic or invalid fields', async () => {
    const { s, createRecord, uploadBlob } = fake();
    await expect(createProject(s, { ...base, topic: '??', cover: png() })).rejects.toThrow(/Topic/);
    await expect(createProject(s, { ...base, title: '', cover: png() })).rejects.toThrow(/title/);
    expect(uploadBlob).not.toHaveBeenCalled();
    expect(createRecord).not.toHaveBeenCalled();
  });
});

describe('createReply', () => {
  it('creates a reply', async () => {
    const { s, createRecord } = fake();
    await createReply(s, { subject: PROJECT, body: 'nice' }, { now: NOW });
    expect((createRecord.mock.calls[0][0] as { collection: string }).collection).toBe('pub.workbench.reply');
  });
  it('rejects an empty body without a network call', async () => {
    const { s, createRecord } = fake();
    await expect(createReply(s, { subject: PROJECT, body: '' })).rejects.toThrow(/body/);
    expect(createRecord).not.toHaveBeenCalled();
  });
});

describe('followSubject', () => {
  it('follows a project by at-uri', async () => {
    const { s, createRecord } = fake();
    await followSubject(s, 'project', PROJECT, { now: NOW });
    const arg = createRecord.mock.calls[0][0] as { collection: string; record: Record<string, unknown> };
    expect(arg.collection).toBe('pub.workbench.follow');
    expect(arg.record).toEqual({
      $type: 'pub.workbench.follow',
      kind: 'project',
      subject: PROJECT,
      createdAt: '2026-11-07T12:00:00.000Z',
    });
    expect(validateRecord('pub.workbench.follow', arg.record).ok).toBe(true);
  });
  it('follows a topic by canonical slug', async () => {
    const { s, createRecord } = fake();
    await followSubject(s, 'topic', 'woodworking');
    const arg = createRecord.mock.calls[0][0] as { record: Record<string, unknown> };
    expect(arg.record).toMatchObject({ kind: 'topic', subject: 'woodworking' });
    expect(validateRecord('pub.workbench.follow', arg.record).ok).toBe(true);
  });
  it.each([
    ['topic', 'Woodworking'],
    ['topic', PROJECT],
    ['project', 'woodworking'],
    ['project', 'at://did:plc:x/pub.workbench.topic/woodworking'],
  ] as const)('rejects %s follow of %s without a network call', async (kind, key) => {
    const { s, createRecord } = fake();
    await expect(followSubject(s, kind, key)).rejects.toThrow();
    expect(createRecord).not.toHaveBeenCalled();
  });
});

describe('deleteRecord', () => {
  it('parses the uri and deletes', async () => {
    const { s, deleteRec } = fake();
    await deleteRecord(s, 'at://did:plc:me/pub.workbench.update/3k');
    expect(deleteRec).toHaveBeenCalledWith({ repo: 'did:plc:me', collection: 'pub.workbench.update', rkey: '3k' });
  });
  it.each([
    'at://did:plc:other/pub.workbench.update/3k',
    'at://did:plc:me/app.bsky.feed.post/3k',
    'at://did:plc:me/pub.workbench.update',
    'garbage',
  ])('refuses %s without a network call', async (uri) => {
    const { s, deleteRec } = fake();
    await expect(deleteRecord(s, uri)).rejects.toThrow();
    expect(deleteRec).not.toHaveBeenCalled();
  });
});
