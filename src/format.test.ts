import { formatDate } from './format';

const realTZ = process.env.TZ;
afterEach(() => {
  if (realTZ === undefined) delete process.env.TZ;
  else process.env.TZ = realTZ;
});

describe('formatDate', () => {
  beforeEach(() => {
    process.env.TZ = 'UTC';
  });

  it('is month first, zero padded, dot separated', () => {
    expect(formatDate('2026-11-08T12:00:00.000Z')).toBe('11.08.2026');
    expect(formatDate('2026-03-03T12:00:00Z')).toBe('03.03.2026');
    expect(formatDate('2026-12-25T12:00:00Z')).toBe('12.25.2026');
  });

  it('keeps unparseable input as is', () => {
    expect(formatDate('not a date')).toBe('not a date');
    expect(formatDate('')).toBe('');
  });

  it('uses the viewer local timezone, so a late-evening post does not jump a day', () => {
    process.env.TZ = 'America/Los_Angeles';
    // 2026-11-09T03:30Z is 7:30 pm on 11.08 in Pacific time.
    expect(formatDate('2026-11-09T03:30:00Z')).toBe('11.08.2026');
    process.env.TZ = 'Pacific/Auckland';
    expect(formatDate('2026-11-09T03:30:00Z')).toBe('11.09.2026');
  });
});
