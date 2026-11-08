import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ALICE, mockApi, project } from '../testUtils';
import { Profile } from './Profile';

describe('Profile', () => {
  it('shows the person and their projects', async () => {
    mockApi((u) =>
      u.pathname === `/api/profiles/${ALICE}`
        ? { profile: { did: ALICE, handle: 'alice.test', displayName: 'Alice' }, items: [project(1)], cursor: null }
        : undefined,
    );
    render(
      <MemoryRouter initialEntries={[`/profile/${ALICE}`]}>
        <Routes>
          <Route path="/profile/:did" element={<Profile />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByText('@alice.test')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Project 1' })).toBeInTheDocument();
  });
});
