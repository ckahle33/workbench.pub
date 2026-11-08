/**
 * Wraps a D1 binding so every query is counted. Workers Free allows 50 D1 queries per invocation, and a
 * `db.batch` counts as 1 however many statements it holds. With `limit` set the wrapper also throws once more than
 * `limit` queries have been issued, mimicking the platform (used by tests); without it, it only counts.
 */
export function countQueries(real: D1Database, limit?: number): { db: D1Database; used(): number } {
  let count = 0;
  const realOf = new WeakMap<object, D1PreparedStatement>();
  const spend = () => {
    if (limit !== undefined && ++count > limit) throw new Error('Too many API requests by single Worker invocation.');
    if (limit === undefined) count++;
  };
  const wrap = (st: D1PreparedStatement): D1PreparedStatement => {
    const w = {
      bind: (...a: unknown[]) => wrap(st.bind(...a)),
      run: () => (spend(), st.run()),
      first: (c?: string) => (spend(), st.first(c as never)),
      all: () => (spend(), st.all()),
      raw: () => (spend(), st.raw()),
    } as unknown as D1PreparedStatement;
    realOf.set(w, st);
    return w;
  };
  const db = {
    prepare: (sql: string) => wrap(real.prepare(sql)),
    batch: (sts: D1PreparedStatement[]) => (spend(), real.batch(sts.map((x) => realOf.get(x) ?? x))),
    exec: (sql: string) => (spend(), real.exec(sql)),
  } as unknown as D1Database;
  return { db, used: () => count };
}
