import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ALICE, BOB, mockApi, project } from '../testUtils';
import { Profile } from './Profile';

const sess = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('../auth/SessionContext', () => ({ useSession: () => ({ session: sess.session, loading: false, signOut: vi.fn() }) }));

const renderAt = (did: string) =>
  render(
    <MemoryRouter initialEntries={[`/profile/${did}`]}>
      <Routes>
        <Route path="/profile/:did" element={<Profile />} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => {
  sess.session = null;
});

describe('Profile', () => {
  it('shows the person and their projects', async () => {
    mockApi((u) =>
      u.pathname === `/api/profiles/${ALICE}`
        ? { profile: { did: ALICE, handle: 'alice.test', displayName: 'Alice' }, items: [project(1)], cursor: null }
        : undefined,
    );
    renderAt(ALICE);
    expect(await screen.findByRole('heading', { level: 1, name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByText('@alice.test')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Project 1' })).toBeInTheDocument();
  });

  it('says not found for an unknown DID', async () => {
    mockApi(() => undefined);
    renderAt(BOB);
    expect(await screen.findByText('Profile not found.')).toBeInTheDocument();
  });

  it('shows your own empty profile when the server has nothing indexed for you yet', async () => {
    sess.session = { did: BOB, handle: 'bob.test', agent: {} };
    mockApi(() => undefined);
    renderAt(BOB);
    expect(await screen.findByRole('heading', { level: 1, name: '@bob.test' })).toBeInTheDocument();
    expect(screen.getByText('No projects yet.')).toBeInTheDocument();
  });
});
