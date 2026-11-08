import { Agent } from '@atproto/api';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReplyBox } from './ReplyBox';

// No mocked writers here: the real createReply runs against the real agent and a fake PDS.
const h = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('../auth/SessionContext', () => ({ useSession: () => ({ session: h.session, loading: false, signOut: vi.fn() }) }));

const DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const SUBJECT = `at://${DID}/pub.workbench.update/u1`;

function reply(handler: () => Promise<Response>) {
  h.session = { did: DID, handle: 'me.test', agent: new Agent(handler) };
  render(<ReplyBox subjectUri={SUBJECT} />);
  fireEvent.change(screen.getByLabelText(/your reply/i), { target: { value: 'hello' } });
  fireEvent.click(screen.getByRole('button', { name: /post reply/i }));
}
const json = (o: unknown, status: number) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.restoreAllMocks());

describe('a failed server call end to end', () => {
  it('shows stage and error name and logs exactly one sanitized line', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    reply(async () => json({ error: 'ScopeMissing', message: 'Missing scope at://did:plc:x?code=SECRET&state=abc' }, 403));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not post your reply. The server said: ScopeMissing (create).');
    expect(alert).toHaveTextContent(/not given permission.*sign out/i);
    expect(err).toHaveBeenCalledTimes(1);
    const line = String(err.mock.calls[0][0]);
    expect(line).toMatch(/^\[write\] stage=create status=403 error=ScopeMissing message="/);
    expect(line).not.toMatch(/SECRET|did:plc|code=/);
  });

  it('says to check the connection when the network fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reply(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/\(create\)\. Check your internet connection/);
  });

  it('asks to wait on a rate limit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reply(async () => json({ error: 'RateLimitExceeded', message: 'slow down' }, 429));
    expect(await screen.findByRole('alert')).toHaveTextContent(/RateLimitExceeded \(create\)\. .*Wait a few minutes/);
  });
});
