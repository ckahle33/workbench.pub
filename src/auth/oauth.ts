import { Agent } from '@atproto/api';
import { BrowserOAuthClient, type OAuthSession } from '@atproto/oauth-client-browser';
import { buildLoopbackClientId, isLoopbackHost, PRODUCTION_CLIENT_ID } from './config';

export interface Session {
  did: string;
  handle: string;
  agent: Agent;
}

let clientPromise: Promise<BrowserOAuthClient> | null = null;
let restorePromise: Promise<Session | null> | null = null;
let current: OAuthSession | null = null;

function getClient(): Promise<BrowserOAuthClient> {
  clientPromise ??= BrowserOAuthClient.load({
    clientId: isLoopbackHost(window.location.hostname)
      ? buildLoopbackClientId(window.location)
      : PRODUCTION_CLIENT_ID,
  });
  clientPromise.catch(() => {
    clientPromise = null;
  });
  return clientPromise;
}

/** Starts the redirect to the user's authorization server. Navigates away on success. */
export async function signIn(handle: string): Promise<void> {
  const client = await getClient();
  await client.signInRedirect(handle);
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
  restorePromise.catch(() => {
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
