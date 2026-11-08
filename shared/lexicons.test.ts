import { describe, expect, it } from 'vitest';
import { LIMITS, normalizeSlug, validateRecord, type Collection } from './lexicons';

const now = '2026-11-07T12:00:00.000Z';
const blob = { $type: 'blob', ref: { $link: 'bafkreiabc' }, mimeType: 'image/png', size: 1234 };
const projectUri = 'at://did:plc:abc123/pub.workbench.project/3kabc';

const valid: Record<Collection, Record<string, unknown>> = {
  'pub.workbench.topic': {
    $type: 'pub.workbench.topic',
    name: 'Electronics',
    slug: 'electronics',
    description: 'Circuits and soldering',
    createdAt: now,
  },
  'pub.workbench.project': {
    $type: 'pub.workbench.project',
    title: 'Synth',
    summary: 'A small synth',
    topic: 'electronics',
    status: 'in-progress',
    cover: blob,
    createdAt: now,
  },
  'pub.workbench.update': {
    $type: 'pub.workbench.update',
    project: projectUri,
    heading: 'Day one',
    body: 'Wired it up',
    images: [{ image: blob, alt: 'the board' }],
    links: [{ url: 'https://example.com', title: 'Ref' }],
    parts: [{ item: 'Resistor', quantity: '4', note: '10k' }],
    createdAt: now,
  },
  'pub.workbench.reply': {
    $type: 'pub.workbench.reply',
    subject: 'at://did:plc:abc123/pub.workbench.update/3kxyz',
    body: 'Nice',
    createdAt: now,
  },
  'pub.workbench.follow': {
    $type: 'pub.workbench.follow',
    subject: projectUri,
    createdAt: now,
  },
};

describe('validateRecord', () => {
  for (const [collection, record] of Object.entries(valid)) {
    it(`accepts a valid ${collection}`, () => {
      expect(validateRecord(collection as Collection, record)).toEqual({ ok: true, value: record });
    });
  }

  it('accepts an update with only required fields', () => {
    const { images, links, parts, ...min } = valid['pub.workbench.update'];
    expect(validateRecord('pub.workbench.update', min).ok).toBe(true);
  });

  it('rejects a 5001-char body', () => {
    const r = validateRecord('pub.workbench.update', { ...valid['pub.workbench.update'], body: 'a'.repeat(LIMITS.body + 1) });
    expect(r.ok).toBe(false);
  });

  it('accepts a body at the limit', () => {
    const r = validateRecord('pub.workbench.update', { ...valid['pub.workbench.update'], body: 'a'.repeat(LIMITS.body) });
    expect(r.ok).toBe(true);
  });

  it('rejects 7 images', () => {
    const images = Array.from({ length: 7 }, () => ({ image: blob, alt: 'x' }));
    expect(validateRecord('pub.workbench.update', { ...valid['pub.workbench.update'], images }).ok).toBe(false);
  });

  it('rejects an invalid status', () => {
    expect(validateRecord('pub.workbench.project', { ...valid['pub.workbench.project'], status: 'banana' }).ok).toBe(false);
  });

  it('rejects a wrong $type', () => {
    expect(validateRecord('pub.workbench.project', { ...valid['pub.workbench.topic'] }).ok).toBe(false);
  });

  it('rejects non-objects and bad slugs, uris, urls and dates', () => {
    expect(validateRecord('pub.workbench.follow', null).ok).toBe(false);
    expect(validateRecord('pub.workbench.project', { ...valid['pub.workbench.project'], topic: 'Bad Slug' }).ok).toBe(false);
    expect(validateRecord('pub.workbench.update', { ...valid['pub.workbench.update'], project: 'nope' }).ok).toBe(false);
    expect(validateRecord('pub.workbench.update', { ...valid['pub.workbench.update'], links: [{ url: 'javascript:alert(1)' }] }).ok).toBe(false);
    expect(validateRecord('pub.workbench.reply', { ...valid['pub.workbench.reply'], createdAt: 'yesterday' }).ok).toBe(false);
    expect(validateRecord('pub.workbench.reply', { ...valid['pub.workbench.reply'], body: 'a'.repeat(LIMITS.replyBody + 1) }).ok).toBe(false);
  });
});

describe('normalizeSlug', () => {
  it.each(['Electronics', ' electronics ', 'ｅｌｅｃｔｒｏｎｉｃｓ'])('normalizes %j', (input) => {
    expect(normalizeSlug(input)).toBe('electronics');
  });
  it('turns spaces into hyphens and trims them', () => {
    expect(normalizeSlug('Music  Production!')).toBe('music-production');
  });
  it('returns null when it cannot be valid', () => {
    expect(normalizeSlug('!')).toBeNull();
    expect(normalizeSlug('a')).toBeNull();
  });
  it('rejects over 40 chars', () => {
    expect(normalizeSlug('a'.repeat(41))).toBeNull();
  });
});
