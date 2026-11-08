import { render, screen } from '@testing-library/react';
import { LinkCard } from './LinkCard';
import { json, mockApi } from '../testUtils';

describe('LinkCard', () => {
  it('shows the card title and description from /api/card', async () => {
    const fx = mockApi((u) =>
      u.pathname === '/api/card' ? { url: 'https://example.com/x', title: 'Example card', description: 'About it' } : undefined,
    );
    render(<LinkCard url="https://example.com/x" />);
    expect(await screen.findByText('Example card')).toBeInTheDocument();
    expect(screen.getByText('About it')).toBeInTheDocument();
    expect(fx.calls[0].searchParams.get('url')).toBe('https://example.com/x');
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://example.com/x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  });

  it('falls back to a plain link when the card request fails', async () => {
    const fx = mockApi(() => json({ error: 'fetch failed' }, 502));
    render(<LinkCard url="https://example.com/x" />);
    await vi.waitFor(() => expect(fx.calls).toHaveLength(1));
    const link = await screen.findByRole('link', { name: 'https://example.com/x' });
    expect(link).toHaveAttribute('href', 'https://example.com/x');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  });

  it('uses the link title in the fallback when the record has one', () => {
    mockApi(() => new Promise(() => {}) as never);
    render(<LinkCard url="https://example.com/x" title="My notes" />);
    expect(screen.getByRole('link', { name: 'My notes' })).toBeInTheDocument();
  });

  it('refuses a javascript: href and does not even request a card', () => {
    const fx = mockApi(() => undefined);
    render(<LinkCard url="javascript:alert(1)" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
    expect(fx.calls).toHaveLength(0);
  });
});
