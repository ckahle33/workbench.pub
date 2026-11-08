/**
 * Makes untrusted user text safe and short for a meta tag (functions/shareMeta.ts).
 *
 * CPU is bounded by `max`, not by the input: the input is cut to `max * 8` UTF-16 units BEFORE any
 * other work (a grapheme cluster longer than 8 units is rare: emoji ZWJ sequences, stacked
 * combining marks), and segmentation stops after `max` graphemes. An update body can be 50 KB and
 * the Free plan allows 10 ms of CPU per request.
 */

// C0/C1 controls and bidi embedding, override and isolate marks (they can visually reorder the
// rest of a preview line), plus the BOM. Ordinary RTL text is kept.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/g;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
/** UTF-16 units kept per allowed grapheme before cleaning. */
const UNITS_PER_GRAPHEME = 8;

/**
 * Well-formed UTF-16 (lone surrogates, including one left by the cap, become U+FFFD), whitespace
 * collapsed to single spaces, control and bidi-control characters removed, at most `max`
 * graphemes; when anything was dropped the result ends in an ellipsis and still fits in `max`.
 * Escaping is the caller's job.
 */
export function cleanText(input: string, max: number): string {
  const cap = max * UNITS_PER_GRAPHEME;
  const capped = input.length > cap;
  const s = (capped ? input.slice(0, cap) : input)
    .replace(LONE_SURROGATE, '\ufffd')
    .replace(/\s+/g, ' ')
    .replace(CONTROL, '')
    .replace(/\s+/g, ' ')
    .trim();
  const kept: string[] = [];
  let more = false;
  for (const g of segmenter.segment(s)) {
    if (kept.length === max) {
      more = true;
      break;
    }
    kept.push(g.segment);
  }
  if (!more && !capped) return s;
  return kept.slice(0, Math.min(kept.length, max - 1)).join('').trimEnd() + '\u2026';
}
