import { AppBskyFeedPost, jsonToLex } from '@atproto/api';
import type { Session } from '../auth/oauth';
import type { BlobRef } from '../../shared/lexicons';
import { makeFailure } from './errors';
import { resizeImage } from './image';

/** Bluesky's post text limit, in graphemes. The link is part of the text, so the caption gets what is left. */
export const CROSSPOST_MAX_GRAPHEMES = 300;
export const SITE_URL = 'https://workbench.pub';
/** app.bsky.embed.external thumbs are limited to 1,000,000 bytes. */
export const THUMB_MAX_BYTES = 1_000_000;
const THUMB_EDGE = 1000;
const TID_LENGTH = 13;

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = (s: string): string[] => (segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s));

export const graphemeLength = (s: string): number => graphemes(s).length;

/** Cuts to at most `max` graphemes, ending in an ellipsis when something was removed. */
export function truncateGraphemes(s: string, max: number): string {
  const g = graphemes(s);
  if (g.length <= max) return s;
  return g.slice(0, Math.max(0, max - 1)).join('').trimEnd() + '…';
}

/** Removes control and bidi-override characters (keeps newlines). */
export function stripControls(s: string): string {
  return s.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '');
}

export const permalink = (did: string, rkey: string): string => `${SITE_URL}/u/${did}/${rkey}`;

/** Length of the permalink, using the 13-character TID record keys the PDS assigns. */
export const linkLengthFor = (did: string): number => permalink(did, 'x'.repeat(TID_LENGTH)).length;

/** Graphemes available to the caption once the newline and the link are counted. */
export const captionBudget = (did: string): number => CROSSPOST_MAX_GRAPHEMES - linkLengthFor(did) - 1;

const oneLine = (s: string) => stripControls(s).replace(/\s+/g, ' ').trim();

/** A short default caption: `Project: Heading` (or the first line of the notes when there is no heading). */
export function buildCaption(i: { heading: string; body: string; projectTitle: string }, budget: number): string {
  const firstLine = i.body.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const what = oneLine(i.heading) || oneLine(firstLine);
  const project = oneLine(i.projectTitle);
  const caption = project && what ? `${project}: ${what}` : project || what;
  return truncateGraphemes(caption, budget);
}

export interface PostInput {
  caption: string;
  url: string;
  title: string;
  description: string;
  thumb?: BlobRef;
  createdAt: string;
}

/** The app.bsky.feed.post record: caption, newline, link; a link facet over the link's UTF-8 bytes; an external-card embed. */
export function buildPostRecord(i: PostInput): AppBskyFeedPost.Record {
  const enc = new TextEncoder();
  const room = Math.max(0, CROSSPOST_MAX_GRAPHEMES - graphemeLength(i.url) - 1);
  const caption = truncateGraphemes(stripControls(i.caption).trim(), room);
  const lead = caption ? `${caption}\n` : '';
  const text = `${lead}${i.url}`;
  const byteStart = enc.encode(lead).length;
  return {
    $type: 'app.bsky.feed.post',
    text,
    facets: [
      {
        index: { byteStart, byteEnd: byteStart + enc.encode(i.url).length },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: i.url }],
      },
    ],
    embed: {
      $type: 'app.bsky.embed.external',
      external: {
        uri: i.url,
        title: truncateGraphemes(oneLine(i.title), 200),
        description: truncateGraphemes(oneLine(i.description), 200),
        ...(i.thumb ? { thumb: i.thumb as never } : {}),
      },
    },
    createdAt: i.createdAt,
  };
}

export interface CrosspostInput {
  caption: string;
  url: string;
  title: string;
  description: string;
  /** The first photo's blob as uploaded for the update, plus the picked file to re-resize if the blob is too big. */
  thumb?: { ref: BlobRef; original: File };
}

/**
 * Posts the update to Bluesky as an external-card post. Separate from the update write: the caller
 * must only call this after the update was saved, and must not retry on failure.
 * Thumb: reuse the update's blob when it is within Bluesky's 1,000,000-byte limit; otherwise re-resize the
 * original to 1000px and upload that as its own blob; if that fails, post without a thumb.
 */
export async function createCrosspost(s: Session, i: CrosspostInput, o?: { now?: () => Date }): Promise<{ uri: string }> {
  let thumb: BlobRef | undefined;
  if (i.thumb) {
    if (i.thumb.ref.size <= THUMB_MAX_BYTES) thumb = i.thumb.ref;
    else {
      try {
        const small = await resizeImage(i.thumb.original, THUMB_EDGE);
        const res = await s.agent.com.atproto.repo.uploadBlob(new Uint8Array(await small.arrayBuffer()), { encoding: 'image/jpeg' });
        const b = res.data.blob as unknown as { toJSON?: () => unknown };
        thumb = (typeof b.toJSON === 'function' ? b.toJSON() : b) as BlobRef;
      } catch {
        thumb = undefined; // the card is still useful without a picture
      }
    }
  }
  const record = buildPostRecord({ ...i, thumb, createdAt: (o?.now?.() ?? new Date()).toISOString() });
  const valid = AppBskyFeedPost.validateRecord(jsonToLex(record)); // blobs must be in lexicon (BlobRef) form to validate
  if (!valid.success) throw makeFailure('Could not post to Bluesky. The post was not valid.', 'crosspost');
  try {
    const res = await s.agent.com.atproto.repo.createRecord({ repo: s.did, collection: 'app.bsky.feed.post', record: record as unknown as Record<string, unknown> });
    return { uri: res.data.uri };
  } catch (e) {
    throw makeFailure('Could not post to Bluesky. Please try again.', 'crosspost', e);
  }
}
