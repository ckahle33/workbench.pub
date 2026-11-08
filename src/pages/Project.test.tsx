import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { optimistic } from '../optimistic';
import { ALICE, image, mockApi, project, update } from '../testUtils';
import { Project } from './Project';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/p/${ALICE}/p1`]}>
      <Routes>
        <Route path="/p/:did/:rkey" element={<Project />} />
      </Routes>
    </MemoryRouter>,
  );
}

const author = { did: ALICE, handle: 'alice.test' };

function serve(items: unknown[], proj = project(1)) {
  return mockApi((u) => {
    if (u.pathname === `/api/projects/${ALICE}/p1`) return { project: proj, author, items, cursor: null };
    if (u.pathname === '/api/card') return { url: u.searchParams.get('url'), title: 'Example card' };
    return undefined;
  });
}

afterEach(() => {
  optimistic.clear();
  document.title = '';
});

describe('Project page', () => {
  it('renders a vertical timeline, newest first, with date, images, notes and link cards', async () => {
    serve([
      update(2, {
        heading: 'Wired the board',
        body: 'line one\nline two',
        images: [image('bafycid2', 'A red circuit board')],
        links: [{ url: 'https://example.com/a' }],
        parts: [{ item: 'Resistor', quantity: '4', note: '10k' }],
      }),
      update(1, { heading: 'First sketch' }),
    ]);
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Project 1' })).toBeInTheDocument();
    expect(screen.getByText('@alice.test')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Summary 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /synths/ })).toHaveAttribute('href', '/t/synths');

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Wired the board', 'First sketch']);

    const [first] = screen.getAllByRole('listitem').filter((li) => li.tagName === 'LI' && li.querySelector('article'));
    const img = within(first).getByRole('img', { name: 'A red circuit board' });
    expect(img).toHaveAttribute('src', `/api/blob/${ALICE}/bafycid2`);
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('width');
    expect(img).toHaveAttribute('height');
    const time = within(first).getByText((_, el) => el?.tagName === 'TIME');
    expect(time).toHaveAttribute('datetime', '2026-11-02T10:00:00.000Z');
    expect(within(first).getByText(/line one/).textContent).toBe('line one\nline two');
    expect(within(first).getByText(/Resistor/)).toBeInTheDocument();
    expect(await within(first).findByText('Example card')).toBeInTheDocument();
    expect(document.title).toContain('Project 1');
  });

  it('shows an optimistic update before the server has it, and does not duplicate it afterwards', async () => {
    optimistic.add({
      kind: 'update',
      uri: `at://${ALICE}/pub.workbench.update/new1`,
      did: ALICE,
      projectUri: project(1).uri,
      heading: 'Fresh from me',
      body: 'just posted',
      createdAt: '2026-11-07T10:00:00.000Z',
    });
    serve([update(1)]);
    const first = renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Project 1' });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Fresh from me', 'Update 1']);
    first.unmount();

    serve([update(9, { uri: `at://${ALICE}/pub.workbench.update/new1`, heading: 'Fresh from me' }), update(1)]);
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Project 1' });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Fresh from me', 'Update 1']);
  });

  it('shows a just-created project the server has not indexed yet', async () => {
    mockApi(() => undefined);
    optimistic.add({
      kind: 'project',
      uri: project(1).uri,
      did: ALICE,
      title: 'Brand new',
      summary: 's',
      topicSlug: 'synths',
      status: 'in-progress',
      createdAt: '2026-11-07T10:00:00.000Z',
    });
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Brand new' })).toBeInTheDocument();
  });

  it('renders a title with emoji, RTL text and 120 characters', async () => {
    const title = `🔧🎛️ שלום עולם ${'x'.repeat(120)}`;
    serve([], project(1, { title }));
    renderPage();
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent(title);
    expect(h1).toHaveAttribute('dir', 'auto');
    expect(screen.getByText(/No updates yet/i)).toBeInTheDocument();
  });

  it('renders user text containing markup as text, never as HTML', async () => {
    const evil = '<script>window.__pwned = 1</script><img src=x onerror=alert(1)>';
    const { container } = (serve([update(1, { heading: evil, body: evil })], project(1, { summary: evil })), renderPage());
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText(evil, { exact: false }).length).toBeGreaterThanOrEqual(2);
  });

  it('shows a not-found state for an unknown project', async () => {
    mockApi(() => undefined);
    renderPage();
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });

  it('shows an error state when the request fails', async () => {
    mockApi(() => new Response('boom', { status: 500 }));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  });
});
