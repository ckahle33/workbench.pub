import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FeedItem } from '../api';
import { ALICE, image, project, update } from '../testUtils';
import { FeedCard } from './FeedCard';

const item = (over: Record<string, unknown> = {}): FeedItem =>
  ({ ...update(1, { heading: 'Wired the board', ...over }), project: { ...project(1), title: 'Fuzz pedal' } }) as FeedItem;

const renderCard = (i: FeedItem) =>
  render(
    <MemoryRouter>
      <ul>
        <FeedCard item={i} />
      </ul>
    </MemoryRouter>,
  );

describe('FeedCard', () => {
  it('links the project title and the update heading; the visual is hidden from assistive tech', () => {
    const { container } = renderCard(item());
    expect(screen.getByRole('link', { name: 'Fuzz pedal' })).toHaveAttribute('href', `/p/${ALICE}/p1`);
    expect(screen.getByRole('link', { name: 'Wired the board' })).toHaveAttribute('href', `/u/${ALICE}/u1`);
    const visual = container.querySelector('.card-visual')!;
    expect(visual).toHaveAttribute('aria-hidden', 'true');
    expect(visual).toHaveAttribute('tabindex', '-1');
    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-11-01T10:00:00.000Z');
  });

  it('shows a typographic tile with the project title when the update has no photo', () => {
    const { container } = renderCard(item());
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.tile .tile-title')).toHaveTextContent('Fuzz pedal');
  });

  it('shows the first photo, and swaps it for the tile when it fails to load', () => {
    const { container } = renderCard(item({ images: [image('bafyone', 'Board from above'), image('bafytwo', 'Side')] }));
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', `/api/blob/${ALICE}/bafyone`);
    expect(img).toHaveAttribute('alt', 'Board from above');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(container.querySelector('.tile')).toBeNull();
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.tile .tile-title')).toHaveTextContent('Fuzz pedal');
  });
});
