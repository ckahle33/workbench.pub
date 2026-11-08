import { describe, expect, it, vi } from 'vitest';
import { browserBackend, fitWithin, ImageTooLargeError, MAX_INPUT_BYTES, resizeImage, type ImageBackend } from './image';

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

  it('releases the decoded source after encoding, and also when encoding fails', async () => {
    const release = vi.fn();
    const ok: ImageBackend = {
      decode: vi.fn().mockResolvedValue({ width: 10, height: 10, source: 'bmp' }),
      encode: vi.fn().mockResolvedValue(new Blob()),
      release,
    };
    await resizeImage(file, 1600, ok);
    expect(release).toHaveBeenCalledWith('bmp');
    const failing: ImageBackend = { ...ok, encode: vi.fn().mockRejectedValue(new Error('x')) };
    await expect(resizeImage(file, 1600, failing)).rejects.toThrow('Could not process this image');
    expect(release).toHaveBeenCalledTimes(2);
  });

  it(`rejects files over ${MAX_INPUT_BYTES / 1024 / 1024} MB before decoding`, async () => {
    const decode = vi.fn();
    const big = new File(['x'], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: MAX_INPUT_BYTES + 1 });
    const err = await resizeImage(big, 1600, { decode, encode: vi.fn() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImageTooLargeError);
    expect(decode).not.toHaveBeenCalled();
  });
});

describe('browserBackend', () => {
  afterEach(() => vi.restoreAllMocks());

  it('closes the bitmap on release', () => {
    const bitmap = { width: 1, height: 1, close: vi.fn() };
    browserBackend.release?.(bitmap);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it('fills the canvas white before drawing (no black transparency) and releases the canvas', async () => {
    const calls: string[] = [];
    const ctx = {
      set fillStyle(v: string) { calls.push(`fillStyle=${v}`); },
      fillRect: (...a: number[]) => calls.push(`fillRect ${a.join(',')}`),
      drawImage: () => calls.push('drawImage'),
    };
    let canvas: HTMLCanvasElement | undefined;
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = create(tag);
      if (tag === 'canvas') {
        canvas = el as HTMLCanvasElement;
        (el as HTMLCanvasElement).getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
        (el as HTMLCanvasElement).toBlob = (cb: BlobCallback) => cb(new Blob(['j'], { type: 'image/jpeg' }));
      }
      return el;
    });
    const out = await browserBackend.encode({}, { width: 30, height: 20 }, 'image/jpeg', 0.85);
    expect(out.type).toBe('image/jpeg');
    expect(calls).toEqual(['fillStyle=#ffffff', 'fillRect 0,0,30,20', 'drawImage']);
    expect(canvas!.width).toBe(0);
    expect(canvas!.height).toBe(0);
  });
});
