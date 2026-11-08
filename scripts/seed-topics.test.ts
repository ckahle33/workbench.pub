import { describe, expect, it } from 'vitest';
import type { Session } from '../src/auth/oauth';
import { LIMITS, normalizeSlug } from '../shared/lexicons';
import { readSeedEnv, SEED_TOPICS, seed } from './seed-topics';

interface Stored {
  slug: string;
}

/** Fake account: createRecord stores topics, listRecords pages through them. */
function fakeSession(opts: { pageSize?: number; existing?: string[]; failOnCreate?: number } = {}) {
  const records: Stored[] = (opts.existing ?? []).map((slug) => ({ slug }));
  let creates = 0;
  const agent = {
    com: {
      atproto: {
        repo: {
          async listRecords(p: { repo: string; collection: string; limit?: number; cursor?: string }) {
            expect(p.collection).toBe('pub.workbench.topic');
            const size = opts.pageSize ?? 100;
            const start = p.cursor ? Number(p.cursor) : 0;
            const page = records.slice(start, start + size);
            const next = start + size < records.length ? String(start + size) : undefined;
            return {
              data: {
                cursor: next,
                records: page.map((r, i) => ({ uri: `at://did:plc:x/pub.workbench.topic/${start + i}`, cid: 'c', value: r })),
              },
            };
          },
          async createRecord(p: { collection: string; record: Stored }) {
            creates += 1;
            if (opts.failOnCreate === creates) throw new Error('boom');
            records.push({ slug: p.record.slug });
            return { data: { uri: `at://did:plc:x/${p.collection}/${creates}`, cid: 'c' } };
          },
        },
      },
    },
  };
  const session = { did: 'did:plc:x', handle: 'site.workbench.pub', agent } as unknown as Session;
  return { session, records, creates: () => creates };
}

describe('SEED_TOPICS', () => {
  it('has exactly the six expected slugs, each stable under normalizeSlug', () => {
    expect(SEED_TOPICS.map((t) => t.slug)).toEqual([
      'electronics',
      'music-production',
      'ceramics',
      'woodworking',
      'illustration',
      '3d-printing',
    ]);
    for (const t of SEED_TOPICS) {
      expect(normalizeSlug(t.slug)).toBe(t.slug);
      expect(normalizeSlug(t.name)).toBe(t.slug);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.description.length).toBeLessThanOrEqual(LIMITS.summary);
    }
  });
});

describe('seed', () => {
  it('creates six records on an empty account and none on a second call', async () => {
    const { session, records } = fakeSession();
    expect(await seed(session)).toHaveLength(6);
    expect(await seed(session)).toEqual([]);
    expect(records).toHaveLength(6);
  });

  it('skips existing slugs, including across paginated listings', async () => {
    const { session, records } = fakeSession({
      pageSize: 2,
      existing: ['other', 'ceramics', 'more', 'electronics', 'woodworking'],
    });
    const created = await seed(session);
    expect(created).toEqual(['music-production', 'illustration', '3d-printing']);
    expect(records).toHaveLength(8);
  });

  it('stops at the first failure and names the slug and earlier successes, without secrets', async () => {
    const { session, creates } = fakeSession({ failOnCreate: 3 });
    const err = await seed(session).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain('ceramics');
    expect(err!.message).toContain('electronics');
    expect(err!.message).toContain('music-production');
    expect(err!.message).not.toContain('hunter2');
    expect(creates()).toBe(3);
  });
});

describe('readSeedEnv', () => {
  it('refuses when either variable is missing', () => {
    expect(() => readSeedEnv({})).toThrow(/SEED_IDENTIFIER/);
    expect(() => readSeedEnv({ SEED_IDENTIFIER: 'a.b' })).toThrow(/SEED_APP_PASSWORD/);
    expect(() => readSeedEnv({ SEED_APP_PASSWORD: 'hunter2' })).toThrow(/SEED_IDENTIFIER/);
    expect(() => readSeedEnv({ SEED_IDENTIFIER: ' ', SEED_APP_PASSWORD: 'hunter2' })).toThrow(/SEED_IDENTIFIER/);
  });

  it('returns both values when set', () => {
    expect(readSeedEnv({ SEED_IDENTIFIER: 'a.b', SEED_APP_PASSWORD: 'hunter2' })).toEqual({
      identifier: 'a.b',
      password: 'hunter2',
    });
  });
});
