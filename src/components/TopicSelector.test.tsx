import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createTopic } from '../records/write';
import { ALICE, mockApi } from '../testUtils';
import { TopicSelector } from './Composer';

const h = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('../auth/SessionContext', () => ({ useSession: () => ({ session: h.session, loading: false, signOut: vi.fn() }) }));
vi.mock('../records/write', () => ({ createTopic: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

describe('TopicSelector create', () => {
  it('keeps the created topic and shows no error when the step after the write throws', async () => {
    h.session = { did: ALICE, handle: 'a.test', agent: {} };
    mockApi(() => ({ items: [], cursor: null }));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(createTopic).mockResolvedValue({ uri: `at://${ALICE}/pub.workbench.topic/x`, slug: 'lasers' });
    const onChange = vi.fn(() => {
      throw new Error('parent broke');
    });
    render(<TopicSelector value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/^topic/i), { target: { value: '__new__' } });
    fireEvent.change(screen.getByLabelText(/new topic name/i), { target: { value: 'Lasers' } });
    fireEvent.click(screen.getByRole('button', { name: /^create topic/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('lasers'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(createTopic).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('option', { name: /Lasers/ })).toBeInTheDocument();
    expect(String(err.mock.calls[0][0])).toMatch(/stage=after-write/);
  });
});
