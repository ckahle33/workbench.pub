import { describe, expect, it, vi } from 'vitest';
import { fitWithin, resizeImage, type ImageBackend } from './image';

describe('fitWithin', () => {
  it('scales landscape by width', () => {
    expect(fitWithin(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 });
  });
  it('scales portrait by height', () => {
    expect(fitWithin(1000, 4000, 1600)).toEqual({ width: 400, height: 1600 });
  });
  it('never upscales', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
  it('keeps an exact fit', () => {
    expect(fitWithin(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
  });
  it('never rounds a dimension to zero', () => {
    expect(fitWithin(10000, 1, 1600).height).toBe(1);
  });
  it.each([[0, 10], [10, 0], [NaN, 10], [10, Infinity], [-5, 10]])('rejects %s x %s', (w, h) => {
    expect(() => fitWithin(w, h, 1600)).toThrow(RangeError);
  });
  it('rejects a bad maxEdge', () => {
    expect(() => fitWithin(10, 10, 0)).toThrow(RangeError);
  });
});

describe('resizeImage', () => {
  const file = new File(['x'], 'a.png', { type: 'image/png' });

  it('encodes to JPEG at the fitted size', async () => {
    const out = new Blob(['jpeg'], { type: 'image/jpeg' });
    const backend: ImageBackend = {
      decode: vi.fn().mockResolvedValue({ width: 4000, height: 3000, source: 'bmp' }),
      encode: vi.fn().mockResolvedValue(out),
    };
    await expect(resizeImage(file, 1600, backend)).resolves.toBe(out);
    expect(backend.encode).toHaveBeenCalledWith('bmp', { width: 1600, height: 1200 }, 'image/jpeg', 0.85);
  });

  it('uses 1600 by default', async () => {
    const backend: ImageBackend = {
      decode: vi.fn().mockResolvedValue({ width: 3200, height: 3200, source: 's' }),
      encode: vi.fn().mockResolvedValue(new Blob()),
    };
    await resizeImage(file, undefined, backend);
    expect(backend.encode).toHaveBeenCalledWith('s', { width: 1600, height: 1600 }, 'image/jpeg', 0.85);
  });

  it('throws a safe error when decoding fails', async () => {
    const backend: ImageBackend = {
      decode: vi.fn().mockRejectedValue(new Error('secret internals')),
      encode: vi.fn(),
    };
    await expect(resizeImage(file, 1600, backend)).rejects.toThrow('Could not process this image');
  });
});
