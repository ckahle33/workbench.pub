import '@testing-library/jest-dom/vitest';

// Node's experimental global localStorage warns (and does not work) without --localstorage-file;
// give tests a plain in-memory Storage instead.
const memoryStorage = (): Storage => {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
};
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
