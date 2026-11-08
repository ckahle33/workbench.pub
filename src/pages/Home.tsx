import { Link } from 'react-router-dom';
import type { FeedItem } from '../api';
import { useSession } from '../auth/SessionContext';
import { DateText } from '../components/Timeline';
import { LoadMore, Status } from '../components/Status';
import { usePaged, useTitle } from '../hooks';
import { optimistic, useOptimistic } from '../optimistic';

function Feed({ path, empty }: { path: string; empty: string }) {
  const feed = usePaged<FeedItem>(path);
  useOptimistic();
  if (feed.phase === 'loading') return <Status kind="loading" />;
  if (feed.phase !== 'ready') return <Status kind="error" />;
  // Items the signed-in user just deleted stay hidden until the server drops them.
  const items = feed.items.filter((u) => !optimistic.isRemoved(u.uri) && !optimistic.isRemoved(u.project.uri));
  return (
    <>
      {items.length === 0 ? (
        <Status kind="empty">{empty}</Status>
      ) : (
        <ul className="cards">
          {items.map((u) => (
            <li key={u.uri}>
              <p className="meta">
                <Link to={`/p/${u.project.did}/${u.project.rkey}`} dir="auto">{u.project.title}</Link> · <DateText iso={u.createdAt} />
              </p>
              <h3 dir="auto">
                <Link to={`/u/${u.did}/${u.rkey}`}>{u.heading}</Link>
              </h3>
              <p className="excerpt" dir="auto">{u.body}</p>
            </li>
          ))}
        </ul>
      )}
      <LoadMore hasMore={feed.hasMore} loading={feed.loadingMore} failed={feed.moreFailed} onClick={feed.loadMore} />
    </>
  );
}

export function Home() {
  useTitle('');
  const { session, loading } = useSession();
  return (
    <>
      <h1>Recent from the workbench</h1>
      {!loading && session && (
        <section aria-labelledby="following-h">
          <h2 id="following-h">Following</h2>
          <Feed path={`/api/feed?following=${encodeURIComponent(session.did)}`} empty="Nothing from what you follow yet. Follow a project or topic to see it here." />
        </section>
      )}
      <section aria-labelledby="latest-h">
        <h2 id="latest-h">Latest updates</h2>
        <Feed path="/api/feed" empty="Nothing here yet." />
      </section>
    </>
  );
}
