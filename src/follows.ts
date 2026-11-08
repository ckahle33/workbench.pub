/**
 * The follow record uri for a subject, remembered per signed-in did. There is no API for "my
 * follows" yet, so this is the only source of follow state; localStorage with an in-memory fallback.
 */
const memory = new Map<string, string>();
const store = (): Storage => window.localStorage;
const k = (did: string, kind: string, subject: string) => `wb.follow:${did}:${kind}:${subject}`;

export function getFollow(did: string, kind: string, subject: string): string | null {
  const key = k(did, kind, subject);
  try {
    return store().getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export function setFollow(did: string, kind: string, subject: string, uri: string): void {
  const key = k(did, kind, subject);
  memory.set(key, uri);
  try {
    store().setItem(key, uri);
  } catch {
    /* memory only */
  }
}

export function clearFollow(did: string, kind: string, subject: string): void {
  const key = k(did, kind, subject);
  memory.delete(key);
  try {
    store().removeItem(key);
  } catch {
    /* ignore */
  }
}
