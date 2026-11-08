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
});
