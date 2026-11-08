/** Where in a write a failure happened. */
export type Stage = 'validate' | 'upload' | 'create' | 'delete' | 'after-write';

export interface FailureInfo {
  stage: Stage;
  /** XRPC/HTTP status; 1 means no response at all (network). */
  status?: number;
  /** XRPC error name such as InvalidToken, ScopeMissing, RateLimitExceeded. */
  errorName?: string;
  /** The server's short message, sanitized. */
  serverMessage?: string;
  /** The server answered 2xx but the reply could not be read: the write probably happened. */
  maybeSaved?: boolean;
}

/** A failed write. `message` is a fixed, safe sentence; the fields are for diagnosis. */
export class WriteError extends Error implements FailureInfo {
  readonly stage: Stage;
  readonly status?: number;
  readonly errorName?: string;
  readonly serverMessage?: string;
  readonly maybeSaved?: boolean;
  constructor(message: string, info: FailureInfo) {
    super(message);
    this.name = 'WriteError';
    Object.assign(this, info);
    this.stage = info.stage;
  }
}

/** Strips URLs (which can carry OAuth code/state), token-like values and control characters; truncates. */
export function sanitize(text: unknown, max = 120): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
    .replace(/\b(code|state|iss|[a-z_]*token)=\S*/gi, '$1=[redacted]')
    .replace(/\b(Bearer|DPoP)\s+\S+/gi, '$1 [redacted]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '[jwt]')
    .replace(/[^\x20-\x7e]/g, ' ')
    .slice(0, max);
}

/** Reads status, error name and short message from whatever the agent or OAuth layer threw. */
export function describeThrown(e: unknown): Omit<FailureInfo, 'stage'> {
  if (typeof e !== 'object' || e === null) return {};
  const o = e as { status?: unknown; error?: unknown; name?: unknown; message?: unknown; responseBody?: unknown };
  const status = typeof o.status === 'number' ? o.status : undefined;
  // A 2xx reply that could not be read: 'Invalid Response' (schema check) or 'InvalidResponse' (malformed body).
  const isInvalidResponse = o.name === 'XRPCInvalidResponseError' || o.error === 'Invalid Response' || o.error === 'InvalidResponse';
  const errorName =
    typeof o.error === 'string' && o.error
      ? sanitize(o.error.replace(/\s+/g, ''), 60)
      : typeof o.name === 'string' && o.name !== 'Error'
        ? sanitize(o.name, 60)
        : e instanceof TypeError
          ? 'NetworkError'
          : undefined;
  return {
    status: status ?? (e instanceof TypeError ? 1 : undefined),
    errorName,
    serverMessage: sanitize(o.message) || undefined,
    maybeSaved: isInvalidResponse || undefined,
  };
}

/** One sanitized line per failure: stage, status, error name and the server's short message only. */
export function logFailure(info: FailureInfo): void {
  console.error(
    `[write] stage=${info.stage} status=${info.status ?? 'none'} error=${info.errorName ?? 'none'} message="${sanitize(info.serverMessage)}"`,
  );
}

const SESSION_NAMES = /^(InvalidToken|ExpiredToken|AuthenticationRequired|AuthMissing|TokenRefreshError|TokenRevokedError|OAuthResponseError|AuthRequired|InvalidDpopProof|UseDpopNonce)$/i;
const SCOPE_NAMES = /^(ScopeMissing|InsufficientScope|InvalidScope|Forbidden)$/i;

/** What the person can do about it, in plain language. */
export function recoveryHint(i: FailureInfo): string {
  const name = i.errorName ?? '';
  // Only creating can have produced a record; an unreadable upload or delete reply is safe to retry.
  if (i.maybeSaved && i.stage === 'create') return 'It may have been saved. Check before trying again, so you do not post it twice.';
  if (i.status === 1 || name === 'NetworkError') return 'Check your internet connection and try again.';
  if (i.status === 429 || /RateLimit/i.test(name)) return 'You are doing this too often. Wait a few minutes and try again.';
  if (SCOPE_NAMES.test(name) || i.status === 403) return 'workbench.pub was not given permission to do this. Sign out, then sign in again and accept the permissions.';
  if (SESSION_NAMES.test(name) || i.status === 401) return 'Your session has expired. Sign in again.';
  if (i.stage === 'validate') return 'Check what you entered and try again.';
  if (i.status !== undefined && i.status >= 500) return 'The server had a problem. Try again in a moment.';
  return 'Try again.';
}

/** The sentence shown to the person, with a short code they can paste when reporting a problem. */
export function failureMessage(action: string, i: FailureInfo): string {
  const code = i.stage === 'validate' ? `(${i.stage})` : `The server said: ${i.errorName ?? (i.status ? `HTTP ${i.status}` : 'no response')} (${i.stage}).`;
  return `Could not ${action}. ${code} ${recoveryHint(i)}`;
}
