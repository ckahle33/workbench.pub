import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { mockApi, project } from '../testUtils';
import { Topic } from './Topic';

const topic = { slug: 'synths', name: 'Synthesizers', description: 'Things that go beep' };
const many = (from: number) => Array.from({ length: 20 }, (_, i) => project(from + i));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/t/synths']}>
      <Routes>
        <Route path="/t/:slug" element={<Topic />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Topic', () => {
  it('lists projects and paginates with Load more', async () => {
    const fx = mockApi((u) => {
      if (u.pathname !== '/api/topics/synths') return undefined;
      return u.searchParams.get('cursor')
        ? { topic, items: [project(100, { title: 'Last one' })], cursor: null }
        : { topic, items: many(1), cursor: '20:at://x/y/z' };
    });
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Synthesizers' })).toBeInTheDocument();
    expect(screen.getByText('Things that go beep')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Project 1' })).toHaveAttribute('href', expect.stringMatching(/^\/p\/did:plc:.*\/p1$/));
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(await screen.findByRole('link', { name: 'Last one' })).toBeInTheDocument();
    expect(fx.calls[1].searchParams.get('cursor')).toBe('20:at://x/y/z');
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('shows not found for an unknown topic', async () => {
    mockApi(() => undefined);
    renderPage();
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    mockApi(() => ({ topic, items: [], cursor: null }));
    renderPage();
    expect(await screen.findByText(/no projects yet/i)).toBeInTheDocument();
  });
});
