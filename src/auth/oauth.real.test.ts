// Builds the REAL BrowserOAuthClient (oauth.ts is not mocked). Only IndexedDB (fake-indexeddb)
// and fetch (a stub that records calls) are replaced.
import 'fake-indexeddb/auto';
import { BrowserOAuthClient } from '@atproto/oauth-client-browser';
import { loadOAuthClient, signIn, SignInError } from './oauth';

const fetchCalls: string[] = [];
let fetchImpl: (url: string) => Promise<Response>;

beforeEach(() => {
  fetchCalls.length = 0;
  fetchImpl = async () => {
    throw new TypeError('network down');
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    fetchCalls.push(url);
    return fetchImpl(url);
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('real OAuth client (loopback)', () => {
  it('constructs without throwing and without any network', async () => {
    expect(window.location.hostname).toBe('localhost');
    const client = await loadOAuthClient();
    expect(client).toBeInstanceOf(BrowserOAuthClient);
    expect(fetchCalls).toEqual([]);
  });

  it('rejects a syntactically invalid handle before any network', async () => {
    await expect(signIn('not a handle')).rejects.toMatchObject({ name: 'SignInError', reason: 'invalid-handle' });
    expect(fetchCalls).toEqual([]);
  });

  it('resolves handles through the bsky.social resolveHandle service; an unknown handle is a bad handle', async () => {
    fetchImpl = async () =>
      new Response(JSON.stringify({ error: 'InvalidRequest', message: 'Unable to resolve handle' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    const err = await signIn('nobody.example.com').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignInError);
    expect((err as SignInError).reason).toBe('invalid-handle');
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toMatch(/^https:\/\/bsky\.social\/xrpc\/com\.atproto\.identity\.resolveHandle\?handle=nobody\.example\.com$/);
  });

  it('reports a network failure as unavailable, and logs only a sanitized cause', async () => {
    const err = await signIn('alice.example.com').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignInError);
    expect((err as SignInError).reason).toBe('unavailable');
    expect(console.error).toHaveBeenCalled();
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(' ');
    expect(logged).not.toMatch(/https?:\/\//);
  });
});

describe('logAuthFailure', () => {
  it('logs name and message only, with URLs and code/state/token values redacted', async () => {
    const { logAuthFailure } = await import('./oauth');
    logAuthFailure('session restore', new TypeError('bad https://x.test/cb?code=abc&state=def then code=zzz access_token=tok'));
    const line = String(vi.mocked(console.error).mock.calls[0][0]);
    expect(line).toContain('[auth] session restore failed: TypeError: bad');
    expect(line).not.toMatch(/abc|def|zzz|tok\b|https:/);
  });
});
