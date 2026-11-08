import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { optimistic } from '../optimistic';
import { ImageTooLargeError, resizeImage } from '../records/image';
import { createUpdate } from '../records/write';
import { ALICE, BOB } from '../testUtils';
import { NewUpdate } from './NewUpdate';

const h = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('../auth/SessionContext', () => ({ useSession: () => ({ session: h.session, loading: false, signOut: vi.fn() }) }));
vi.mock('../records/write', () => ({ createUpdate: vi.fn() }));
vi.mock('../records/image', async (importOriginal) => ({
  ImageTooLargeError: (await importOriginal<typeof import('../records/image')>()).ImageTooLargeError,
  resizeImage: vi.fn(),
}));

const PROJECT = `at://${ALICE}/pub.workbench.project/p1`;

function renderPage(did = ALICE) {
  return render(
    <MemoryRouter initialEntries={[`/p/${did}/p1/update`]}>
      <Routes>
        <Route path="/p/:did/:rkey/update" element={<NewUpdate />} />
        <Route path="/p/:did/:rkey" element={<p>timeline page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const png = (name: string) => new File(['x'], name, { type: 'image/png' });
const pick = (...files: File[]) => fireEvent.change(screen.getByLabelText(/add photos/i), { target: { files } });
const fill = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: /post update/i }));

beforeEach(() => {
  h.session = { did: ALICE, handle: 'alice.test', agent: {} };
  vi.mocked(resizeImage).mockImplementation(async (f: File) => new Blob([`resized-${f.name}`], { type: 'image/jpeg' }));
});
afterEach(() => {
  vi.resetAllMocks();
  optimistic.clear();
});

describe('NewUpdate', () => {
  it('shows a sign-in prompt when signed out', () => {
    h.session = null;
    renderPage();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/signin');
    expect(screen.queryByLabelText(/heading/i)).toBeNull();
  });

  it('refuses when the project belongs to another did', () => {
    renderPage(BOB);
    expect(screen.getByText(/only add updates to your own projects/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/heading/i)).toBeNull();
  });

  it('requires heading, notes and alt text for every image', async () => {
    renderPage();
    pick(png('a.png'), png('b.png'));
    fill(/alt text for photo 1/i, 'A board');
    submit();
    const text = screen.getAllByRole('alert').map((a) => a.textContent).join(' ');
    expect(text).toMatch(/heading/i);
    expect(text).toMatch(/alt text/i);
    expect(screen.getByLabelText(/alt text for photo 2/i)).toBeInvalid();
    expect(screen.getByLabelText(/alt text for photo 1/i)).toBeValid();
    expect(createUpdate).not.toHaveBeenCalled();
    expect(resizeImage).not.toHaveBeenCalled();
  });

  it('limits photos to 6 and rejects other file types', () => {
    renderPage();
    pick(...Array.from({ length: 8 }, (_, i) => png(`f${i}.png`)));
    expect(screen.getAllByLabelText(/alt text for photo/i)).toHaveLength(6);
    expect(screen.getByRole('alert')).toHaveTextContent(/up to 6 photos/i);
    pick(new File(['x'], 'doc.pdf', { type: 'application/pdf' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/doc\.pdf.*JPEG, PNG, WebP or GIF/);
    expect(screen.getAllByLabelText(/alt text for photo/i)).toHaveLength(6);
  });

  it('resizes before upload, passes resized blobs, converts the CID, adds optimistically and navigates', async () => {
    const cid = { toString: () => 'bafyPlain' };
    vi.mocked(createUpdate).mockResolvedValue({
      uri: `at://${ALICE}/pub.workbench.update/u9`,
      images: [{ image: { $type: 'blob', ref: { $link: cid as unknown as string }, mimeType: 'image/jpeg', size: 5 }, alt: 'A board' }],
    });
    renderPage();
    const file = png('a.png');
    fill(/heading/i, 'Cut the panel');
    fill(/notes/i, 'It fits');
    pick(file);
    fill(/alt text for photo 1/i, 'A board');
    fireEvent.click(screen.getByRole('button', { name: /add link/i }));
    fill(/link 1 address/i, 'https://example.com/x');
    fireEvent.click(screen.getByRole('button', { name: /add part/i }));
    fill(/part 1 item/i, 'Knob');
    fill(/part 1 quantity/i, '3');
    submit();
    expect(await screen.findByText('timeline page')).toBeInTheDocument();
    expect(resizeImage).toHaveBeenCalledWith(file);
    const input = vi.mocked(createUpdate).mock.calls[0][1];
    expect(input.project).toBe(PROJECT);
    expect(input.images).toHaveLength(1);
    expect(await input.images[0].file.text()).toBe('resized-a.png');
    expect(input.images[0].file.type).toBe('image/jpeg');
    expect(input.images[0].alt).toBe('A board');
    expect(input.links).toEqual([{ url: 'https://example.com/x' }]);
    expect(input.parts).toEqual([{ item: 'Knob', quantity: '3' }]);
    const opt = optimistic.find(`at://${ALICE}/pub.workbench.update/u9`) as unknown as { images: { image: { ref: { $link: unknown } } }[]; projectUri: string };
    expect(opt.projectUri).toBe(PROJECT);
    expect(opt.images[0].image.ref.$link).toBe('bafyPlain');
    expect(typeof opt.images[0].image.ref.$link).toBe('string');
  });

  it('rejects an invalid link address inline', () => {
    renderPage();
    fill(/heading/i, 'h');
    fill(/notes/i, 'n');
    fireEvent.click(screen.getByRole('button', { name: /add link/i }));
    fill(/link 1 address/i, 'javascript:alert(1)');
    submit();
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/http/i);
    expect(createUpdate).not.toHaveBeenCalled();
  });

  it('shows a friendly message and re-enables the button when saving fails', async () => {
    vi.mocked(createUpdate).mockRejectedValue(new Error('Could not save to your PDS. Please try again.'));
    renderPage();
    fill(/heading/i, 'h');
    fill(/notes/i, 'n');
    submit();
    expect(await screen.findByText(/could not save to your pds/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /post update/i })).not.toHaveAttribute('aria-disabled'));
  });

  it('focuses the alt field of the image missing alt text', () => {
    renderPage();
    fill(/heading/i, 'h');
    fill(/notes/i, 'n');
    pick(png('a.png'), png('b.png'));
    fill(/alt text for photo 1/i, 'ok');
    submit();
    expect(document.activeElement).toBe(screen.getByLabelText(/alt text for photo 2/i));
  });

  it('focuses the heading first, and ties errors to controls via aria-describedby', () => {
    renderPage();
    pick(new File(['x'], 'doc.pdf', { type: 'application/pdf' }));
    const fileErr = screen.getByRole('alert');
    expect(screen.getByLabelText(/add photos/i).getAttribute('aria-describedby')).toContain(fileErr.id);
    fireEvent.click(screen.getByRole('button', { name: /add link/i }));
    fill(/link 1 address/i, 'nope');
    fireEvent.click(screen.getByRole('button', { name: /add part/i }));
    fill(/part 1 item/i, 'Knob');
    pick(png('a.png'));
    submit();
    expect(document.activeElement).toBe(screen.getByLabelText(/heading/i));
    const alerts = screen.getAllByRole('alert');
    const has = (label: RegExp, re: RegExp) => {
      const err = alerts.find((a) => re.test(a.textContent ?? ''))!;
      expect(screen.getByLabelText(label).getAttribute('aria-describedby')).toContain(err.id);
    };
    has(/heading/i, /heading/i);
    has(/notes/i, /notes/i);
    has(/alt text for photo 1/i, /alt text is required/i);
    has(/link 1 address/i, /web address/i);
    has(/part 1 quantity/i, /item and a quantity/i);
    has(/part 1 item/i, /item and a quantity/i);
  });

  it('keeps focus on the submit button through a failed save and ignores a second activation while busy', async () => {
    let reject!: (e: Error) => void;
    vi.mocked(createUpdate).mockReturnValue(new Promise((_, rej) => (reject = rej)));
    renderPage();
    fill(/heading/i, 'h');
    fill(/notes/i, 'n');
    const btn = screen.getByRole('button', { name: /post update/i });
    btn.focus();
    fireEvent.click(btn);
    const busyBtn = await screen.findByRole('button', { name: /posting/i });
    expect(busyBtn).toBe(btn);
    expect(document.activeElement).toBe(btn);
    fireEvent.click(busyBtn);
    expect(createUpdate).toHaveBeenCalledTimes(1);
    reject(new Error('x'));
    await screen.findByText(/something went wrong/i);
    expect(document.activeElement).toBe(btn);
  });

  describe('photo processing', () => {
    const ready = () => {
      renderPage();
      fill(/heading/i, 'H');
      fill(/notes/i, 'N');
      pick(png('a.png'), png('b.png'), png('c.png'));
      for (const n of [1, 2, 3]) fill(new RegExp(`alt text for photo ${n}`, 'i'), `alt ${n}`);
    };

    it('resizes one photo at a time, in order', async () => {
      const log: string[] = [];
      vi.mocked(resizeImage).mockImplementation(async (f: File) => {
        log.push(`start ${f.name}`);
        await new Promise((r) => setTimeout(r, 5));
        log.push(`end ${f.name}`);
        return new Blob(['x'], { type: 'image/jpeg' });
      });
      vi.mocked(createUpdate).mockResolvedValue({ uri: `at://${ALICE}/pub.workbench.update/u1`, images: [] } as never);
      ready();
      submit();
      await screen.findByText('timeline page');
      expect(log).toEqual(['start a.png', 'end a.png', 'start b.png', 'end b.png', 'start c.png', 'end c.png']);
    });

    it('names the photo that could not be processed and does not save', async () => {
      vi.mocked(resizeImage).mockImplementation(async (f: File) => {
        if (f.name === 'b.png') throw new Error('Could not process this image');
        return new Blob(['x'], { type: 'image/jpeg' });
      });
      ready();
      submit();
      expect(await screen.findByText('Could not process photo 2. Try a different photo.')).toBeInTheDocument();
      expect(createUpdate).not.toHaveBeenCalled();
      expect(resizeImage).toHaveBeenCalledTimes(2);
    });

    it('says which photo is too large', async () => {
      vi.mocked(resizeImage).mockImplementation(async (f: File) => {
        if (f.name === 'c.png') throw new ImageTooLargeError();
        return new Blob(['x'], { type: 'image/jpeg' });
      });
      ready();
      submit();
      expect(await screen.findByText('Photo 3 is too large (over 25 MB). Choose a smaller one.')).toBeInTheDocument();
      expect(createUpdate).not.toHaveBeenCalled();
    });
  });
});
