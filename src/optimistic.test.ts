import { optimistic, type OptimisticItem } from './optimistic';

const item = (n: number, over: Partial<OptimisticItem> = {}): OptimisticItem => ({
  kind: 'update',
  uri: `at://did:plc:a/pub.workbench.update/${n}`,
  did: 'did:plc:a',
  projectUri: 'at://did:plc:a/pub.workbench.project/p',
  heading: `h${n}`,
  body: 'b',
  createdAt: `2026-11-0${n}T00:00:00Z`,
  ...over,
});

afterEach(() => optimistic.clear());

describe('optimistic', () => {
  it('puts optimistic items first, newest first, before server items', () => {
    optimistic.add(item(2));
    optimistic.add(item(3));
    const merged = optimistic.mergeWith([{ uri: 'server-1' }]);
    expect(merged.map((m) => m.uri)).toEqual([item(3).uri, item(2).uri, 'server-1']);
  });

  it('drops an optimistic item once the server returns the same uri', () => {
    optimistic.add(item(2));
    const merged = optimistic.mergeWith([{ uri: item(2).uri, from: 'server' }]);
    expect(merged).toEqual([{ uri: item(2).uri, from: 'server' }]);
  });

  it('is pure: mergeWith does not change the store or its inputs', () => {
    optimistic.add(item(2));
    const server = [{ uri: item(2).uri }];
    optimistic.mergeWith(server);
    expect(server).toHaveLength(1);
    expect(optimistic.mergeWith([]).map((m) => m.uri)).toEqual([item(2).uri]);
  });

  it('prune forgets items the server now has', () => {
    optimistic.add(item(2));
    optimistic.add(item(3));
    optimistic.prune([{ uri: item(2).uri }]);
    expect(optimistic.mergeWith([]).map((m) => m.uri)).toEqual([item(3).uri]);
  });

  it('filters by predicate', () => {
    optimistic.add(item(2));
    optimistic.add(item(3, { projectUri: 'other' }));
    const merged = optimistic.mergeWith([], (o) => o.projectUri === 'other');
    expect(merged.map((m) => m.uri)).toEqual([item(3).uri]);
  });

  it('notifies subscribers on add', () => {
    const fn = vi.fn();
    const off = optimistic.subscribe(fn);
    optimistic.add(item(2));
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    optimistic.add(item(3));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  describe('removals', () => {
    const scope = (r: { kind: string; parentUri?: string }) => r.kind === 'update' && r.parentUri === 'P';

    it('hides a removed server item and a removed optimistic item', () => {
      optimistic.add(item(2));
      optimistic.remove({ uri: item(2).uri, kind: 'update', parentUri: 'P' });
      optimistic.remove({ uri: 'server-1', kind: 'update', parentUri: 'P' });
      expect(optimistic.mergeWith([{ uri: 'server-1' }, { uri: 'server-2' }]).map((m) => m.uri)).toEqual(['server-2']);
      expect(optimistic.isRemoved('server-1')).toBe(true);
      expect(optimistic.find(item(2).uri)).toBeUndefined();
    });

    it('keeps hiding while the server still returns the uri, and expires once it stops (in scope only)', () => {
      optimistic.remove({ uri: 'server-1', kind: 'update', parentUri: 'P' });
      optimistic.prune([{ uri: 'server-1' }], scope);
      expect(optimistic.isRemoved('server-1')).toBe(true);
      optimistic.prune([], (r) => r.kind === 'reply'); // another page: not its business
      expect(optimistic.isRemoved('server-1')).toBe(true);
      optimistic.prune([{ uri: 'other' }], scope);
      expect(optimistic.isRemoved('server-1')).toBe(false);
    });
  });
});
