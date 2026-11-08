import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ALICE, mockApi } from '../testUtils';
import { Profile } from './Profile';
import { Project } from './Project';
import { Topic } from './Topic';

vi.mock('../auth/SessionContext', () => ({ useSession: () => ({ session: null, loading: false, signOut: vi.fn() }) }));

// After the route move, `/` is the splash; "see the latest updates" must go to the feed.
describe.each([
  ['project', `/p/${ALICE}/missing`, '/p/:did/:rkey', <Project />, 'Project not found.'],
  ['profile', `/profile/${ALICE}`, '/profile/:did', <Profile />, 'Profile not found.'],
  ['topic', '/t/missing', '/t/:slug', <Topic />, 'Topic not found.'],
])('%s not-found state', (_name, path, pattern, element, text) => {
  it('links to /feed', async () => {
    mockApi(() => undefined);
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={pattern} element={element} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See the latest updates' })).toHaveAttribute('href', '/feed');
  });
});
