import { fireEvent, render, screen } from '@testing-library/react';
import { Photo } from './Photo';

describe('Photo', () => {
  it('replaces a failed image with a labelled panel that keeps the alt text', () => {
    render(<Photo src="/api/blob/x/missing" alt="Enclosure with five holes" width={800} height={600} />);
    const img = screen.getByRole('img', { name: 'Enclosure with five holes' });
    expect(img.tagName).toBe('IMG');
    fireEvent.error(img);
    const panel = screen.getByRole('img', { name: 'Enclosure with five holes' });
    expect(panel.tagName).toBe('DIV');
    expect(panel).toHaveTextContent(/photo unavailable/i);
  });
});
