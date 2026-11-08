import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { optimistic } from '../optimistic';
import { createCrosspost } from '../records/crosspost';
import { WriteError } from '../records/errors';
import { resizeImage } from '../records/image';
import { createUpdate } from '../records/write';
import { ALICE, mockApi } from '../testUtils';
import { NewUpdate } from './NewUpdate';

const h = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('../auth/SessionContext', () => ({ useSession: () => ({ session: h.session, loading: false, signOut: vi.fn() }) }));
vi.mock('../records/write', () => ({ createUpdate: vi.fn() }));
vi.mock('../records/crosspost', async (orig) => ({ ...(await orig<typeof import('../records/crosspost')>()), createCrosspost: vi.fn() }));
vi.mock('../records/image', async (importOriginal) => ({
  ImageTooLargeError: (await importOriginal<typeof import('../records/image')>()).ImageTooLargeError,
  resizeImage: vi.fn(),
}));

const nav = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => {
      const real = actual.useNavigate();
      return (to: string) => {
        nav.calls.push(to);
        real(to);
      };
    },
  };
});

const CID = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const UPDATE_URI = `at://${ALICE}/pub.workbench.update/3kupdate`;
const blobDef = { image: { $type: 'blob' as const, ref: { $link: CID }, mimeType: 'image/jpeg', size: 1234 }, alt: 'A board' };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/p/${ALICE}/p1/update`]}>
      <Routes>
        <Route path="/p/:did/:rkey/update" element={<NewUpdate />} />
        <Route path="/p/:did/:rkey" element={<p>timeline page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** console.error calls other than React's act() test warnings (the page itself updates state outside act in tests). */
const realErrors = () => vi.mocked(console.error).mock.calls.map((c) => String(c[0])).filter((m) => !m.includes('act(...)'));

const fill = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: /post update/i }));
const box = () => screen.getByRole('checkbox', { name: /also post this to bluesky/i });
const png = (name: string) => new File(['x'], name, { type: 'image/png' });

beforeEach(() => {
  nav.calls.length = 0;
  localStorage.clear();
  h.session = { did: ALICE, handle: 'alice.test', agent: {} };
  mockApi((u) => (u.pathname === `/api/projects/${ALICE}/p1` ? { project: { title: 'Synth' }, items: [], cursor: null } : undefined));
  vi.mocked(resizeImage).mockImplementation(async (f: File) => new Blob([`resized-${f.name}`], { type: 'image/jpeg' }));
  vi.mocked(createUpdate).mockResolvedValue({ uri: UPDATE_URI, images: [blobDef] });
  vi.mocked(createCrosspost).mockResolvedValue({ uri: `at://${ALICE}/app.bsky.feed.post/3kpost` });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  optimistic.clear();
});

describe('cross-post to Bluesky (opt-in)', () => {
  it('is unchecked by default, shows no caption box, and an unchecked box makes no cross-post calls', async () => {
    renderPage();
    expect(box()).not.toBeChecked();
    expect(screen.queryByLabelText(/bluesky caption/i)).toBeNull();
    fill(/heading/i, 'h');
    fill(/notes/i, 'n');
    submit();
    await screen.findByText('timeline page');
    expect(createUpdate).toHaveBeenCalledTimes(1);
    expect(createCrosspost).not.toHaveBeenCalled();
  });

  it('tells the user that deleting the update later does not delete the Bluesky post', async () => {
    renderPage();
    fireEvent.click(box());
    expect(await screen.findByText(/deleting the update later does not delete the bluesky post/i)).toBeInTheDocument();
  });

  it('blocks typing past the byte limit with multi-codepoint emoji and says so', async () => {
    renderPage();
    fireEvent.click(box());
    const caption = (await screen.findByLabelText(/bluesky caption/i)) as HTMLTextAreaElement;
    fireEvent.change(caption, { target: { value: '👨‍👩‍👧‍👦'.repeat(150) } });
    expect(new TextEncoder().encode(caption.value).length).toBeLessThanOrEqual(3000 - 60);
    expect(caption.value.length).toBeLessThan('👨‍👩‍👧‍👦'.repeat(150).length);
    expect(screen.getByText(/size limit nearly reached/i)).toBeInTheDocument();
  });

  it('prefills an editable caption from the project title and heading, with a grapheme counter and a note about the link', async () => {
    renderPage();
    fill(/heading/i, 'Cut the panel');
    fireEvent.click(box());
    const caption = (await screen.findByLabelText(/bluesky caption/i)) as HTMLTextAreaElement;
    await waitFor(() => expect(caption.value).toBe('Synth: Cut the panel'));
    expect(screen.getByText(/posts a link back to this update\. your followers on bluesky will see it\./i)).toBeInTheDocument();
    expect(screen.getByText(/characters left\. the link back takes/i)).toBeInTheDocument();
    fireEvent.change(caption, { target: { value: 'My own words' } });
    fill(/heading/i, 'Changed heading'); // an edited caption is not overwritten
    expect(caption.value).toBe('My own words');
  });

  it('creates the update first, then the Bluesky post with the permalink, caption and first photo blob', async () => {
    const order: string[] = [];
    vi.mocked(createUpdate).mockImplementation(async () => {
      order.push('update');
      return { uri: UPDATE_URI, images: [blobDef] };
    });
    vi.mocked(createCrosspost).mockImplementation(async () => {
      order.push('crosspost');
      return { uri: 'at://x/app.bsky.feed.post/1' };
    });
    renderPage();
    fill(/heading/i, 'Cut the panel');
    fill(/notes/i, 'It fits well');
    const file = png('a.png');
    fireEvent.change(screen.getByLabelText(/add photos/i), { target: { files: [file] } });
    fill(/alt text for photo 1/i, 'A board');
    fireEvent.click(box());
    await waitFor(() => expect((screen.getByLabelText(/bluesky caption/i) as HTMLTextAreaElement).value).toBe('Synth: Cut the panel'));
    submit();
    await screen.findByText('timeline page', {}, { timeout: 3000 });
    expect(order).toEqual(['update', 'crosspost']);
    const [, input] = vi.mocked(createCrosspost).mock.calls[0];
    expect(input.url).toBe(`https://workbench.pub/u/${ALICE}/3kupdate`);
    expect(input.caption).toBe('Synth: Cut the panel');
    expect(input.title).toBe('Synth: Cut the panel');
    expect(input.description).toBe('It fits well');
    expect(input.thumb?.ref).toEqual(blobDef.image);
    expect(input.thumb?.original).toBe(file);
  });

  it('keeps the update saved and shows a notice, not an error, when the Bluesky post fails; no retry', async () => {
    vi.mocked(createCrosspost).mockRejectedValue(new WriteError('Could not post to Bluesky. Please try again.', { stage: 'crosspost', status: 403, errorName: 'ScopeMissing' }));
    renderPage();
    fill(/heading/i, 'h');
    fill(/notes/i, 'n');
    fireEvent.click(box());
    await waitFor(() => expect((screen.getByLabelText(/bluesky caption/i) as HTMLTextAreaElement).value).toBe('Synth: h'));
    submit();
    const notice = await screen.findByText(/your update is posted\. the bluesky post did not go through: scopemissing \(crosspost\)/i);
    expect(notice).toHaveTextContent('Sign out and sign in again to allow posting to Bluesky.');
    expect(notice).toHaveTextContent('You can post it to Bluesky yourself.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('timeline page')).toBeNull();
    expect(screen.getByRole('link', { name: /back to the project/i })).toBeInTheDocument();
    expect(createUpdate).toHaveBeenCalledTimes(1);
    expect(createCrosspost).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /post update/i })).toBeNull(); // locked: no second update or post
  });

  it('does not cross-post when the update itself fails', async () => {
    vi.mocked(createUpdate).mockRejectedValue(new Error('x'));
    renderPage();
    fill(/heading/i, 'h');
    fill(/notes/i, 'n');
    fireEvent.click(box());
    submit();
    await screen.findByRole('alert');
    expect(createCrosspost).not.toHaveBeenCalled();
  });

  it('remembers the choice per account', async () => {
    const a = renderPage();
    fireEvent.click(box());
    a.unmount();
    renderPage();
    expect(box()).toBeChecked();
    cleanup();
    h.session = { did: 'did:plc:bcdefghijklmnopqrstuvwxy', handle: 'bob.test', agent: {} };
    render(
      <MemoryRouter initialEntries={['/p/did:plc:bcdefghijklmnopqrstuvwxy/p1/update']}>
        <Routes>
          <Route path="/p/:did/:rkey/update" element={<NewUpdate />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(box()).not.toBeChecked();
  });

  it('requires a caption when the box is checked', async () => {
    renderPage();
    fill(/heading/i, 'h');
    fill(/notes/i, 'n');
    fireEvent.click(box());
    const caption = await screen.findByLabelText(/bluesky caption/i);
    fireEvent.change(caption, { target: { value: '   ' } });
    submit();
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/caption/i);
    expect(document.activeElement).toBe(caption);
    expect(createUpdate).not.toHaveBeenCalled();
  });

  async function fillAndTick() {
    renderPage();
    fill(/heading/i, 'h');
    fill(/notes/i, 'n');
    fireEvent.click(box());
    await waitFor(() => expect((screen.getByLabelText(/bluesky caption/i) as HTMLTextAreaElement).value).toBe('Synth: h'));
    submit();
  }

  it('confirms "Posted to Bluesky" in the posted view, then goes to the project', async () => {
    await fillAndTick();
    expect(await screen.findByText(/posted to bluesky\./i)).toBeInTheDocument();
    expect(await screen.findByText('timeline page', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(nav.calls).toEqual([`/p/${ALICE}/p1`]);
  });

  it('does not navigate, and nothing crashes, when the user leaves mid-cross-post and it then succeeds', async () => {
    let resolve!: (v: { uri: string }) => void;
    vi.mocked(createCrosspost).mockReturnValue(new Promise((r) => (resolve = r)));
    await fillAndTick();
    await screen.findByText(/posting to bluesky/i);
    fireEvent.click(screen.getByRole('link', { name: /back to the project/i }));
    expect(await screen.findByText('timeline page')).toBeInTheDocument();
    resolve({ uri: 'at://x/app.bsky.feed.post/1' });
    await new Promise((r) => setTimeout(r, 1800));
    expect(nav.calls).toEqual([]);
    expect(realErrors()).toEqual([]);
  });

  it('still goes to the project after a modified click on Back to the project (new tab, page kept)', async () => {
    let resolve!: (v: { uri: string }) => void;
    vi.mocked(createCrosspost).mockReturnValue(new Promise((r) => (resolve = r)));
    await fillAndTick();
    await screen.findByText(/posting to bluesky/i);
    const back = screen.getByRole('link', { name: /back to the project/i });
    fireEvent.click(back, { ctrlKey: true });
    fireEvent.click(back, { metaKey: true });
    fireEvent.click(back, { shiftKey: true });
    fireEvent.click(back, { button: 1 });
    resolve({ uri: 'at://x/app.bsky.feed.post/1' });
    expect(await screen.findByText(/posted to bluesky\./i)).toBeInTheDocument();
    expect(await screen.findByText('timeline page', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(nav.calls).toEqual([`/p/${ALICE}/p1`]);
  });

  it('does not crash or navigate when the user leaves and the cross-post then fails', async () => {
    let reject!: (e: unknown) => void;
    vi.mocked(createCrosspost).mockReturnValue(new Promise((_, rej) => (reject = rej)));
    await fillAndTick();
    await screen.findByText(/posting to bluesky/i);
    fireEvent.click(screen.getByRole('link', { name: /back to the project/i }));
    await screen.findByText('timeline page');
    reject(new WriteError('x', { stage: 'crosspost', status: 500, errorName: 'InternalServerError' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(nav.calls).toEqual([]);
    expect(screen.getByText('timeline page')).toBeInTheDocument();
    expect(realErrors()).toEqual([]);
  });
});
