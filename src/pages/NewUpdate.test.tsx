import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { optimistic } from '../optimistic';
import { resizeImage } from '../records/image';
import { createUpdate } from '../records/write';
import { ALICE, BOB } from '../testUtils';
import { NewUpdate } from './NewUpdate';

const h = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('../auth/SessionContext', () => ({ useSession: () => ({ session: h.session, loading: false, signOut: vi.fn() }) }));
vi.mock('../records/write', () => ({ createUpdate: vi.fn() }));
vi.mock('../records/image', () => ({ resizeImage: vi.fn() }));

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
    await waitFor(() => expect(screen.getByRole('button', { name: /post update/i })).toBeEnabled());
  });
});
