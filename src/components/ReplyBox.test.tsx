import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { optimistic } from '../optimistic';
import { WriteError } from '../records/errors';
import { createReply } from '../records/write';
import { ALICE } from '../testUtils';
import { ReplyBox } from './ReplyBox';

const h = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('../auth/SessionContext', () => ({ useSession: () => ({ session: h.session, loading: false, signOut: vi.fn() }) }));
vi.mock('../records/write', () => ({ createReply: vi.fn() }));

const SUBJECT = `at://${ALICE}/pub.workbench.update/u1`;
let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  optimistic.clear();
});

describe('ReplyBox', () => {
  it('renders nothing when signed out', () => {
    h.session = null;
    const { container } = render(<ReplyBox subjectUri={SUBJECT} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('posts a reply to the update uri and adds it optimistically', async () => {
    h.session = { did: 'did:plc:me', handle: 'me.test', agent: {} };
    vi.mocked(createReply).mockResolvedValue({ uri: 'at://did:plc:me/pub.workbench.reply/r1' });
    render(<ReplyBox subjectUri={SUBJECT} />);
    const box = screen.getByLabelText(/your reply/i);
    expect(box).toHaveAttribute('maxlength', '2000');
    fireEvent.click(screen.getByRole('button', { name: /post reply/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/write something/i);
    expect(createReply).not.toHaveBeenCalled();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box.getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id);
    fireEvent.change(box, { target: { value: ' Nice build ' } });
    fireEvent.click(screen.getByRole('button', { name: /post reply/i }));
    await waitFor(() => expect(createReply).toHaveBeenCalledWith(h.session, { subject: SUBJECT, body: 'Nice build' }));
    await waitFor(() => expect(box).toHaveValue(''));
    expect(optimistic.find('at://did:plc:me/pub.workbench.reply/r1')).toMatchObject({ kind: 'reply', subjectUri: SUBJECT, body: 'Nice build', did: 'did:plc:me' });
  });

  it('shows a friendly error on failure and keeps the text', async () => {
    h.session = { did: 'did:plc:me', handle: 'me.test', agent: {} };
    vi.mocked(createReply).mockRejectedValue(new Error('boom {"token":"x"}'));
    render(<ReplyBox subjectUri={SUBJECT} />);
    fireEvent.change(screen.getByLabelText(/your reply/i), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /post reply/i }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/token/);
    expect(screen.getByLabelText(/your reply/i)).toHaveValue('hi');
  });

  it('reports success, clears the box and does not post twice when the step after the write throws', async () => {
    h.session = { did: 'did:plc:me', handle: 'me.test', agent: {} };
    vi.mocked(createReply).mockResolvedValue({ uri: 'at://did:plc:me/pub.workbench.reply/r1' });
    vi.spyOn(optimistic, 'add').mockImplementation(() => {
      throw new Error('store broke');
    });
    render(<ReplyBox subjectUri={SUBJECT} />);
    fireEvent.change(screen.getByLabelText(/your reply/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /post reply/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/posted\. it can take a minute/i);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText(/your reply/i)).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /post reply/i }));
    expect(createReply).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toMatch(/stage=after-write.*store broke/);
  });

  it('shows the stage and server error name with a recovery step', async () => {
    h.session = { did: 'did:plc:me', handle: 'me.test', agent: {} };
    vi.mocked(createReply).mockRejectedValue(new WriteError('Could not save to your PDS. Please try again.', { stage: 'create', status: 401, errorName: 'InvalidToken' }));
    render(<ReplyBox subjectUri={SUBJECT} />);
    fireEvent.change(screen.getByLabelText(/your reply/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /post reply/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not post your reply. The server said: InvalidToken (create). Your session has expired. Sign in again.');
  });
});
