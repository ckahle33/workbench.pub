import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../api';
import { json } from '../testUtils';
import { ReportButton } from './ReportButton';

const URI = 'at://did:plc:x/pub.workbench.update/u1';
let calls: { url: string; init?: RequestInit }[];
const respond = (status: number) => {
  calls = [];
  api.setFetch(async (url, init) => {
    calls.push({ url, init });
    return json(status < 300 ? { ok: true } : { error: 'raw server text' }, status);
  });
};
const open = () => fireEvent.click(screen.getByRole('button', { name: /^report/i }));
const send = () => fireEvent.click(screen.getByRole('button', { name: /send report/i }));

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  api.setFetch(null);
  errSpy.mockRestore();
  vi.restoreAllMocks();
});

describe('ReportButton', () => {
  it('posts the uri and reason', async () => {
    respond(201);
    render(<ReportButton uri={URI} />);
    open();
    const reason = screen.getByLabelText(/reason/i);
    expect(reason).toHaveAttribute('maxlength', '500');
    fireEvent.change(reason, { target: { value: 'spam' } });
    send();
    expect(await screen.findByText(/thanks/i)).toBeInTheDocument();
    expect(calls[0].url).toBe('/api/report');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ uri: URI, reason: 'spam' });
  });

  it.each([
    [429, /already reported|too many/i],
    [503, /temporarily unavailable/i],
    [400, /could not be sent/i],
    [500, /something went wrong/i],
  ])('shows a friendly message for status %i', async (status, re) => {
    respond(status);
    render(<ReportButton uri={URI} />);
    open();
    send();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(re);
    expect(alert.textContent).not.toMatch(/raw server/);
    await waitFor(() => expect(screen.getByRole('button', { name: /send report/i })).not.toHaveAttribute('aria-disabled'));
  });

  it('still shows success when remembering the report fails, and logs it as after-write', async () => {
    respond(201);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    render(<ReportButton uri={URI} />);
    open();
    send();
    expect(await screen.findByText(/thanks/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toMatch(/stage=after-write/);
    expect(calls).toHaveLength(1);
  });

  it('logs exactly one sanitized line for a failed report', async () => {
    respond(503);
    render(<ReportButton uri={URI} />);
    open();
    send();
    await screen.findByRole('alert');
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toBe('[write] stage=create status=503 error=ReportFailed message=""');
  });
});
