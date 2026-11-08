import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { restoreSession } from './auth/oauth';
import { SessionProvider } from './auth/SessionContext';
import { mockApi } from './testUtils';

vi.mock('./auth/oauth', () => ({ restoreSession: vi.fn(), signOut: vi.fn(), signIn: vi.fn() }));

function renderApp(path = '/') {
  mockApi(() => ({ items: [], cursor: null }));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.resetAllMocks());

describe('App', () => {
  it('renders the site header and navigation with a sign-in link when signed out', async () => {
    vi.mocked(restoreSession).mockResolvedValue(null);
    renderApp();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /workbench/i })).toHaveAttribute('href', '/');
    expect(await screen.findByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/signin');
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('shows the handle and a sign out button when signed in', async () => {
    vi.mocked(restoreSession).mockResolvedValue({ did: 'did:plc:me', handle: 'me.test', agent: {} as never });
    renderApp();
    expect(await screen.findByText('@me.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('sets document.title on the sign-in and not-found routes', async () => {
    vi.mocked(restoreSession).mockResolvedValue(null);
    const a = renderApp('/signin');
    await vi.waitFor(() => expect(document.title).toMatch(/^Sign in/));
    a.unmount();
    renderApp('/nope');
    await vi.waitFor(() => expect(document.title).toMatch(/^Page not found/));
  });
});
