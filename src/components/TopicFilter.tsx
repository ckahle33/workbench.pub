import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { TopicInfo } from '../api';
import { usePaged } from '../hooks';

type TopicItem = TopicInfo & { uri: string };
const MAX_EXTRA_PAGES = 10;

/**
 * The feed's left column: "All updates" plus every topic, the current one bold with a red marker.
 * Topics come from /api/topics. If the current topic is not on the first page, further pages are
 * loaded (at most MAX_EXTRA_PAGES) until it appears or the list ends; if loading fails the list is simply shorter.
 */
export function TopicFilter({ current }: { current?: string }) {
  const list = usePaged<TopicItem>('/api/topics');
  const topics = list.phase === 'ready' ? list.items.filter((t) => typeof t.slug === 'string' && typeof t.name === 'string') : [];
  const listRef = useRef<HTMLUListElement>(null);
  const extraPages = useRef(0);
  const found = current === undefined || topics.some((t) => t.slug === current);
  const { hasMore, loadingMore, moreFailed, loadMore } = list;
  useEffect(() => {
    if (list.phase !== 'ready' || found || !hasMore || loadingMore || moreFailed || extraPages.current >= MAX_EXTRA_PAGES) return;
    extraPages.current += 1;
    loadMore();
  }, [list.phase, found, hasMore, loadingMore, moreFailed, loadMore, list.items.length]);
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
          <Link to="/feed" aria-current={current === undefined ? 'page' : undefined}>
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
