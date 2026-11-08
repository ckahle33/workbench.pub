import { atprotoLoopbackClientMetadata, oauthClientMetadataSchema } from '@atproto/oauth-types';
import { readFileSync } from 'node:fs';
import { buildLoopbackClientId, normalizeIdentifier, OAUTH_SCOPE, PRODUCTION_CLIENT_ID } from './config';

const published = JSON.parse(readFileSync('public/client-metadata.json', 'utf8'));

describe('public/client-metadata.json', () => {
  it('is valid client metadata for a public web client', () => {
    const meta = oauthClientMetadataSchema.parse(published);
    expect(meta.client_id).toBe(PRODUCTION_CLIENT_ID);
    expect(meta.token_endpoint_auth_method).toBe('none');
    expect(meta.application_type).toBe('web');
    expect(meta.dpop_bound_access_tokens).toBe(true);
    expect(meta.response_types).toEqual(['code']);
    expect(meta.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(meta.redirect_uris).toEqual(['https://workbench.pub/']);
  });

  it('declares exactly the scope the app requests', () => {
    expect(published.scope).toBe(OAUTH_SCOPE);
  });
});

describe('OAUTH_SCOPE', () => {
  it('includes atproto, one repo scope per record collection and image blobs, no wildcards', () => {
    const parts = OAUTH_SCOPE.split(' ');
    expect(parts).toContain('atproto');
    expect(parts).toContain('blob:image/*');
    for (const c of ['topic', 'project', 'update', 'reply', 'follow']) {
      expect(parts).toContain(`repo:pub.workbench.${c}`);
    }
    expect(OAUTH_SCOPE).not.toContain('pub.workbench.*');
    expect(OAUTH_SCOPE).not.toContain('transition:');
  });
});

describe('buildLoopbackClientId', () => {
  it('maps localhost to 127.0.0.1 and carries scope and redirect_uri the library can parse', () => {
    const id = buildLoopbackClientId({ hostname: 'localhost', port: '5173' });
    const meta = atprotoLoopbackClientMetadata(id);
    expect(meta.redirect_uris).toEqual(['http://127.0.0.1:5173/']);
    expect(meta.scope).toBe(OAUTH_SCOPE);
    expect(meta.token_endpoint_auth_method).toBe('none');
  });
});

describe('normalizeIdentifier', () => {
  it.each([
    ['alice.bsky.social', 'alice.bsky.social'],
    ['  @Alice.Bsky.Social ', 'alice.bsky.social'],
    ['did:plc:ewvi7nxzyoun6zhxrhs64oiz', 'did:plc:ewvi7nxzyoun6zhxrhs64oiz'],
  ])('accepts %j', (input, out) => expect(normalizeIdentifier(input)).toBe(out));

  it.each(['', '   ', 'alice', 'not a handle', 'https://evil.example/x', 'did:plc:', 'a@b.com', 'x.y/z'])(
    'rejects %j',
    (input) => expect(normalizeIdentifier(input)).toBeNull(),
  );
});
