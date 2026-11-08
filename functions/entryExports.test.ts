import { describe, expect, it } from 'vitest';

// The Workers runtime refuses to start if an entry module has a named export that is not a
// handler or class (e.g. a constant). Entry modules must export only their default handler.
describe('Worker entry modules', () => {
  it('functions/index.ts exports only default', async () => {
    expect(Object.keys(await import('./index'))).toEqual(['default']);
  });

  it('ingest/src/index.ts exports only default', async () => {
    expect(Object.keys(await import('../ingest/src/index'))).toEqual(['default']);
  });
});
