import { api } from './api';
import type { ImageDef } from '../shared/types';

export const ALICE = 'did:plc:abcdefghijklmnopqrstuvwx';
export const BOB = 'did:plc:bcdefghijklmnopqrstuvwxy';

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const image = (cid: string, alt: string): ImageDef => ({
  image: { $type: 'blob', ref: { $link: cid }, mimeType: 'image/jpeg', size: 10 },
  alt,
});

export interface Fixture {
  calls: URL[];
}

/**
 * Replaces the api fetch with a fixture. The handler gets the parsed URL and returns a body
 * (200), a Response, or undefined (404). Nothing touches the network.
 */
export function mockApi(handler: (url: URL) => unknown): Fixture {
  const calls: URL[] = [];
  api.setFetch(async (input) => {
    const url = new URL(decodeURI(String(input).replace(/%3A/gi, ':')), 'http://localhost');
    calls.push(url);
    const out = handler(url);
    if (out instanceof Response) return out;
    return out === undefined ? json({ error: 'not found' }, 404) : json(out);
  });
  return { calls };
}

export const update = (n: number, over: Record<string, unknown> = {}) => ({
  uri: `at://${ALICE}/pub.workbench.update/u${n}`,
  did: ALICE,
  rkey: `u${n}`,
  projectUri: `at://${ALICE}/pub.workbench.project/p1`,
  heading: `Update ${n}`,
  body: `Body ${n}`,
  createdAt: `2026-11-0${n}T10:00:00.000Z`,
  indexedAt: n,
  ...over,
});

export const project = (n: number, over: Record<string, unknown> = {}) => ({
  uri: `at://${ALICE}/pub.workbench.project/p${n}`,
  did: ALICE,
  rkey: `p${n}`,
  topicSlug: 'synths',
  title: `Project ${n}`,
  summary: `Summary ${n}`,
  status: 'in-progress',
  createdAt: '2026-11-01T10:00:00.000Z',
  indexedAt: n,
  ...over,
});
