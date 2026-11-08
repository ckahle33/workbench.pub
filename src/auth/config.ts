import { isValidDid, isValidHandle } from '@atproto/syntax';

// Granular scopes (https://atproto.com/specs/permission). Collection wildcards
// such as `repo:pub.workbench.*` are not supported by the spec, so every record
// collection is listed. Keep in sync with public/client-metadata.json (tested).
export const OAUTH_SCOPE = [
  'atproto',
  'repo:pub.workbench.topic',
  'repo:pub.workbench.project',
  'repo:pub.workbench.update',
  'repo:pub.workbench.reply',
  'repo:pub.workbench.follow',
  // Optional cross-post of an update to the user's Bluesky feed. Syntax from https://atproto.com/specs/permission
  // (repo:<collection>?action=create): create only, no update or delete of their Bluesky posts.
  'repo:app.bsky.feed.post?action=create',
  'blob:image/*',
].join(' ');

/** com.atproto.identity.resolveHandle service the OAuth client uses to turn handles into DIDs. */
export const HANDLE_RESOLVER = 'https://bsky.social';

export const PRODUCTION_CLIENT_ID = 'https://workbench.pub/client-metadata.json';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname);
}

/**
 * Loopback client id for local development. The origin is always
 * `http://localhost`; the redirect URI must use 127.0.0.1 (RFC 8252), keeps the
 * dev server port, and returns to the site root where the app finishes login.
 */
export function buildLoopbackClientId(location: { hostname: string; port: string }): string {
  const host = location.hostname === 'localhost' ? '127.0.0.1' : location.hostname;
  const redirect = `http://${host}${location.port ? `:${location.port}` : ''}/`;
  const params = new URLSearchParams({ scope: OAUTH_SCOPE, redirect_uri: redirect });
  return `http://localhost?${params.toString()}`;
}

/** Returns a clean handle or DID, or null if the input is not plausibly either. */
export function normalizeIdentifier(input: string): string | null {
  const value = input.trim().replace(/^@/, '');
  if (isValidDid(value)) return value;
  const handle = value.toLowerCase();
  return isValidHandle(handle) ? handle : null;
}
