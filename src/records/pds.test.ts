import { Agent } from '@atproto/api';
import { validateRecord } from '../../shared/lexicons';
import type { Session } from '../auth/oauth';
import { createReply, createUpdate } from './write';

const DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const PROJECT = `at://${DID}/pub.workbench.project/abc`;

const CIDS = ['bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku', 'bafkreiaxkcmnyvtcdmjwmpgmzeuwrwkqzxwhg6vj5ycrdl3bcy5emgmuga'];

interface Seen {
  method: string;
  path: string;
  contentType: string | null;
  body: Uint8Array;
}

/** A fake PDS behind the REAL @atproto/api Agent: the exact HTTP requests are what the PDS would receive. */
function pds(over: { createStatus?: number; createBody?: unknown } = {}) {
  const seen: Seen[] = [];
  let n = 0;
  const agent = new Agent(async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url), 'https://pds.example');
    const body = new Uint8Array(await new Response(init?.body as BodyInit | null).arrayBuffer());
    const headers = new Headers(init?.headers);
    seen.push({ method: String(init?.method), path: u.pathname, contentType: headers.get('content-type'), body });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/xrpc/com.atproto.repo.uploadBlob') {
      n += 1;
      return json({ blob: { $type: 'blob', ref: { $link: CIDS[n - 1] }, mimeType: headers.get('content-type'), size: body.length } });
    }
    if (u.pathname === '/xrpc/com.atproto.repo.createRecord') {
      if (over.createStatus) return json(over.createBody ?? { error: 'InvalidRequest', message: 'bad' }, over.createStatus);
      return json({ uri: `at://${DID}/pub.workbench.update/3kabc`, cid: 'bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi' });
    }
    return json({ error: 'MethodNotImplemented' }, 501);
  });
  const session = { did: DID, handle: 'me.test', agent } as unknown as Session;
  return { session, seen };
}

const jpeg = (name = 'a.jpg') => new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'image/jpeg' });
const parse = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as Record<string, any>;

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => errSpy.mockRestore());

describe('createUpdate against a fake PDS through the real agent', () => {
  it('without images makes a single createRecord call with a valid record', async () => {
    const { session, seen } = pds();
    await createUpdate(session, { project: PROJECT, heading: 'h', body: 'b', images: [], links: [] });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: expect.stringMatching(/post/i), path: '/xrpc/com.atproto.repo.createRecord', contentType: 'application/json' });
    const req = parse(seen[0].body);
    expect(req).toMatchObject({ repo: DID, collection: 'pub.workbench.update' });
    expect(req.rkey).toBeUndefined();
    expect(req.record.images).toBeUndefined();
    expect(req.record.links).toBeUndefined();
    expect(req.record.parts).toBeUndefined();
    expect(validateRecord('pub.workbench.update', req.record).ok).toBe(true);
  });

  it('uploads each image as raw bytes with its content type, then embeds plain-JSON blob refs', async () => {
    const { session, seen } = pds();
    const res = await createUpdate(session, {
      project: PROJECT, heading: 'h', body: 'b',
      images: [{ file: jpeg('1.jpg'), alt: 'one' }, { file: jpeg('2.jpg'), alt: 'two' }],
      links: [{ url: 'https://example.com', title: 'x' }],
      parts: [{ item: 'Knob', quantity: '3' }],
    });
    expect(seen.map((s) => s.path)).toEqual([
      '/xrpc/com.atproto.repo.uploadBlob',
      '/xrpc/com.atproto.repo.uploadBlob',
      '/xrpc/com.atproto.repo.createRecord',
    ]);
    expect(seen[0]).toMatchObject({ method: expect.stringMatching(/post/i), contentType: 'image/jpeg' });
    expect([...seen[0].body]).toEqual([1, 2, 3, 4]);
    const rec = parse(seen[2].body).record;
    expect(rec.images[0].image).toMatchObject({ $type: 'blob', mimeType: 'image/jpeg', size: 4 });
    expect(typeof rec.images[0].image.ref.$link).toBe('string');
    expect(rec.images.map((i: { alt: string }) => i.alt)).toEqual(['one', 'two']);
    expect(rec.parts).toEqual([{ item: 'Knob', quantity: '3' }]);
    expect(validateRecord('pub.workbench.update', rec).ok).toBe(true);
    expect(res.images[0].image.ref.$link).toBe(rec.images[0].image.ref.$link);
  });

  it('surfaces the XRPC status and error name from the server', async () => {
    const { session } = pds({ createStatus: 401, createBody: { error: 'InvalidToken', message: 'Token has expired' } });
    await expect(createReply(session, { subject: PROJECT, body: 'x' })).rejects.toMatchObject({
      stage: 'create',
      status: 401,
      errorName: 'InvalidToken',
    });
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toBe('[write] stage=create status=401 error=InvalidToken message="Token has expired"');
  });

  it('treats a 2xx reply that fails validation as saved when it carries the uri', async () => {
    const { session } = pds({ createStatus: 200, createBody: { uri: `at://${DID}/pub.workbench.reply/3k1`, cid: 'not-a-cid' } });
    await expect(createReply(session, { subject: PROJECT, body: 'x' })).resolves.toEqual({ uri: `at://${DID}/pub.workbench.reply/3k1` });
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('tells the person a write may have succeeded when the reply is unreadable and has no uri', async () => {
    const { session } = pds({ createStatus: 200, createBody: { nope: 1 } });
    await expect(createReply(session, { subject: PROJECT, body: 'x' })).rejects.toMatchObject({ stage: 'create', maybeSaved: true });
  });
});
