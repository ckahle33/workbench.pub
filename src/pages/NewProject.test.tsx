import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createProject, createTopic } from '../records/write';
import { optimistic } from '../optimistic';
import { ALICE, mockApi } from '../testUtils';
import { NewProject } from './NewProject';

const h = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('../auth/SessionContext', () => ({ useSession: () => ({ session: h.session, loading: false, signOut: vi.fn() }) }));
vi.mock('../records/write', () => ({ createProject: vi.fn(), createTopic: vi.fn() }));

const topics = [
  { uri: 'at://x/pub.workbench.topic/a', slug: 'synths', name: 'Synthesizers', description: '' },
  { uri: 'at://x/pub.workbench.topic/b', slug: 'woodworking', name: 'Woodworking', description: '' },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/new']}>
      <Routes>
        <Route path="/new" element={<NewProject />} />
        <Route path="/p/:did/:rkey" element={<p>project page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const fill = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  h.session = { did: ALICE, handle: 'alice.test', agent: {} };
  mockApi((u) => (u.pathname === '/api/topics' ? { items: topics, cursor: null } : undefined));
});
afterEach(() => {
  vi.resetAllMocks();
  optimistic.clear();
});

describe('NewProject', () => {
  it('shows a sign-in prompt, not a form, when signed out', () => {
    h.session = null;
    renderPage();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/signin');
    expect(screen.queryByLabelText(/title/i)).toBeNull();
  });

  it('blocks submit without a title and without a topic', async () => {
    renderPage();
    await screen.findByRole('option', { name: /Synthesizers/ });
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts.join(' ')).toMatch(/title/i);
    expect(alerts.join(' ')).toMatch(/topic/i);
    expect(createProject).not.toHaveBeenCalled();
  });

  it('creates the project with the canonical slug, adds it optimistically and navigates', async () => {
    vi.mocked(createProject).mockResolvedValue({ uri: `at://${ALICE}/pub.workbench.project/abc` });
    renderPage();
    await screen.findByRole('option', { name: /Synthesizers/ });
    fill(/^title/i, '  My synth ');
    fill(/summary/i, 'A build');
    fireEvent.change(screen.getByLabelText(/^topic/i), { target: { value: 'synths' } });
    expect(screen.getByText(/topic that will be used: #synths/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    expect(await screen.findByText('project page')).toBeInTheDocument();
    expect(createProject).toHaveBeenCalledWith(h.session, { title: 'My synth', summary: 'A build', topic: 'synths', status: 'in-progress' });
    expect(optimistic.find(`at://${ALICE}/pub.workbench.project/abc`)).toMatchObject({ kind: 'project', title: 'My synth', topicSlug: 'synths', did: ALICE });
  });

  it('creates a new topic inline and selects its canonical slug', async () => {
    vi.mocked(createTopic).mockResolvedValue({ uri: `at://${ALICE}/pub.workbench.topic/x`, slug: 'wood-working' });
    vi.mocked(createProject).mockResolvedValue({ uri: `at://${ALICE}/pub.workbench.project/abc` });
    renderPage();
    await screen.findByRole('option', { name: /Synthesizers/ });
    fireEvent.change(screen.getByLabelText(/^topic/i), { target: { value: '__new__' } });
    fill(/new topic name/i, 'Wood Working!');
    expect(screen.getByText(/slug that will be used/i)).toHaveTextContent('#wood-working');
    fireEvent.click(screen.getByRole('button', { name: /^create topic/i }));
    await waitFor(() => expect(createTopic).toHaveBeenCalledWith(h.session, { name: 'Wood Working!', description: '' }));
    await waitFor(() => expect(screen.getByLabelText(/^topic/i)).toHaveValue('wood-working'));
    fill(/^title/i, 'Bench');
    fill(/summary/i, 'sum');
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    await screen.findByText('project page');
    expect(vi.mocked(createProject).mock.calls[0][1].topic).toBe('wood-working');
  });

  it('selects an existing topic instead of creating a duplicate', async () => {
    renderPage();
    await screen.findByRole('option', { name: /Synthesizers/ });
    fireEvent.change(screen.getByLabelText(/^topic/i), { target: { value: '__new__' } });
    fill(/new topic name/i, 'Synths');
    fireEvent.click(screen.getByRole('button', { name: /^create topic/i }));
    await waitFor(() => expect(screen.getByLabelText(/^topic/i)).toHaveValue('synths'));
    expect(createTopic).not.toHaveBeenCalled();
  });

  it('shows a friendly message when the write fails, without raw text', async () => {
    vi.mocked(createProject).mockRejectedValue(new Error('500 {"secret":"token"}'));
    renderPage();
    await screen.findByRole('option', { name: /Synthesizers/ });
    fill(/^title/i, 'T');
    fill(/summary/i, 'S');
    fireEvent.change(screen.getByLabelText(/^topic/i), { target: { value: 'synths' } });
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/something went wrong/i);
    expect(alert.textContent).not.toMatch(/secret/);
  });

  it('offers Load more topics', async () => {
    mockApi((u) =>
      u.pathname === '/api/topics'
        ? u.searchParams.get('cursor')
          ? { items: [{ uri: 'at://x/t/c', slug: 'zeta', name: 'Zeta', description: '' }], cursor: null }
          : { items: [...topics, ...Array.from({ length: 18 }, (_, i) => ({ uri: `at://x/t/${i}`, slug: `t-${i}`, name: `T ${i}`, description: '' }))], cursor: 'woodworking' }
        : undefined,
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /load more topics/i }));
    expect(await screen.findByRole('option', { name: /Zeta/ })).toBeInTheDocument();
  });

  it('focuses the first invalid field after a failed submit: title, then topic', async () => {
    renderPage();
    await screen.findByRole('option', { name: /Synthesizers/ });
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    expect(document.activeElement).toBe(screen.getByLabelText(/^title/i));
    fill(/^title/i, 'T');
    fill(/summary/i, 'S');
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    expect(document.activeElement).toBe(screen.getByLabelText(/^topic/i));
  });

  it('ties every error to its control with aria-describedby', async () => {
    renderPage();
    await screen.findByRole('option', { name: /Synthesizers/ });
    fireEvent.click(screen.getByRole('button', { name: /create project/i }));
    for (const [label, re] of [[/^title/i, /title/i], [/summary/i, /summary/i], [/^topic/i, /topic/i]] as const) {
      const control = screen.getByLabelText(label);
      const err = screen.getAllByRole('alert').find((a) => re.test(a.textContent ?? ''))!;
      expect(control).toHaveAttribute('aria-invalid', 'true');
      expect(control.getAttribute('aria-describedby')).toContain(err.id);
    }
    fireEvent.change(screen.getByLabelText(/^topic/i), { target: { value: '__new__' } });
    fireEvent.click(screen.getByRole('button', { name: /^create topic/i }));
    const nameErr = screen.getAllByRole('alert').find((a) => /2 to 40/.test(a.textContent ?? ''))!;
    expect(screen.getByLabelText(/new topic name/i).getAttribute('aria-describedby')).toContain(nameErr.id);
  });

  it('keeps focus on the submit button through a failed save and ignores a second activation while busy', async () => {
    let reject!: (e: Error) => void;
    vi.mocked(createProject).mockReturnValue(new Promise((_, rej) => (reject = rej)));
    renderPage();
    await screen.findByRole('option', { name: /Synthesizers/ });
    fill(/^title/i, 'T');
    fill(/summary/i, 'S');
    fireEvent.change(screen.getByLabelText(/^topic/i), { target: { value: 'synths' } });
    const btn = screen.getByRole('button', { name: /create project/i });
    btn.focus();
    fireEvent.click(btn);
    const busyBtn = await screen.findByRole('button', { name: /creating/i });
    expect(busyBtn).toBe(btn);
    expect(busyBtn).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(btn);
    fireEvent.click(busyBtn);
    expect(createProject).toHaveBeenCalledTimes(1);
    reject(new Error('x'));
    await screen.findByText(/something went wrong/i);
    expect(screen.getByRole('button', { name: /create project/i })).not.toHaveAttribute('aria-disabled');
    expect(document.activeElement).toBe(btn);
  });
});
