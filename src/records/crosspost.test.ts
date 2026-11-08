import { Agent, AppBskyFeedPost, jsonToLex } from '@atproto/api';
import type { Session } from '../auth/oauth';
import {
  buildCaption,
  clipCaption,
  CROSSPOST_MAX_BYTES,
  buildPostRecord,
  CROSSPOST_MAX_GRAPHEMES,
  createCrosspost,
  graphemeLength,
  linkLengthFor,
  permalink,
  stripControls,
  truncateGraphemes,
} from './crosspost';
import { crosspostFailureNotice } from './errors';
import { resizeImage } from './image';

vi.mock('./image', () => ({ resizeImage: vi.fn() }));

const DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const URL_ = `https://workbench.pub/u/${DID}/3kabcdefghij2`;
const THUMB_BYTES = 1_000_000;
const CID = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const blob = (size: number) => ({ $type: 'blob' as const, ref: { $link: CID }, mimeType: 'image/jpeg', size });

afterEach(() => vi.restoreAllMocks());

describe('graphemes and captions', () => {
  it('counts user-perceived characters, not code units', () => {
    expect(graphemeLength('abc')).toBe(3);
    expect(graphemeLength('👨‍👩‍👧‍👦')).toBe(1); // family emoji, one grapheme
    expect(graphemeLength('é')).toBe(1); // e + combining acute
    expect(graphemeLength('🇺🇸🇯🇵')).toBe(2);
  });

  it('truncates on grapheme boundaries and marks the cut', () => {
    expect(truncateGraphemes('hello world', 5)).toBe('hell…');
    expect(truncateGraphemes('hello', 5)).toBe('hello');
    const cut = truncateGraphemes('👨‍👩‍👧‍👦'.repeat(5), 3);
    expect(graphemeLength(cut)).toBe(3);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toMatch(/‍$/); // never ends mid-sequence
  });

  it('strips control characters but keeps newlines', () => {
    expect(stripControls('a\u0000b\u0007c‮d\ne')).toBe('abcd\ne');
  });

  it('builds a trimmed caption from heading and project, within the budget', () => {
    expect(buildCaption({ heading: '  Cut the panel  ', body: 'x', projectTitle: ' Synth ' }, 200)).toBe('Synth: Cut the panel');
  });

  it('falls back to the first line of the notes when the heading is empty, and to the title alone', () => {
    expect(buildCaption({ heading: '', body: '\n  First line here\nsecond', projectTitle: 'Synth' }, 200)).toBe('Synth: First line here');
    expect(buildCaption({ heading: '', body: '', projectTitle: 'Synth' }, 200)).toBe('Synth');
    expect(buildCaption({ heading: 'Only heading', body: '', projectTitle: '' }, 200)).toBe('Only heading');
    expect(buildCaption({ heading: '', body: '', projectTitle: '' }, 200)).toBe('');
  });

  it('never exceeds the budget, counting graphemes with emoji', () => {
    const out = buildCaption({ heading: '🔧'.repeat(500), body: '', projectTitle: 'T' }, 100);
    expect(graphemeLength(out)).toBeLessThanOrEqual(100);
  });

  it('leaves room for the link inside the 300 grapheme limit', () => {
    expect(CROSSPOST_MAX_GRAPHEMES).toBe(300);
    expect(linkLengthFor(DID)).toBeGreaterThanOrEqual(URL_.length);
    expect(linkLengthFor(DID) + 1 + (CROSSPOST_MAX_GRAPHEMES - linkLengthFor(DID) - 1)).toBe(300);
  });
});

describe('post record', () => {
  const base = { caption: 'Synth: Cut the panel', url: URL_, title: 'Synth: Cut the panel', description: 'It fits', createdAt: '2026-11-08T12:00:00.000Z' };

  it('puts the caption then the link on a new line, with a link facet at the right byte offsets', () => {
    const r = buildPostRecord(base);
    expect(r.text).toBe(`Synth: Cut the panel\n${URL_}`);
    const f = r.facets![0];
    const bytes = new TextEncoder().encode(r.text);
    expect(new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd))).toBe(URL_);
    expect(f.features[0]).toEqual({ $type: 'app.bsky.richtext.facet#link', uri: URL_ });
  });

  it.each([
    ['accents', 'Café résumé naïve'],
    ['emoji', '🔧 Wired it up 🎛️'],
    ['hebrew (RTL)', 'שלום עולם, בניתי מסנן'],
    ['mixed', 'Cäfé שלום 👨‍👩‍👧‍👦 done'],
  ])('computes UTF-8 byte offsets, not string indices, for %s', (_n, caption) => {
    const r = buildPostRecord({ ...base, caption });
    const f = r.facets![0];
    const bytes = new TextEncoder().encode(r.text);
    expect(new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd))).toBe(URL_);
    expect(f.index.byteEnd).toBe(bytes.length);
    if (caption.length !== new TextEncoder().encode(caption).length) expect(f.index.byteStart).not.toBe(caption.length + 1);
  });

  it('is a valid app.bsky.feed.post with an external embed, with and without a thumb', () => {
    for (const thumb of [undefined, blob(500_000)]) {
      const r = buildPostRecord({ ...base, thumb });
      const v = AppBskyFeedPost.validateRecord(jsonToLex(r));
      expect(v.success, JSON.stringify(v)).toBe(true);
      expect(r.embed).toMatchObject({ $type: 'app.bsky.embed.external', external: { uri: URL_, title: base.title, description: 'It fits' } });
      expect(Boolean((r.embed as { external: { thumb?: unknown } }).external.thumb)).toBe(Boolean(thumb));
    }
  });

  it('trims an over-long caption so caption plus link stays within 300 graphemes', () => {
    const r = buildPostRecord({ ...base, caption: 'x'.repeat(1000) });
    expect(graphemeLength(r.text)).toBeLessThanOrEqual(300);
    expect(r.text.endsWith(URL_)).toBe(true);
  });

  it('keeps DIDs out of the text beyond the public link and strips control characters', () => {
    const r = buildPostRecord({ ...base, caption: 'hello\u0000 there', description: 'a\u0007b' });
    expect(r.text).not.toContain('\u0000');
    expect((r.embed as { external: { description: string } }).external.description).toBe('ab');
    expect(r.text.replace(URL_, '')).not.toContain('did:');
    expect(permalink(DID, '3kabc')).toBe(`https://workbench.pub/u/${DID}/3kabc`);
  });
});

function fakeSession(opts: { createFails?: unknown } = {}) {
  const calls: string[] = [];
  const createRecord = vi.fn(async (a: { collection: string; record: unknown }) => {
    calls.push(`createRecord:${a.collection}`);
    if (opts.createFails) throw opts.createFails;
    return { data: { uri: `at://${DID}/app.bsky.feed.post/3kpost`, cid: CID } };
  });
  const uploadBlob = vi.fn(async () => {
    calls.push('uploadBlob');
    return { data: { blob: { toJSON: () => blob(120_000) } } };
  });
  const session = { did: DID, handle: 'me.test', agent: { com: { atproto: { repo: { createRecord, uploadBlob } } } } } as unknown as Session;
  return { session, calls, createRecord, uploadBlob };
}

const input = { caption: 'Synth: Cut the panel', url: URL_, title: 'Synth: Cut the panel', description: 'd' };

describe('createCrosspost call order', () => {
  it('reuses the update photo blob when it is small enough: no upload, one createRecord', async () => {
    const f = fakeSession();
    await createCrosspost(f.session, { ...input, thumb: { ref: blob(400_000), original: new File(['x'], 'a.jpg') } });
    expect(f.calls).toEqual(['createRecord:app.bsky.feed.post']);
    const rec = f.createRecord.mock.calls[0][0].record as { embed: { external: { thumb: unknown } } };
    expect(rec.embed.external.thumb).toEqual(blob(400_000));
  });

  it('re-resizes and uploads a separate smaller thumb when the blob is over 1,000,000 bytes', async () => {
    vi.mocked(resizeImage).mockResolvedValue(new Blob(['small'], { type: 'image/jpeg' }));
    const f = fakeSession();
    const original = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    await createCrosspost(f.session, { ...input, thumb: { ref: blob(1_200_000), original } });
    expect(resizeImage).toHaveBeenCalledWith(original, 1000);
    expect(f.calls).toEqual(['uploadBlob', 'createRecord:app.bsky.feed.post']);
    const rec = f.createRecord.mock.calls[0][0].record as { embed: { external: { thumb: { size: number } } } };
    expect(rec.embed.external.thumb.size).toBe(120_000);
  });

  it('omits the thumb, and still posts, when the smaller thumb cannot be made', async () => {
    vi.mocked(resizeImage).mockRejectedValue(new Error('Could not process this image'));
    const f = fakeSession();
    await createCrosspost(f.session, { ...input, thumb: { ref: blob(1_200_000), original: new File(['x'], 'a.jpg') } });
    expect(f.calls).toEqual(['createRecord:app.bsky.feed.post']);
    const rec = f.createRecord.mock.calls[0][0].record as { embed: { external: Record<string, unknown> } };
    expect(rec.embed.external.thumb).toBeUndefined();
  });

  it('posts without any thumb when the update has no photo', async () => {
    const f = fakeSession();
    await createCrosspost(f.session, input);
    expect(f.calls).toEqual(['createRecord:app.bsky.feed.post']);
  });
});

describe('createCrosspost failures', () => {
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    err = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('tags a scope error with the crosspost stage, logs one sanitized [crosspost] line, and maps it to a recovery', async () => {
    const f = fakeSession({ createFails: Object.assign(new Error('Missing required scope at://did:plc:x?code=SECRET'), { status: 403, error: 'ScopeMissing' }) });
    const e = await createCrosspost(f.session, input).catch((x) => x);
    expect(e).toMatchObject({ stage: 'crosspost', status: 403, errorName: 'ScopeMissing' });
    expect(err).toHaveBeenCalledTimes(1);
    const line = String(err.mock.calls[0][0]);
    expect(line).toBe('[crosspost] stage=crosspost status=403 error=ScopeMissing');
    expect(crosspostFailureNotice(e)).toBe(
      'Your update is posted. The Bluesky post did not go through: ScopeMissing (crosspost). Sign out and sign in again to allow posting to Bluesky. You can post it to Bluesky yourself.',
    );
  });

  it('describes network and rate-limit failures plainly', async () => {
    const net = await createCrosspost(fakeSession({ createFails: new TypeError('Failed to fetch') }).session, input).catch((x) => x);
    expect(crosspostFailureNotice(net)).toMatch(/NetworkError \(crosspost\)\. Check your internet connection/);
    const rl = await createCrosspost(fakeSession({ createFails: Object.assign(new Error('slow'), { status: 429, error: 'RateLimitExceeded' }) }).session, input).catch((x) => x);
    expect(crosspostFailureNotice(rl)).toMatch(/RateLimitExceeded \(crosspost\)\. .*Wait a few minutes/);
  });
});

describe('createCrosspost over the real agent (HTTP shape)', () => {
  it('sends exactly one POST /xrpc/com.atproto.repo.createRecord for app.bsky.feed.post with facets and an external embed', async () => {
    const seen: { method: string; path: string; contentType: string | null; body: Record<string, any> }[] = [];
    const agent = new Agent(async (url: string | URL, init?: RequestInit) => {
      const u = new URL(String(url), 'https://pds.example');
      const raw = await new Response(init?.body as BodyInit | null).text();
      seen.push({ method: String(init?.method), path: u.pathname, contentType: new Headers(init?.headers).get('content-type'), body: JSON.parse(raw) });
      return new Response(JSON.stringify({ uri: `at://${DID}/app.bsky.feed.post/3kpost`, cid: 'bafyreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const session = { did: DID, handle: 'me.test', agent } as unknown as Session;
    await createCrosspost(session, { ...input, caption: 'Café: שלום', thumb: { ref: blob(300_000), original: new File(['x'], 'a.jpg') } }, { now: () => new Date('2026-11-08T12:00:00.000Z') });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: expect.stringMatching(/post/i), path: '/xrpc/com.atproto.repo.createRecord', contentType: 'application/json' });
    const { repo, collection, record, rkey } = seen[0].body;
    expect({ repo, collection, rkey }).toEqual({ repo: DID, collection: 'app.bsky.feed.post', rkey: undefined });
    expect(record).toMatchObject({ $type: 'app.bsky.feed.post', createdAt: '2026-11-08T12:00:00.000Z' });
    expect(record.embed.external.thumb).toEqual(blob(300_000));
    expect(record.langs).toEqual(['en']);
    expect(AppBskyFeedPost.validateRecord(jsonToLex(record)).success).toBe(true);
    const bytes = new TextEncoder().encode(record.text);
    expect(new TextDecoder().decode(bytes.slice(record.facets[0].index.byteStart, record.facets[0].index.byteEnd))).toBe(URL_);
  });
});

describe('byte limit, langs and local validation', () => {
  const bytes = (x: string) => new TextEncoder().encode(x).length;

  it('limits the caption to Bluesky\'s 3000 byte text limit as well as 300 graphemes (multi-codepoint emoji)', () => {
    const family = '👨‍👩‍👧‍👦'; // 1 grapheme, 25 bytes
    const clipped = clipCaption(family.repeat(150), DID);
    expect(graphemeLength(clipped)).toBeLessThan(150); // under 300 graphemes, but cut for bytes
    const record = buildPostRecord({ caption: family.repeat(150), url: permalink(DID, '3kabcdefghij2'), title: 't', description: 'd', createdAt: '2026-11-08T12:00:00.000Z' });
    expect(bytes(record.text)).toBeLessThanOrEqual(CROSSPOST_MAX_BYTES);
    expect(graphemeLength(record.text)).toBeLessThanOrEqual(300);
    expect(AppBskyFeedPost.validateRecord(jsonToLex(record)).success).toBe(true);
    expect(clipCaption('short', DID)).toBe('short');
  });

  it('names a local validation failure InvalidPost with a plain message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fakeSession();
    const e = await createCrosspost(f.session, { ...input, url: `https://workbench.pub/${'a'.repeat(4000)}` }).catch((x) => x);
    expect(e).toMatchObject({ stage: 'crosspost', errorName: 'InvalidPost' });
    expect(f.createRecord).not.toHaveBeenCalled();
    expect(crosspostFailureNotice(e)).toContain('InvalidPost (crosspost). This caption is too long for Bluesky. Shorten it.');
  });

  it('posts without a thumb when even the re-resized image is over 1,000,000 bytes (no upload)', async () => {
    vi.mocked(resizeImage).mockResolvedValue(new Blob([new Uint8Array(THUMB_BYTES + 1)], { type: 'image/jpeg' }));
    const f = fakeSession();
    await createCrosspost(f.session, { ...input, thumb: { ref: blob(1_200_000), original: new File(['x'], 'a.jpg') } });
    expect(f.calls).toEqual(['createRecord:app.bsky.feed.post']);
  });

  it('adds langs from the browser language primary subtag, validated, and omits it when unusable', async () => {
    const lang = vi.spyOn(navigator, 'language', 'get');
    lang.mockReturnValue('en-US');
    const f = fakeSession();
    await createCrosspost(f.session, input);
    const rec = f.createRecord.mock.calls[0][0].record as { langs?: string[] };
    expect(rec.langs).toEqual(['en']);
    expect(AppBskyFeedPost.validateRecord(jsonToLex(rec)).success).toBe(true);
    lang.mockReturnValue('');
    const g = fakeSession();
    await createCrosspost(g.session, input);
    expect((g.createRecord.mock.calls[0][0].record as { langs?: string[] }).langs).toBeUndefined();
  });

  it('maps a 401 to the generic expired-session hint and reserves the permission hint for scope errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const expired = await createCrosspost(fakeSession({ createFails: Object.assign(new Error('x'), { status: 401, error: 'InvalidToken' }) }).session, input).catch((x) => x);
    expect(crosspostFailureNotice(expired)).toContain('Your session has expired. Sign in again.');
    expect(crosspostFailureNotice(expired)).not.toContain('allow posting to Bluesky');
    for (const err of [{ status: 403, error: 'Forbidden' }, { status: 400, error: 'InsufficientScope' }]) {
      const e = await createCrosspost(fakeSession({ createFails: Object.assign(new Error('x'), err) }).session, input).catch((x) => x);
      expect(crosspostFailureNotice(e)).toContain('Sign out and sign in again to allow posting to Bluesky.');
    }
  });
});
