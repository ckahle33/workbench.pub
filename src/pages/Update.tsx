import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Author, FeedItem, Page, ReplyView } from '../api';
import { AuthorName } from '../components/AuthorName';
import { Replies } from '../components/Replies';
import { Status } from '../components/Status';
import { TimelineEntry } from '../components/Timeline';
import { useApi, useTitle } from '../hooks';
import { asReply, optimistic, useOptimistic } from '../optimistic';

interface UpdateResponse extends Page<ReplyView> {
  update: FeedItem;
  author: Author;
}

export function Update() {
  const { did = '', rkey = '' } = useParams();
  const res = useApi<UpdateResponse>(`/api/updates/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}`);
  const mine = useOptimistic();
  const serverItems = res.state === 'ready' ? res.data.items : null;
  useEffect(() => {
    if (serverItems) optimistic.prune(serverItems);
  }, [serverItems, mine]);
  useTitle(res.state === 'ready' ? res.data.update.heading : '');

  if (res.state === 'loading') return <Status kind="loading" />;
  if (res.state === 'error') return <Status kind="error" />;
  if (res.state === 'notfound') return <Status kind="notfound">Update not found.</Status>;

  const { update, author } = res.data;
  // Replies anywhere beneath this update belong in the thread.
  const thread = new Set([update.uri, ...res.data.items.map((r) => r.uri)]);
  const replies = optimistic.mergeWith(res.data.items, (i) => i.kind === 'reply' && thread.has(i.subjectUri ?? '')).map(asReply);

  return (
    <>
      <p className="meta">
        In <Link to={`/p/${update.project.did}/${update.project.rkey}`} dir="auto">{update.project.title}</Link> by <AuthorName author={author} />
      </p>
      <TimelineEntry update={update} headingLevel={1} />
      <section aria-labelledby="replies-h">
        <h2 id="replies-h">Replies</h2>
        <Replies replies={replies} rootUri={update.uri} />
      </section>
    </>
  );
}
