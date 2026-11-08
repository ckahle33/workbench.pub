import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { optimistic } from '../optimistic';
import { deleteRecord } from '../records/write';
import { ALICE, BOB } from '../testUtils';
import { DeleteButton } from './DeleteButton';

const sess = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('../auth/SessionContext', () => ({ useSession: () => ({ session: sess.session, loading: false, signOut: vi.fn() }) }));
vi.mock('../records/write', () => ({ deleteRecord: vi.fn() }));

const URI = `at://${ALICE}/pub.workbench.update/u1`;
const P = `at://${ALICE}/pub.workbench.project/p1`;

beforeEach(() => {
  sess.session = { did: ALICE, handle: 'alice.test', agent: {} };
});
afterEach(() => {
  vi.resetAllMocks();
  optimistic.clear();
});

const renderBtn = (onDeleted = vi.fn()) => {
  render(<DeleteButton uri={URI} kind="update" parentUri={P} label="Delete update" onDeleted={onDeleted} />);
  return onDeleted;
};

describe('DeleteButton cross-post warning', () => {
  const WARN = /does not delete a bluesky post made from it/i;
  it('warns in the update confirmation, and only there', () => {
    renderBtn();
    expect(screen.queryByText(WARN)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete update' }));
    expect(screen.getByText(WARN)).toBeInTheDocument();
  });

  it('does not show the warning when deleting a reply', () => {
    render(<DeleteButton uri={`at://${ALICE}/pub.workbench.reply/r1`} kind="reply" label="Delete reply" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete reply' }));
    expect(screen.queryByText(WARN)).toBeNull();
  });
});

describe('DeleteButton', () => {
  it('is shown only to the owner', () => {
    sess.session = { did: BOB, handle: 'bob.test', agent: {} };
    renderBtn();
    expect(screen.queryByRole('button', { name: 'Delete update' })).toBeNull();
    sess.session = null;
    renderBtn();
    expect(screen.queryByRole('button', { name: 'Delete update' })).toBeNull();
  });

  it('asks for confirmation; Cancel backs out without deleting', () => {
    renderBtn();
    fireEvent.click(screen.getByRole('button', { name: 'Delete update' }));
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Delete update' })).toHaveFocus();
    expect(deleteRecord).not.toHaveBeenCalled();
  });

  it('deletes on confirm, hides the item optimistically and reports back; a second click while busy is ignored', async () => {
    let resolve!: () => void;
    vi.mocked(deleteRecord).mockReturnValue(new Promise<void>((r) => (resolve = r)));
    const onDeleted = renderBtn();
    fireEvent.click(screen.getByRole('button', { name: 'Delete update' }));
    const confirm = screen.getByRole('button', { name: /confirm delete|deleting/i });
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(confirm);
    expect(deleteRecord).toHaveBeenCalledTimes(1);
    expect(deleteRecord).toHaveBeenCalledWith(sess.session, URI);
    resolve();
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(optimistic.isRemoved(URI)).toBe(true);
  });

  it('shows a plain error and does not hide the item when the delete fails', async () => {
    vi.mocked(deleteRecord).mockRejectedValue(new Error('500 {"raw":"server"}'));
    renderBtn();
    fireEvent.click(screen.getByRole('button', { name: 'Delete update' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not delete. Please try again.');
    expect(alert.textContent).not.toMatch(/raw/);
    expect(optimistic.isRemoved(URI)).toBe(false);
    expect(screen.getByRole('button', { name: 'Confirm delete' })).not.toHaveAttribute('aria-disabled');
  });
});
