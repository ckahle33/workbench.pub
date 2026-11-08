import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { optimistic } from '../optimistic';
import { ALICE, BOB, mockApi, project, update } from '../testUtils';
import { Update } from './Update';

const reply = (n: number, subject: string, body: string) => ({
  uri: `at://${BOB}/pub.workbench.reply/r${n}`,
  did: BOB,
  rkey: `r${n}`,
  subjectUri: subject,
  body,
  createdAt: `2026-11-0${n + 2}T10:00:00.000Z`,
  indexedAt: n,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/u/${ALICE}/u1`]}>
      <Routes>
        <Route path="/u/:did/:rkey" element={<Update />} />
      </Routes>
    </MemoryRouter>,
  );
}

const u1 = update(1, { heading: 'Soldered it', body: 'it works' });
const full = { ...u1, project: { uri: project(1).uri, did: ALICE, rkey: 'p1', title: 'Project 1', topicSlug: 'synths' } };

afterEach(() => optimistic.clear());

describe('Update page', () => {
  it('shows the update, its project link and the replies thread', async () => {
    mockApi((u) =>
      u.pathname === `/api/updates/${ALICE}/u1`
        ? { update: full, author: { did: ALICE }, items: [reply(1, u1.uri, 'Nice work'), reply(2, `at://${BOB}/pub.workbench.reply/r1`, 'Thanks!')], cursor: null }
        : undefined,
    );
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Soldered it' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Project 1' })).toHaveAttribute('href', `/p/${ALICE}/p1`);
    expect(screen.getByRole('heading', { level: 2, name: /replies/i })).toBeInTheDocument();
    expect(screen.getByText('Nice work')).toBeInTheDocument();
    expect(screen.getByText('Thanks!')).toBeInTheDocument();
  });

  it('shows an optimistic reply that the server does not have yet', async () => {
    mockApi(() => ({ update: full, author: { did: ALICE }, items: [], cursor: null }));
    optimistic.add({ kind: 'reply', uri: `at://${BOB}/pub.workbench.reply/new`, did: BOB, subjectUri: u1.uri, body: 'mine', createdAt: '2026-11-07T00:00:00Z' });
    renderPage();
    expect(await screen.findByText('mine')).toBeInTheDocument();
  });

  it('shows an empty replies state and not-found', async () => {
    mockApi(() => ({ update: full, author: { did: ALICE }, items: [], cursor: null }));
    const a = renderPage();
    expect(await screen.findByText(/no replies yet/i)).toBeInTheDocument();
    a.unmount();
    mockApi(() => undefined);
    renderPage();
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });
});

describe('Update page structure and pagination', () => {
  it('never skips a heading level', async () => {
    mockApi(() => ({ update: { ...full, parts: [{ item: 'Screw' }] }, author: { did: ALICE }, items: [], cursor: null }));
    renderPage();
    await screen.findByRole('heading', { level: 1 });
    const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    levels.forEach((l, i) => i > 0 && expect(l).toBeLessThanOrEqual(levels[i - 1] + 1));
    expect(screen.getByRole('heading', { name: 'Parts' }).tagName).toBe('H2');
  });

  it('honours a replies cursor with Load more replies and does not duplicate', async () => {
    const page = Array.from({ length: 20 }, (_, i) => reply(i + 1, u1.uri, i === 0 ? 'first' : `r${i}`));
    const fx = mockApi((u) =>
      u.searchParams.get('cursor') === 'next'
        ? { update: full, author: { did: ALICE }, items: [...page, reply(30, u1.uri, 'second')], cursor: null }
        : { update: full, author: { did: ALICE }, items: page, cursor: 'next' },
    );
    renderPage();
    const more = await screen.findByRole('button', { name: 'Load more replies' });
    fireEvent.click(more);
    expect(await screen.findByText('second')).toBeInTheDocument();
    expect(screen.getAllByText('first')).toHaveLength(1);
    expect(fx.calls.at(-1)!.searchParams.get('cursor')).toBe('next');
  });
});
