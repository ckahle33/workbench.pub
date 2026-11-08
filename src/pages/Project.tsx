import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { parseParts, type Author, type Page, type ProjectView, type UpdateView } from '../api';
import { useSession } from '../auth/SessionContext';
import { AuthorBlock } from '../components/AuthorBlock';
import { DeleteButton } from '../components/DeleteButton';
import { FollowButton } from '../components/FollowButton';
import { ReportButton } from '../components/ReportButton';
import { LoadMore, Status } from '../components/Status';
import { StatusBadge } from '../components/StatusBadge';
import { DateText, Timeline, type NumberedUpdate } from '../components/Timeline';
import { usePaged, useTitle } from '../hooks';
import { asProject, asUpdate, optimistic, useOptimistic } from '../optimistic';

interface ProjectResponse extends Page<UpdateView> {
  project: ProjectView;
  author: Author;
}

/**
 * Sequence numbers, oldest = 1. Server items are numbered by their position in the loaded list
 * (`total - index`), so later pages continue the count; items the user just posted (not yet in
 * the server list) take the numbers above `total`. Without a total, the loaded list is the total.
 */
export function numberUpdates(server: readonly UpdateView[], shown: readonly UpdateView[], total = server.length): NumberedUpdate[] {
  const byUri = new Map(server.map((u, i) => [u.uri, total - i]));
  const fresh = shown.filter((u) => !byUri.has(u.uri)).length;
  let k = 0;
  return shown.map((u) => ({ update: u, n: byUri.get(u.uri) ?? total + fresh - k++ }));
}

/** Titles over this many characters get the smaller display size. */
const LONG_TITLE = 40;

export function Project() {
  const { did = '', rkey = '' } = useParams();
  const list = usePaged<UpdateView, ProjectResponse>(`/api/projects/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}`);
  const mine = useOptimistic();
  const { session } = useSession();
  const uri = `at://${did}/pub.workbench.project/${rkey}`;
  const navigate = useNavigate();

  // The server has caught up with some optimistic items: forget them.
  const loaded = list.phase === 'ready' ? list.items : null;
  useEffect(() => {
    if (loaded) optimistic.prune(loaded, (r) => r.kind === 'update' && r.parentUri === uri);
  }, [loaded, mine, uri]);

  // A project the author just created may not be indexed yet.
  const pending = list.phase === 'notfound' ? mine.find((i) => i.uri === uri && i.kind === 'project') : undefined;
  const project = list.first?.project ?? (pending ? asProject(pending) : null);
  useTitle(project?.title ?? '');

  if (list.phase === 'loading') return <Status kind="loading" />;
  if (list.phase === 'error') return <Status kind="error" />;
  if (!project) {
    return (
      <Status kind="notfound" action={<Link to="/" className="btn">See the latest updates</Link>}>
        Project not found.
      </Status>
    );
  }

  const author: Author = list.first?.author ?? { did };
  const isOwner = session?.did === project.did;
  const updates = optimistic
    .mergeWith(list.items, (i) => i.kind === 'update' && i.projectUri === project.uri)
    .map(asUpdate);
  const entries = numberUpdates(list.items, updates, project.updateCount);
  // Server total, plus what the user just posted, minus what they just deleted.
  const removedHere = list.items.filter((u) => optimistic.isRemoved(u.uri)).length;
  const justPosted = updates.length - (list.items.length - removedHere);
  const total = (project.updateCount ?? list.items.length) + justPosted - removedHere;
  const newest = updates[0];
  const oldest = !list.hasMore && updates.length > 0 ? updates[updates.length - 1] : undefined;
  const parts = uniqueParts(updates);
  const addUpdate = `/p/${did}/${rkey}/update`;

  return (
    <>
      <header className="project-head">
        <div className="project-meta">
          <p className="meta-line">
            <Link to={`/t/${project.topicSlug}`}>{project.topicSlug}</Link>
            <span className="num">{`${total} ${total === 1 ? 'update' : 'updates'}`}</span>
            <span>
              Started <DateText iso={project.createdAt} />
            </span>
            <StatusBadge status={project.status} />
          </p>
          {isOwner && (
            <div className="owner-actions">
              <Link to={addUpdate} className="btn btn-small">
                Add update
              </Link>
              <DeleteButton uri={project.uri} kind="project" label="Delete project" onDeleted={() => navigate(`/profile/${did}`)} />
            </div>
          )}
        </div>
        <h1 dir="auto" className={`project-title${Array.from(project.title).length > LONG_TITLE ? ' is-long' : ''}`}>
          {project.title}
        </h1>
        <p dir="auto" className="project-summary">
          {project.summary}
        </p>
        <div className="project-byline">
          <AuthorBlock author={author} />
          <FollowButton kind="project" subject={project.uri} />
        </div>
      </header>

      <div className="with-aside project-body">
        <div className="main-col">
          {entries.length === 0 ? (
            <Status
              kind="empty"
              action={
                isOwner ? (
                  <Link to={addUpdate} className="btn btn-primary">
                    Add the first update
                  </Link>
                ) : undefined
              }
            >
              No updates yet.
            </Status>
          ) : (
            <Timeline entries={entries} />
          )}
          <LoadMore label="Load more updates" hasMore={list.hasMore} loading={list.loadingMore} failed={list.moreFailed} onClick={list.loadMore} />
        </div>

        <aside className="side-col" aria-label="About this project">
          <div className="side-block">
            <span className="label">Facts</span>
            <dl className="facts">
              <dt>Updates</dt>
              <dd className="num">{total}</dd>
              <dt>Started</dt>
              <dd>
                <DateText iso={project.createdAt} />
              </dd>
              {oldest && (
                <>
                  <dt>First update</dt>
                  <dd>
                    <DateText iso={oldest.createdAt} />
                  </dd>
                </>
              )}
              {newest && (
                <>
                  <dt>Last update</dt>
                  <dd>
                    <DateText iso={newest.createdAt} />
                  </dd>
                </>
              )}
              <dt>Status</dt>
              <dd>
                <StatusBadge status={project.status} />
              </dd>
              <dt>Topic</dt>
              <dd dir="auto">{project.topicSlug}</dd>
            </dl>
          </div>
          {parts.length > 0 && (
            <div className="side-block">
              <span className="label">Parts</span>
              <ul className="chips" aria-label="Parts used">
                {parts.map((p) => (
                  <li key={p} dir="auto">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="side-block side-report">
            <ReportButton uri={project.uri} />
          </div>
        </aside>
      </div>
    </>
  );
}

/** Part names across the loaded updates, first mention wins, case-insensitive. */
function uniqueParts(updates: UpdateView[]): string[] {
  const seen = new Map<string, string>();
  for (const u of updates) for (const p of parseParts(u.parts)) if (!seen.has(p.item.toLowerCase())) seen.set(p.item.toLowerCase(), p.item);
  return [...seen.values()];
}
