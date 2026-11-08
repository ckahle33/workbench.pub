import type { Env } from './read';

// Used when IP_HASH_SALT is not configured; still keeps raw IPs out of the database.
const DEFAULT_SALT = 'workbench.pub/report-ip/v1';

const enc = new TextEncoder();

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Salted SHA-256 of the client IP; the raw IP is never stored. */
export async function hashIp(env: Pick<Env, 'IP_HASH_SALT'>, ip: string): Promise<string> {
  return hex(await sha256(`${env.IP_HASH_SALT || DEFAULT_SALT}:${ip}`));
}

/** The connecting client's IP as Cloudflare reports it. */
export const clientIp = (header: (name: string) => string | undefined): string => header('CF-Connecting-IP') ?? 'unknown';
