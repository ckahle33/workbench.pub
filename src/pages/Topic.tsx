import { useParams } from 'react-router-dom';
import type { Page, ProjectView, TopicInfo } from '../api';
import { ProjectList } from '../components/ProjectList';
import { LoadMore, Status } from '../components/Status';
import { usePaged, useTitle } from '../hooks';
import { asProject, optimistic, useOptimistic } from '../optimistic';

interface TopicResponse extends Page<ProjectView> {
  topic: TopicInfo;
}

export function Topic() {
  const { slug = '' } = useParams();
  const list = usePaged<ProjectView, TopicResponse>(`/api/topics/${encodeURIComponent(slug)}`);
  useOptimistic();
  const topic = list.first?.topic;
  useTitle(topic?.name ?? '');

  if (list.phase === 'loading') return <Status kind="loading" />;
  if (list.phase === 'notfound') return <Status kind="notfound">Topic not found.</Status>;
  if (list.phase === 'error' || !topic) return <Status kind="error" />;

  const projects = optimistic.mergeWith(list.items, (i) => i.kind === 'project' && i.topicSlug === slug).map(asProject);
  return (
    <>
      <h1 dir="auto">{topic.name}</h1>
      <p dir="auto">{topic.description}</p>
      {projects.length === 0 ? <Status kind="empty">No projects yet.</Status> : <ProjectList projects={projects} />}
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} failed={list.moreFailed} onClick={list.loadMore} />
    </>
  );
}
