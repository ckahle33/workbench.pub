import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { TopicInfo } from '../api';
import { usePaged } from '../hooks';

type TopicItem = TopicInfo & { uri: string };

/**
 * The feed's left column: "All updates" plus every topic, the current one bold with a red marker.
 * Topics come from /api/topics (first page); if that fails the list is simply shorter.
 */
export function TopicFilter({ current }: { current?: string }) {
  const list = usePaged<TopicItem>('/api/topics');
  const topics = list.phase === 'ready' ? list.items.filter((t) => typeof t.slug === 'string' && typeof t.name === 'string') : [];
  const listRef = useRef<HTMLUListElement>(null);
  // On phones the list is a horizontal row: bring the current topic into view (horizontally only).
  useEffect(() => {
    const ul = listRef.current;
    const cur = ul?.querySelector<HTMLElement>('[aria-current="page"]');
    if (ul && cur && ul.scrollWidth > ul.clientWidth) ul.scrollLeft = cur.offsetLeft - ul.offsetLeft - 16;
  }, [topics.length, current]);
  return (
    <nav className="filter" aria-label="Topics">
      <span className="label filter-label">Show</span>
      <ul className="filter-list" ref={listRef}>
        <li>
          <Link to="/" aria-current={current === undefined ? 'page' : undefined}>
            All updates
          </Link>
        </li>
        {topics.map((t) => (
          <li key={t.slug}>
            <Link to={`/t/${t.slug}`} aria-current={current === t.slug ? 'page' : undefined} dir="auto">
              {t.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
