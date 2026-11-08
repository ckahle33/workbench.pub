import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Author, Page, ProjectView, UpdateView } from '../api';
import { useSession } from '../auth/SessionContext';
import { AuthorName } from '../components/AuthorName';
import { DeleteButton } from '../components/DeleteButton';
import { FollowButton } from '../components/FollowButton';
import { ReportButton } from '../components/ReportButton';
import { LoadMore, Status } from '../components/Status';
import { StatusBadge } from '../components/StatusBadge';
import { DateText, Timeline } from '../components/Timeline';
import { usePaged, useTitle } from '../hooks';
import { asProject, asUpdate, optimistic, useOptimistic } from '../optimistic';

interface ProjectResponse extends Page<UpdateView> {
  project: ProjectView;
  author: Author;
}

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
  if (!project) return <Status kind="notfound">Project not found.</Status>;

  const author: Author = list.first?.author ?? { did };
  const updates = optimistic
    .mergeWith(list.items, (i) => i.kind === 'update' && i.projectUri === project.uri)
    .map(asUpdate);

  return (
    <>
      <header className="project-head">
        <h1 dir="auto">{project.title}</h1>
        <p className="meta">
          <AuthorName author={author} /> · <Link to={`/t/${project.topicSlug}`}>#{project.topicSlug}</Link> · <StatusBadge status={project.status} /> ·{' '}
          <DateText iso={project.createdAt} />
        </p>
        <p dir="auto">{project.summary}</p>
        <div className="actions">
          {session?.did === project.did && <Link to={`/p/${did}/${rkey}/update`} className="button-link">Add update</Link>}
          <FollowButton kind="project" subject={project.uri} />
          <ReportButton uri={project.uri} />
          <DeleteButton uri={project.uri} kind="project" label="Delete project" onDeleted={() => navigate(`/profile/${did}`)} />
        </div>
      </header>
      {updates.length === 0 ? <Status kind="empty">No updates yet.</Status> : <Timeline updates={updates} />}
      <LoadMore label="Load more updates" hasMore={list.hasMore} loading={list.loadingMore} failed={list.moreFailed} onClick={list.loadMore} />
    </>
  );
}
