/**
 * DEV ONLY. Generated placeholder images for the local demo seed (scripts/dev-seed.sql).
 *
 * Reached only when the Worker env has DEV_PLACEHOLDERS === '1' (set in the gitignored .dev.vars,
 * never in wrangler.toml) AND the DID starts with `did:plc:demo` AND the CID looks like
 * `ph-<ratio>-<seed>`. Production never sets the var, so this branch cannot serve anything there.
 * SVG is deliberately not in the blob proxy's image allowlist; this is the only SVG we ever serve,
 * we generate it ourselves, and it carries a sandboxing CSP.
 */

export const DEMO_DID_PREFIX = 'did:plc:demo';
const PLACEHOLDER_CID = /^ph-(43|32|11|34)-[a-z0-9]{1,16}$/;

const RATIOS: Record<string, { w: number; h: number; label: string }> = {
  '43': { w: 1200, h: 900, label: '4:3' },
  '32': { w: 1200, h: 800, label: '3:2' },
  '11': { w: 1000, h: 1000, label: '1:1' },
  '34': { w: 900, h: 1200, label: '3:4' },
};

// Workprint palette. Kept here (not in the app's CSS tokens) because this is a server-side image.
const INK = '#111111';
const PAPER = '#ffffff';
const PANEL = '#f2f2f2';
const GREY = '#9a9a9a';
const LIGHT = '#c7c7c7';
const ACCENT = '#d0201a';

export function placeholderEnabled(env: { DEV_PLACEHOLDERS?: string }, did: string, cid: string): boolean {
  return env.DEV_PLACEHOLDERS === '1' && did.startsWith(DEMO_DID_PREFIX) && PLACEHOLDER_CID.test(cid);
}

/** Small deterministic PRNG (mulberry32) seeded from the CID, so each placeholder is stable. */
function rng(seed: string): () => number {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (Math.imul(a ^ seed.charCodeAt(i), 2654435761) + i) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A flat Swiss-style composition: a grid of black/grey blocks, one red block, a mono label. */
export function placeholderSvg(cid: string): string {
  const ratio = RATIOS[PLACEHOLDER_CID.exec(cid)![1]];
  const { w, h } = ratio;
  const r = rng(cid);
  const dark = r() < 0.35;
  const bg = dark ? INK : r() < 0.5 ? PANEL : PAPER;
  const fills = dark ? [PAPER, GREY, LIGHT] : [INK, INK, GREY, LIGHT];
  const cols = 6;
  const rows = Math.round((cols * h) / w);
  const pad = Math.round(w * 0.06);
  const gap = Math.round(w * 0.012);
  const cw = (w - pad * 2 - gap * (cols - 1)) / cols;
  const ch = (h - pad * 2 - gap * (rows - 1) - 40) / rows;
  const rects: string[] = [];
  const accentAt = Math.floor(r() * 5);
  let placed = 0;
  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      const span = Math.min(cols - x, 1 + Math.floor(r() * 3));
      if (r() < 0.55) {
        const fill = placed === accentAt ? ACCENT : fills[Math.floor(r() * fills.length)];
        placed++;
        const px = pad + x * (cw + gap);
        const py = pad + y * (ch + gap);
        rects.push(`<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${(span * cw + (span - 1) * gap).toFixed(1)}" height="${ch.toFixed(1)}" fill="${fill}"/>`);
      }
      x += span;
    }
  }
  if (placed <= accentAt) rects.push(`<rect x="${pad}" y="${pad}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" fill="${ACCENT}"/>`);
  const text = dark ? PAPER : INK;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${bg}"/>${rects.join('')}` +
    `<text x="${pad}" y="${h - pad / 2}" fill="${text}" font-family="'IBM Plex Mono', Menlo, monospace" font-size="${Math.round(w / 50)}" letter-spacing="1">PLACEHOLDER ${ratio.label}</text>` +
    `</svg>`
  );
}

export function placeholderResponse(cid: string): Response {
  return new Response(placeholderSvg(cid), {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
