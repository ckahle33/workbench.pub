import { plainImages } from './blobs';

describe('plainImages', () => {
  it('turns a CID object ref into a plain string $link', () => {
    const cid = { toString: () => 'bafyCID', code: 85 };
    const out = plainImages([{ image: { $type: 'blob', ref: { $link: cid }, mimeType: 'image/jpeg', size: 3 }, alt: 'a' }]);
    expect(out[0].image.ref.$link).toBe('bafyCID');
    expect(JSON.parse(JSON.stringify(out))[0].image.ref.$link).toBe('bafyCID');
  });

  it('handles a ref that is itself a CID, and keeps plain strings', () => {
    const out = plainImages([
      { image: { $type: 'blob', ref: { toString: () => 'bafyTwo' }, mimeType: 'image/png', size: 1 }, alt: 'b' },
      { image: { $type: 'blob', ref: { $link: 'bafyThree' }, mimeType: 'image/png', size: 1 }, alt: 'c' },
    ]);
    expect(out.map((i) => i.image.ref.$link)).toEqual(['bafyTwo', 'bafyThree']);
    expect(out.map((i) => i.alt)).toEqual(['b', 'c']);
  });

  it('drops entries without a usable cid', () => {
    expect(plainImages([{ image: { ref: {} }, alt: 'x' }, null, 5])).toEqual([]);
    expect(plainImages(undefined)).toEqual([]);
  });
});
