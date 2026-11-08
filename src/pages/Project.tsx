import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Author, Page, ProjectView, UpdateView } from '../api';
import { AuthorName } from '../components/AuthorName';
import { Status } from '../components/Status';
import { StatusBadge } from '../components/StatusBadge';
import { DateText, Timeline } from '../components/Timeline';
import { useApi, useTitle } from '../hooks';
import { asProject, asUpdate, optimistic, useOptimistic } from '../optimistic';

interface ProjectResponse extends Page<UpdateView> {
  project: ProjectView;
  author: Author;
}

export function Project() {
  const { did = '', rkey = '' } = useParams();
  const res = useApi<ProjectResponse>(`/api/projects/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}`);
  const mine = useOptimistic();
  const uri = `at://${did}/pub.workbench.project/${rkey}`;

  // The server has caught up with some optimistic items: forget them.
  const serverItems = res.state === 'ready' ? res.data.items : null;
  useEffect(() => {
    if (serverItems) optimistic.prune(serverItems);
  }, [serverItems, mine]);

  // A project the author just created may not be indexed yet.
  const pending = res.state === 'notfound' ? mine.find((i) => i.uri === uri && i.kind === 'project') : undefined;
  const project = res.state === 'ready' ? res.data.project : pending ? asProject(pending) : null;
  useTitle(project?.title ?? '');

  if (res.state === 'loading') return <Status kind="loading" />;
  if (res.state === 'error') return <Status kind="error" />;
  if (!project) return <Status kind="notfound">Project not found.</Status>;

  const author: Author = res.state === 'ready' ? res.data.author : { did };
  const updates = optimistic
    .mergeWith(serverItems ?? [], (i) => i.kind === 'update' && i.projectUri === project.uri)
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
      </header>
      {updates.length === 0 ? <Status kind="empty">No updates yet.</Status> : <Timeline updates={updates} />}
    </>
  );
}
