import { describe, expect, it } from 'vitest';
import { cleanText } from './cleanText';

const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length;

describe('cleanText', () => {
  it('strips control characters, collapses whitespace and truncates by graphemes', () => {
    expect(cleanText('a\u0000b\u0007c\u001b[31m', 70)).toBe('abc[31m');
    expect(cleanText('  one\n\ttwo \r\n three  ', 70)).toBe('one two three');
    expect(cleanText('abcdef', 4)).toBe('abc…');
    expect(cleanText('abcd', 4)).toBe('abcd');
    expect(cleanText('👩🏽‍🔧👩🏽‍🔧👩🏽‍🔧', 2)).toBe('👩🏽‍🔧…');
    expect(cleanText('ab\u202ecd\u2066ef\ufeff', 70)).toBe('abcdef');
    expect(cleanText('\ud800lone', 70)).toBe('\ufffdlone');
    expect(cleanText('word word word', 11)).toBe('word word…');
  });

  it('marks text as cut when the input cap removed content, even if what is left is short', () => {
    // 2,000 spaces then text: the cap (max * 8 chars) keeps only spaces, which collapse to nothing.
    expect(cleanText(' '.repeat(2000) + 'hidden tail', 70)).toBe('…');
    expect(cleanText('a' + ' '.repeat(1000) + 'tail', 70)).toBe('a…');
  });

  it('repairs a surrogate pair split by the input cap', () => {
    const s = 'a'.repeat(7) + '😀'.repeat(10); // cap for max 1 is 8 chars: 7 'a' + a lone high surrogate
    const out = cleanText(s, 1);
    expect(out).toBe('…');
    expect(cleanText('a'.repeat(15) + '😀', 2)).toBe('a…');
    expect(/[\ud800-\udfff]/.test(cleanText('x'.repeat(1599) + '😀', 200).replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''))).toBe(false);
  });

  const big = {
    ascii: 'word '.repeat(10_000), // 50,000 chars
    multibyte: 'مشروع جديد 👩🏽‍🔧 ḉ \u202e'.repeat(2500), // ~50,000 UTF-16 units of RTL, emoji ZWJ, combining marks, bidi
    noSpaces: 'x'.repeat(50_000),
  };

  for (const [name, input] of Object.entries(big)) {
    it(`handles a 50,000-character ${name} body in bounded time and output`, () => {
      expect(input.length).toBeGreaterThanOrEqual(45_000);
      for (let i = 0; i < 5; i++) cleanText(input, 200); // warm up
      const runs = 50;
      const t0 = performance.now();
      let out = '';
      for (let i = 0; i < runs; i++) out = cleanText(input, 200);
      const perCall = (performance.now() - t0) / runs;
      expect(perCall).toBeLessThan(5);
      expect(graphemes(out)).toBeLessThanOrEqual(200);
      expect(out.endsWith('…')).toBe(true);
      expect(out).not.toMatch(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/);
      expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(out)).toBe(false);
    });
  }

  it('work does not grow with input size (1 KB vs 1 MB input cost about the same)', () => {
    const small = 'word '.repeat(200);
    const huge = 'word '.repeat(200_000);
    const time = (s: string) => {
      for (let i = 0; i < 5; i++) cleanText(s, 200);
      const t0 = performance.now();
      for (let i = 0; i < 50; i++) cleanText(s, 200);
      return (performance.now() - t0) / 50;
    };
    const ts = time(small);
    const th = time(huge);
    expect(th).toBeLessThan(Math.max(ts * 5, 0.5));
  });
});
