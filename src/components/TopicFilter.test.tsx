import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { mockApi } from '../testUtils';
import { TopicFilter } from './TopicFilter';

const topic = (n: number) => ({ uri: `at://x/t/${n}`, slug: `t-${String(n).padStart(3, '0')}`, name: `Topic ${n}`, description: '' });
const pageOf = (from: number) => Array.from({ length: 20 }, (_, i) => topic(from + i));

function serve(pages: number) {
  return mockApi((u) => {
    if (u.pathname !== '/api/topics') return undefined;
    const cursor = u.searchParams.get('cursor');
    const n = cursor ? Number(cursor) : 0;
    return { items: pageOf(n * 20), cursor: n + 1 < pages ? String(n + 1) : null };
  });
}

const ui = (current?: string) => (
  <MemoryRouter>
    <TopicFilter current={current} />
  </MemoryRouter>
);

describe('TopicFilter', () => {
  it('keeps loading pages until the current topic beyond the first page is found', async () => {
    const fx = serve(5);
    render(ui('t-065'));
    const link = await screen.findByRole('link', { name: 'Topic 65' });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(fx.calls.length).toBe(4);
  });

  it('stops at the end of the list when the topic does not exist', async () => {
    const fx = serve(3);
    render(ui('nope'));
    await screen.findByRole('link', { name: 'Topic 59' });
    await waitFor(() => expect(fx.calls.length).toBe(3));
  });

  it('is bounded: never loads more than a handful of extra pages', async () => {
    const fx = serve(100);
    render(ui('nope'));
    await screen.findByRole('link', { name: 'Topic 0' });
    await new Promise((r) => setTimeout(r, 150));
    expect(fx.calls.length).toBeLessThanOrEqual(11);
  });

  it('does not load extra pages when no topic is current', async () => {
    const fx = serve(5);
    render(ui());
    await screen.findByRole('link', { name: 'Topic 0' });
    await new Promise((r) => setTimeout(r, 50));
    expect(fx.calls.length).toBe(1);
  });
});
