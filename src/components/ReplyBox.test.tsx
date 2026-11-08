import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { optimistic } from '../optimistic';
import { createReply } from '../records/write';
import { ALICE } from '../testUtils';
import { ReplyBox } from './ReplyBox';

const h = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('../auth/SessionContext', () => ({ useSession: () => ({ session: h.session, loading: false, signOut: vi.fn() }) }));
vi.mock('../records/write', () => ({ createReply: vi.fn() }));

const SUBJECT = `at://${ALICE}/pub.workbench.update/u1`;
afterEach(() => {
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
});
