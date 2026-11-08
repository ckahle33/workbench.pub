import { Agent } from '@atproto/api';
import { BrowserOAuthClient, type OAuthSession } from '@atproto/oauth-client-browser';
import { buildLoopbackClientId, HANDLE_RESOLVER, isLoopbackHost, normalizeIdentifier, PRODUCTION_CLIENT_ID } from './config';

export interface Session {
  did: string;
  handle: string;
  agent: Agent;
}

let clientPromise: Promise<BrowserOAuthClient> | null = null;
let restorePromise: Promise<Session | null> | null = null;
let current: OAuthSession | null = null;

/**
 * Why sign-in failed: `invalid-handle` means the input is not a handle/DID or does not resolve
 * to an account; `unavailable` is anything else (network, authorization server, configuration).
 */
export type SignInFailure = 'invalid-handle' | 'unavailable';

export class SignInError extends Error {
  readonly reason: SignInFailure;
  constructor(reason: SignInFailure) {
    super(reason === 'invalid-handle' ? 'Invalid handle' : 'Sign-in unavailable');
    this.name = 'SignInError';
    this.reason = reason;
  }
}

/**
 * Logs a failure for operators with the error name and message only. URLs (which can carry
 * OAuth `code`/`state` parameters) and anything after `code=`/`state=`/`token` are redacted.
 */
export function logAuthFailure(context: string, err: unknown): void {
  const name = err instanceof Error ? err.name : typeof err;
  const message = err instanceof Error ? err.message : '';
  const clean = message
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
    .replace(/\b(code|state|iss|[a-z_]*token)=\S*/gi, '$1=[redacted]')
    .slice(0, 200);
  console.error(`[auth] ${context} failed: ${name}: ${clean}`);
}

/** True when the identity (handle or DID) did not resolve, as opposed to a service failure. */
function isUnresolvedIdentity(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    if (e.name === 'IdentityResolverError') return true;
  }
  return false;
}

/** Exposed for tests: the memoized real client. */
export function loadOAuthClient(): Promise<BrowserOAuthClient> {
  return getClient();
}

function getClient(): Promise<BrowserOAuthClient> {
  clientPromise ??= BrowserOAuthClient.load({
    clientId: isLoopbackHost(window.location.hostname)
      ? buildLoopbackClientId(window.location)
      : PRODUCTION_CLIENT_ID,
    // Required: without a handle or identity resolver the OAuthClient constructor throws.
    handleResolver: HANDLE_RESOLVER,
  });
  clientPromise.catch(() => {
    clientPromise = null;
  });
  return clientPromise;
}

/** Starts the redirect to the user's authorization server. Navigates away on success. */
export async function signIn(input: string): Promise<void> {
  const handle = normalizeIdentifier(input);
  if (!handle) throw new SignInError('invalid-handle');
  try {
    const client = await getClient();
    await client.signInRedirect(handle);
  } catch (err) {
    logAuthFailure('sign-in', err);
    throw new SignInError(isUnresolvedIdentity(err) ? 'invalid-handle' : 'unavailable');
  }
}

async function toSession(oauthSession: OAuthSession): Promise<Session> {
  const agent = new Agent(oauthSession);
  let handle = oauthSession.sub as string;
  try {
    const res = await agent.com.atproto.repo.describeRepo({ repo: oauthSession.sub });
    handle = res.data.handle;
  } catch {
    // Fall back to the DID; the handle is display-only.
  }
  return { did: oauthSession.sub, handle, agent };
}

/**
 * Finishes a login if the URL carries OAuth callback parameters, otherwise
 * restores the previous session. Memoized: React StrictMode runs effects twice
 * and a callback code can only be exchanged once.
 */
export function restoreSession(): Promise<Session | null> {
  restorePromise ??= (async () => {
    const client = await getClient();
    const result = await client.init();
    if (!result) return null;
    current = result.session;
    if (window.location.hash || window.location.search.includes('code=')) {
      // Drop callback parameters from the address bar.
      window.history.replaceState(null, '', window.location.pathname);
    }
    return toSession(result.session);
  })();
  restorePromise.catch((err: unknown) => {
    logAuthFailure('session restore', err);
    restorePromise = null;
  });
  return restorePromise;
}

/** Revokes the session at the authorization server and forgets it locally. */
export async function signOut(): Promise<void> {
  const session = current;
  current = null;
  restorePromise = null;
  if (session) await session.signOut();
}
