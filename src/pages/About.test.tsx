import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { restoreSession } from '../auth/oauth';
import { SessionProvider } from '../auth/SessionContext';
import { mockApi } from '../testUtils';
import { About } from './About';

vi.mock('../auth/oauth', () => ({ restoreSession: vi.fn(), signOut: vi.fn(), signIn: vi.fn() }));

function renderApp(path: string) {
  mockApi(() => ({ items: [], cursor: null }));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
}

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

describe('About page', () => {
  it('renders on /about with one h1, the document title and ordered headings', async () => {
    renderApp('/about');
    expect(await screen.findByRole('heading', { level: 1, name: /about/i })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.title).toMatch(/^About/);
    const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    levels.slice(1).forEach((l, i) => expect(l - levels[i]).toBeLessThanOrEqual(1));
    for (const name of [/what it is/i, /how it works/i, /why at protocol|your own account/i, /cost|who runs/i, /questions/i]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
  });

  it('explains the process as a numbered list of four steps', () => {
    render(
      <MemoryRouter>
        <About />
      </MemoryRouter>,
    );
    const steps = within(screen.getByRole('list', { name: /steps/i })).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps[0]).toHaveTextContent(/sign in.*bluesky/i);
  });

  it('is honest about public posts, deleting and hiding', () => {
    render(
      <MemoryRouter>
        <About />
      </MemoryRouter>,
    );
    expect(screen.getByText(/everything you post is public/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot remove (it|them) from your account/i)).toBeInTheDocument();
  });

  it('says deleting an update does not delete a Bluesky post, and words topics and other apps carefully', () => {
    render(
      <MemoryRouter>
        <About />
      </MemoryRouter>,
    );
    expect(screen.getByText(/deleting an update here does not delete a bluesky post made from it/i)).toBeInTheDocument();
    expect(screen.getByText(/follow a topic to see updates from projects in it/i)).toBeInTheDocument();
    expect(screen.getByText(/other apps could read the same records/i)).toBeInTheDocument();
  });

  it('links to the repository and bsky.app, has a short FAQ, and no exclamation marks', () => {
    const { container } = render(
      <MemoryRouter>
        <About />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /github/i })).toHaveAttribute('href', 'https://github.com/ckahle33/workbench.pub');
    expect(screen.getByRole('link', { name: /bsky\.app/i })).toHaveAttribute('href', 'https://bsky.app');
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThanOrEqual(4);
    expect(container.textContent).not.toContain('!');
  });

  it('is linked from the header nav and the footer on every page', async () => {
    renderApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: /about/i })).toHaveAttribute('href', '/about');
  });
});

describe('home intro', () => {
  it('shows for signed-out visitors with two actions', async () => {
    renderApp('/');
    const intro = await screen.findByRole('region', { name: /show a project as it gets made/i });
    expect(within(intro).getByRole('link', { name: /how it works/i })).toHaveAttribute('href', '/about');
    expect(within(intro).getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/signin');
  });

  it('is hidden once signed in', async () => {
    vi.mocked(restoreSession).mockResolvedValue({ did: 'did:plc:me', handle: 'me.test', agent: {} as never });
    renderApp('/');
    await screen.findByText('@me.test');
    expect(screen.queryByRole('region', { name: /show a project as it gets made/i })).toBeNull();
  });
});
