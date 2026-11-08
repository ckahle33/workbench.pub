import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Author, FeedItem, Page, ReplyView } from '../api';
import { AuthorName } from '../components/AuthorName';
import { DeleteButton } from '../components/DeleteButton';
import { ReplyBox } from '../components/ReplyBox';
import { ReportButton } from '../components/ReportButton';
import { Replies } from '../components/Replies';
import { LoadMore, Status } from '../components/Status';
import { TimelineEntry } from '../components/Timeline';
import { usePaged, useTitle } from '../hooks';
import { asReply, optimistic, useOptimistic } from '../optimistic';

interface UpdateResponse extends Page<ReplyView> {
  update: FeedItem;
  author: Author;
}

export function Update() {
  const { did = '', rkey = '' } = useParams();
  const list = usePaged<ReplyView, UpdateResponse>(`/api/updates/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}`);
  const mine = useOptimistic();
  const navigate = useNavigate();
  const loaded = list.phase === 'ready' ? list.items : null;
  const rootUri = list.first?.update.uri;
  useEffect(() => {
    if (!loaded) return;
    const thread = new Set([rootUri, ...loaded.map((r) => r.uri)]);
    optimistic.prune(loaded, (r) => r.kind === 'reply' && thread.has(r.parentUri));
  }, [loaded, mine, rootUri]);
  useTitle(list.first?.update.heading ?? '');

  if (list.phase === 'loading') return <Status kind="loading" />;
  if (list.phase === 'error' || (list.phase === 'ready' && !list.first)) return <Status kind="error" />;
  if (list.phase === 'notfound' || !list.first) return <Status kind="notfound">Update not found.</Status>;

  const { update, author } = list.first;
  // Replies anywhere beneath this update belong in the thread.
  const thread = new Set([update.uri, ...list.items.map((r) => r.uri)]);
  const replies = optimistic.mergeWith(list.items, (i) => i.kind === 'reply' && thread.has(i.subjectUri ?? '')).map(asReply);

  return (
    <>
      <p className="meta">
        In <Link to={`/p/${update.project.did}/${update.project.rkey}`} dir="auto">{update.project.title}</Link> by <AuthorName author={author} />
      </p>
      <TimelineEntry update={update} headingLevel={1} />
      <div className="actions">
        <ReportButton uri={update.uri} />
        <DeleteButton
          uri={update.uri}
          kind="update"
          parentUri={update.projectUri}
          label="Delete update"
          onDeleted={() => navigate(`/p/${update.project.did}/${update.project.rkey}`)}
        />
      </div>
      <section aria-labelledby="replies-h">
        <h2 id="replies-h">Replies</h2>
        <Replies replies={replies} rootUri={update.uri} />
        <ReplyBox subjectUri={update.uri} />
        <LoadMore label="Load more replies" hasMore={list.hasMore} loading={list.loadingMore} failed={list.moreFailed} onClick={list.loadMore} />
      </section>
    </>
  );
}
