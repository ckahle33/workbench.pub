import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { restoreSession } from '../auth/oauth';
import { SessionProvider } from '../auth/SessionContext';
import { mockApi, project, update } from '../testUtils';
import { SPLASH_TITLE } from './Splash';

vi.mock('../auth/oauth', () => ({ restoreSession: vi.fn(), signOut: vi.fn(), signIn: vi.fn() }));

const feedItem = (n: number) => ({ ...update(n, { heading: `Real update ${n}` }), project: { ...project(n), title: `Real project ${n}` } });

function renderAt(path: string, feed: (u: URL) => unknown = () => ({ items: [], cursor: null })) {
  const fx = mockApi((u) => (u.pathname === '/api/topics' ? { items: [], cursor: null } : feed(u)));
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
  return { fx, ...view };
}

const signedIn = () => vi.mocked(restoreSession).mockResolvedValue({ did: 'did:plc:me', handle: 'me.test', agent: {} as never });

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(restoreSession).mockResolvedValue(null);
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  expect(errSpy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe('splash at / (signed out)', () => {
  it('has one h1, sign-in calls to action, a How it works link and the page title', async () => {
    renderAt('/');
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent(/show how it’s made/i);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const ctas = screen.getAllByRole('link', { name: 'Sign in with Bluesky' });
    expect(ctas).toHaveLength(2);
    ctas.forEach((a) => expect(a).toHaveAttribute('href', '/signin'));
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '#how');
    expect(screen.getByRole('heading', { level: 2, name: 'How it works' }).closest('section')).toHaveAttribute('id', 'how');
    expect(screen.getByRole('link', { name: 'Look around first' })).toHaveAttribute('href', '/feed');
    expect(screen.getByRole('link', { name: /how your data is stored/i })).toHaveAttribute('href', '/about');
    expect(screen.getByText(/free\. uses your existing bluesky account\./i)).toBeInTheDocument();
    // Only true claims: an update needs a heading and notes; the photo is optional; cross-posting is opt-in and remembered.
    expect(screen.queryByText(/a photo and one line is enough/i)).toBeNull();
    expect(screen.getByText(/a heading, a few notes and, if you have one, a photo\./i)).toBeInTheDocument();
    expect(screen.queryByText(/you choose each time/i)).toBeNull();
    expect(screen.getByText(/it is off until you tick it on an update, and you can untick it on any update\./i)).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe(SPLASH_TITLE));
    // Heading levels never skip.
    const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName[1]));
    levels.forEach((l, i) => i > 0 && expect(l - levels[i - 1]).toBeLessThanOrEqual(1));
  });

  it('shows the example as a labelled sample with numbered updates and no live controls', async () => {
    renderAt('/');
    const example = await screen.findByRole('figure', { name: /example/i });
    expect(example).toHaveAccessibleName(expect.stringMatching(/not a real post/i));
    expect(within(example).getAllByRole('article')).toHaveLength(4);
    expect(within(example).getByText('04').closest('.entry-num')).toHaveClass('is-newest');
    expect(within(example).queryAllByRole('link')).toHaveLength(0);
    expect(within(example).queryAllByRole('button')).toHaveLength(0);
    expect(within(example).getAllByText((_, el) => el?.tagName === 'TIME')[0]).toHaveAttribute('datetime', '2026-04-19T19:30:00.000Z');
  });

  it('hides "Latest from the site" when the feed is empty', async () => {
    const { fx } = renderAt('/');
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(fx.calls.some((u) => u.pathname === '/api/feed')).toBe(true));
    expect(screen.queryByRole('heading', { name: /latest from the site/i })).toBeNull();
  });

  it('hides "Latest from the site" when the feed request fails', async () => {
    const { fx } = renderAt('/', () => new Response('boom', { status: 500 }));
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(fx.calls.some((u) => u.pathname === '/api/feed')).toBe(true));
    expect(screen.queryByRole('heading', { name: /latest from the site/i })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows up to three real updates with a link to the feed, from one request with limit=3', async () => {
    const { fx } = renderAt('/', (u) => (u.pathname === '/api/feed' ? { items: [1, 2, 3, 4].map(feedItem), cursor: null } : undefined));
    const latest = (await screen.findByRole('heading', { name: 'Latest from the site' })).closest('section')!;
    expect(within(latest).getAllByRole('listitem')).toHaveLength(3);
    expect(within(latest).getByRole('link', { name: 'Real update 1' })).toBeInTheDocument();
    expect(within(latest).getByRole('link', { name: 'See the feed' })).toHaveAttribute('href', '/feed');
    const feedCalls = fx.calls.filter((u) => u.pathname === '/api/feed');
    expect(feedCalls).toHaveLength(1);
    expect(feedCalls[0].searchParams.get('limit')).toBe('3');
  });
});

describe('routing', () => {
  it('sends signed-in visitors from / to /feed', async () => {
    signedIn();
    renderAt('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Latest' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /show how it’s made/i })).toBeNull();
  });

  it('renders neither the splash nor the feed while the session is loading', () => {
    vi.mocked(restoreSession).mockReturnValue(new Promise(() => {}));
    const { container } = renderAt('/');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(container.querySelector('.splash-pending')).toHaveAttribute('aria-busy', 'true');
  });

  it('serves the feed at /feed signed out and signed in, without the old intro panel', async () => {
    const a = renderAt('/feed', () => ({ items: [feedItem(1)], cursor: null }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Latest' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Real update 1' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /show a project as it gets made/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /show how it’s made/i })).toBeNull();
    a.unmount();
    signedIn();
    renderAt('/feed', () => ({ items: [feedItem(1)], cursor: null }));
    expect(await screen.findByRole('button', { name: 'Following' })).toBeInTheDocument();
  });

  it('points the header Feed link at /feed and the wordmark at /', async () => {
    renderAt('/about');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Feed' })).toHaveAttribute('href', '/feed');
    expect(screen.getByRole('link', { name: /workbench/i })).toHaveAttribute('href', '/');
  });
});
