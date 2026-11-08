import { fireEvent, render, screen } from '@testing-library/react';
import type { Agent } from '@atproto/api';
import { MemoryRouter } from 'react-router-dom';
import { restoreSession } from '../auth/oauth';
import { SessionProvider } from '../auth/SessionContext';
import { ALICE, BOB, mockApi, project, update } from '../testUtils';
import { Home } from './Home';

vi.mock('../auth/oauth', () => ({ restoreSession: vi.fn(), signOut: vi.fn(), signIn: vi.fn() }));

const feedItem = (n: number, heading: string) => ({ ...update(n, { heading }), project: { ...project(1), title: 'Synth' } });

function renderPage() {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <Home />
      </SessionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.mocked(restoreSession).mockResolvedValue(null));
afterEach(() => vi.resetAllMocks());

describe('Home', () => {
  it('shows the global list when signed out, with no Following section', async () => {
    const fx = mockApi(() => ({ items: [feedItem(1, 'Global post')], cursor: null }));
    renderPage();
    expect(await screen.findByRole('link', { name: 'Global post' })).toHaveAttribute('href', `/u/${ALICE}/u1`);
    expect(screen.queryByRole('heading', { name: /following/i })).toBeNull();
    expect(fx.calls.every((u) => !u.searchParams.has('following'))).toBe(true);
  });

  it('shows a Following section first when signed in', async () => {
    vi.mocked(restoreSession).mockResolvedValue({ did: BOB, handle: 'bob.test', agent: {} as Agent });
    const fx = mockApi((u) =>
      u.searchParams.get('following') === BOB
        ? { items: [feedItem(2, 'Followed post')], cursor: null }
        : { items: [feedItem(1, 'Global post')], cursor: null },
    );
    renderPage();
    expect(await screen.findByRole('link', { name: 'Followed post' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Global post' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/following/i);
    expect(fx.calls.some((u) => u.searchParams.get('following') === BOB)).toBe(true);
  });

  it('keeps loading through empty pages with a cursor, bounded at 5 retries, then offers Load more', async () => {
    let n = 0;
    const fx = mockApi((u) => {
      n++;
      return n <= 6 ? { items: [], cursor: `${n}:at://x/y/z` } : { items: [feedItem(1, 'Finally')], cursor: null };
    });
    renderPage();
    const more = await screen.findByRole('button', { name: /load more/i });
    expect(fx.calls).toHaveLength(6); // first request + 5 retries
    expect(fx.calls[1].searchParams.get('cursor')).toBe('1:at://x/y/z');
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
    fireEvent.click(more);
    expect(await screen.findByRole('link', { name: 'Finally' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('continues automatically after a short non-empty page', async () => {
    const fx = mockApi((u) =>
      u.searchParams.get('cursor')
        ? { items: [feedItem(2, 'Second')], cursor: null }
        : { items: [feedItem(1, 'First')], cursor: '1:at://x/y/z' },
    );
    renderPage();
    expect(await screen.findByRole('link', { name: 'Second' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'First' })).toBeInTheDocument();
    expect(fx.calls).toHaveLength(2);
  });

  it('shows an error state with a way to retry', async () => {
    mockApi(() => new Response('x', { status: 500 }));
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
