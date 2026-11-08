import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { FeedItem } from '../api';
import { useSession } from '../auth/SessionContext';
import { FeedCard } from '../components/FeedCard';
import { LoadMore, Status } from '../components/Status';
import { TopicFilter } from '../components/TopicFilter';
import { usePaged, useTitle } from '../hooks';
import { optimistic, useOptimistic } from '../optimistic';

function FeedList({ path, empty, emptyAction }: { path: string; empty: string; emptyAction?: ReactNode }) {
  const feed = usePaged<FeedItem>(path);
  useOptimistic();
  if (feed.phase === 'loading') return <Status kind="loading" />;
  if (feed.phase !== 'ready') return <Status kind="error" />;
  // Items the signed-in user just deleted stay hidden until the server drops them.
  const items = feed.items.filter((u) => !optimistic.isRemoved(u.uri) && !optimistic.isRemoved(u.project.uri));
  return (
    <>
      {items.length === 0 ? (
        <Status kind="empty" action={emptyAction}>
          {empty}
        </Status>
      ) : (
        <ul className="cards">
          {items.map((u) => (
            <FeedCard key={u.uri} item={u} />
          ))}
        </ul>
      )}
      <LoadMore hasMore={feed.hasMore} loading={feed.loadingMore} failed={feed.moreFailed} onClick={feed.loadMore} />
    </>
  );
}

type View = 'following' | 'everyone';

export function Feed() {
  useTitle('Feed');
  const { session, loading } = useSession();
  const [chosen, setChosen] = useState<View | null>(null);
  // Signed in: what you follow first; anyone else sees everything.
  const view: View = session ? (chosen ?? 'following') : 'everyone';
  return (
    <div className="with-filter">
      <div className="filter-col">
        <TopicFilter />
      </div>
      <div className="main-col">
        <div className="feed-head">
          <h1>Latest</h1>
          {!loading && session && (
            <div className="segmented" role="group" aria-label="Show updates from">
              <button type="button" aria-pressed={view === 'following'} onClick={() => setChosen('following')}>
                Following
              </button>
              <button type="button" aria-pressed={view === 'everyone'} onClick={() => setChosen('everyone')}>
                Everyone
              </button>
            </div>
          )}
        </div>
        <section aria-labelledby="feed-h" className="feed">
          <h2 id="feed-h" className="visually-hidden">
            {view === 'following' ? 'Following' : 'Everyone'}
          </h2>
          {view === 'following' && session ? (
            <FeedList
              key="following"
              path={`/api/feed?following=${encodeURIComponent(session.did)}`}
              empty="Nothing from what you follow yet. Follow a project or topic to see it here."
              emptyAction={
                <button type="button" onClick={() => setChosen('everyone')}>
                  See everyone
                </button>
              }
            />
          ) : (
            <FeedList
              key="everyone"
              path="/api/feed"
              empty="Nothing here yet."
              emptyAction={
                session ? (
                  <Link to="/new" className="btn btn-primary">
                    Start a project
                  </Link>
                ) : undefined
              }
            />
          )}
        </section>
      </div>
    </div>
  );
}
