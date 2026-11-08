import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { deleteRecord, followSubject } from '../records/write';
import { ALICE } from '../testUtils';
import { FollowButton } from './FollowButton';

const h = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('../auth/SessionContext', () => ({ useSession: () => ({ session: h.session, loading: false, signOut: vi.fn() }) }));
vi.mock('../records/write', () => ({ followSubject: vi.fn(), deleteRecord: vi.fn() }));

const ui = (kind: 'topic' | 'project', subject: string) => (
  <MemoryRouter>
    <FollowButton kind={kind} subject={subject} />
  </MemoryRouter>
);

beforeEach(() => {
  h.session = { did: ALICE, handle: 'alice.test', agent: {} };
});
afterEach(() => vi.resetAllMocks());

describe('FollowButton', () => {
  it('offers sign-in when signed out', () => {
    h.session = null;
    render(ui('topic', 'synths'));
    expect(screen.getByRole('link', { name: /sign in to follow/i })).toHaveAttribute('href', '/signin');
  });

  it('follows a topic by slug, then unfollows by deleting the follow record', async () => {
    vi.mocked(followSubject).mockResolvedValue({ uri: `at://${ALICE}/pub.workbench.follow/f1` });
    render(ui('topic', 'synths'));
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    expect(await screen.findByRole('button', { name: 'Unfollow' })).toBeInTheDocument();
    expect(followSubject).toHaveBeenCalledWith(h.session, 'topic', 'synths');
    fireEvent.click(screen.getByRole('button', { name: 'Unfollow' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument());
    expect(deleteRecord).toHaveBeenCalledWith(h.session, `at://${ALICE}/pub.workbench.follow/f1`);
  });

  it('follows a project by at-uri and remembers the follow after remount', async () => {
    const puri = `at://${ALICE}/pub.workbench.project/p1`;
    vi.mocked(followSubject).mockResolvedValue({ uri: `at://${ALICE}/pub.workbench.follow/f2` });
    const a = render(ui('project', puri));
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await screen.findByRole('button', { name: 'Unfollow' });
    expect(followSubject).toHaveBeenCalledWith(h.session, 'project', puri);
    a.unmount();
    render(ui('project', puri));
    expect(screen.getByRole('button', { name: 'Unfollow' })).toBeInTheDocument();
  });

  it('shows a friendly error when following fails and stays on Follow', async () => {
    vi.mocked(followSubject).mockRejectedValue(new Error('raw {"x":1}'));
    render(ui('topic', 'lasers'));
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/raw/);
    expect(screen.getByRole('button', { name: 'Follow' })).toBeEnabled();
  });
});
