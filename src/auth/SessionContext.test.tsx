import { act, render, screen, waitFor } from '@testing-library/react';
import type { Agent } from '@atproto/api';
import { restoreSession, signOut } from './oauth';
import { SessionProvider, useSession } from './SessionContext';

vi.mock('./oauth', () => ({
  restoreSession: vi.fn(),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));

const fakeSession = { did: 'did:plc:abc123', handle: 'alice.test', agent: {} as Agent };

function Probe() {
  const { session, loading, signOut } = useSession();
  return (
    <div>
      <p data-testid="state">{loading ? 'loading' : session ? `in:${session.handle}` : 'out'}</p>
      <button onClick={() => void signOut()}>out</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
}

afterEach(() => vi.resetAllMocks());

describe('useSession', () => {
  it('is loading, then null when there is no session', async () => {
    vi.mocked(restoreSession).mockResolvedValue(null);
    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('out'));
  });

  it('returns the session after restoreSession resolves', async () => {
    vi.mocked(restoreSession).mockResolvedValue(fakeSession);
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('in:alice.test'));
  });

  it('treats a failed restore as signed out', async () => {
    vi.mocked(restoreSession).mockRejectedValue(new Error('boom'));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('out'));
  });

  it('signOut clears the session', async () => {
    vi.mocked(restoreSession).mockResolvedValue(fakeSession);
    vi.mocked(signOut).mockResolvedValue(undefined);
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('in:alice.test'));
    await act(async () => screen.getByRole('button', { name: 'out' }).click());
    expect(signOut).toHaveBeenCalledOnce();
    expect(screen.getByTestId('state')).toHaveTextContent('out');
  });
});
