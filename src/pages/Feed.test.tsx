import { fireEvent, render, screen } from '@testing-library/react';
import type { Agent } from '@atproto/api';
import { MemoryRouter } from 'react-router-dom';
import { restoreSession } from '../auth/oauth';
import { SessionProvider } from '../auth/SessionContext';
import { ALICE, BOB, mockApi, project, update } from '../testUtils';
import { Feed } from './Feed';

vi.mock('../auth/oauth', () => ({ restoreSession: vi.fn(), signOut: vi.fn(), signIn: vi.fn() }));

/** The topic filter asks /api/topics; feed tests answer it with an empty list and count only feed calls. */
const TOPICS = { items: [{ uri: 'at://x/pub.workbench.topic/synths', slug: 'synths', name: 'Synths', description: '' }], cursor: null };
const feedCalls = (fx: { calls: URL[] }) => fx.calls.filter((u) => u.pathname === '/api/feed');

const feedItem = (n: number, heading: string) => ({ ...update(n, { heading }), project: { ...project(1), title: 'Synth' } });

function renderPage() {
  return render(
    <MemoryRouter>
      <SessionProvider>
        <Feed />
      </SessionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.mocked(restoreSession).mockResolvedValue(null));
afterEach(() => vi.resetAllMocks());

describe('Feed', () => {
  it('shows the global list when signed out, with no Following section', async () => {
    const fx = mockApi((u) => (u.pathname === '/api/topics' ? TOPICS : { items: [feedItem(1, 'Global post')], cursor: null }));
    renderPage();
    expect(await screen.findByRole('link', { name: 'Global post' })).toHaveAttribute('href', `/u/${ALICE}/u1`);
    expect(screen.queryByRole('heading', { name: /following/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Following' })).toBeNull();
    expect(feedCalls(fx).every((u) => !u.searchParams.has('following'))).toBe(true);
    // The topic filter lists topics, with "All updates" marked current.
    expect(await screen.findByRole('link', { name: 'Synths' })).toHaveAttribute('href', '/t/synths');
    expect(screen.getByRole('link', { name: 'All updates' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows Following first when signed in, and Everyone on request', async () => {
    vi.mocked(restoreSession).mockResolvedValue({ did: BOB, handle: 'bob.test', agent: {} as Agent });
    const fx = mockApi((u) =>
      u.pathname === '/api/topics'
        ? TOPICS
        : u.searchParams.get('following') === BOB
          ? { items: [feedItem(2, 'Followed post')], cursor: null }
          : { items: [feedItem(1, 'Global post')], cursor: null },
    );
    renderPage();
    expect(await screen.findByRole('link', { name: 'Followed post' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/following/i);
    expect(screen.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true');
    expect(fx.calls.some((u) => u.searchParams.get('following') === BOB)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Everyone' }));
    expect(await screen.findByRole('link', { name: 'Global post' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Everyone' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps loading through empty pages with a cursor, bounded at 5 retries, then offers Load more', async () => {
    let n = 0;
    const fx = mockApi((u) => {
      if (u.pathname === '/api/topics') return TOPICS;
      n++;
      return n <= 6 ? { items: [], cursor: `${n}:at://x/y/z` } : { items: [feedItem(1, 'Finally')], cursor: null };
    });
    renderPage();
    const more = await screen.findByRole('button', { name: /load more/i });
    expect(feedCalls(fx)).toHaveLength(6); // first request + 5 retries
    expect(feedCalls(fx)[1].searchParams.get('cursor')).toBe('1:at://x/y/z');
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
    fireEvent.click(more);
    expect(await screen.findByRole('link', { name: 'Finally' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('continues automatically after a short non-empty page', async () => {
    const fx = mockApi((u) =>
      u.pathname === '/api/topics'
        ? TOPICS
        : u.searchParams.get('cursor')
          ? { items: [feedItem(2, 'Second')], cursor: null }
          : { items: [feedItem(1, 'First')], cursor: '1:at://x/y/z' },
    );
    renderPage();
    expect(await screen.findByRole('link', { name: 'Second' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'First' })).toBeInTheDocument();
    expect(feedCalls(fx)).toHaveLength(2);
  });

  it('shows an error state with a way to retry', async () => {
    mockApi(() => new Response('x', { status: 500 }));
    renderPage();
    // One alert: a failed topic list just leaves the filter shorter.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
