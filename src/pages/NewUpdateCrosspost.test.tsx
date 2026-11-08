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

const fill = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: /post update/i }));
const box = () => screen.getByRole('checkbox', { name: /also post this to bluesky/i });
const png = (name: string) => new File(['x'], name, { type: 'image/png' });

beforeEach(() => {
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
    await screen.findByText('timeline page');
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
});
