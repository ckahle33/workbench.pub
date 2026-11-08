import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Agent } from '@atproto/api';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { restoreSession, signIn, SignInError } from '../auth/oauth';
import { SessionProvider } from '../auth/SessionContext';
import { SignIn } from './SignIn';

vi.mock('../auth/oauth', async (importOriginal) => ({
  SignInError: (await importOriginal<typeof import('../auth/oauth')>()).SignInError,
  restoreSession: vi.fn(),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/signin']}>
      <SessionProvider>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

async function submit(value: string) {
  const input = await screen.findByLabelText(/handle/i);
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

beforeEach(() => vi.mocked(restoreSession).mockResolvedValue(null));
afterEach(() => vi.resetAllMocks());

describe('SignIn page', () => {
  it('starts sign-in with the normalized handle', async () => {
    vi.mocked(signIn).mockResolvedValue(undefined);
    renderPage();
    await submit(' @Alice.Bsky.Social ');
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('alice.bsky.social'));
  });

  it('rejects an invalid handle without calling signIn, with an accessible error', async () => {
    renderPage();
    await submit('not a handle');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/handle/i);
    expect(screen.getByLabelText(/handle/i)).toHaveAttribute('aria-invalid', 'true');
    expect(signIn).not.toHaveBeenCalled();
  });

  it('shows a generic error, not internals, when sign-in fails', async () => {
    vi.mocked(signIn).mockRejectedValue(new Error('secret internal stack detail'));
    renderPage();
    await submit('alice.bsky.social');
    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(/secret internal/);
    expect(alert).toHaveTextContent('Sign-in is unavailable right now. Try again later.');
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
  });

  it('asks to check the handle when the handle does not resolve', async () => {
    vi.mocked(signIn).mockRejectedValue(new SignInError('invalid-handle'));
    renderPage();
    await submit('nobody.bsky.social');
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the handle and try again.');
  });

  it('redirects home when already signed in', async () => {
    vi.mocked(restoreSession).mockResolvedValue({ did: 'did:plc:abc', handle: 'a.test', agent: {} as Agent });
    renderPage();
    expect(await screen.findByText('home')).toBeInTheDocument();
  });

  it('says that the Bluesky post permission is only used if cross-posting is ticked', async () => {
    vi.mocked(restoreSession).mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText(/asks permission to create bluesky posts.*only used if you tick/i)).toBeInTheDocument();
  });
});
