import { useParams } from 'react-router-dom';
import type { Author, Page, ProjectView } from '../api';
import { ProjectList } from '../components/ProjectList';
import { LoadMore, Status } from '../components/Status';
import { usePaged, useTitle } from '../hooks';
import { asProject, optimistic, useOptimistic } from '../optimistic';

interface ProfileResponse extends Page<ProjectView> {
  profile: Author;
}

export function Profile() {
  const { did = '' } = useParams();
  const list = usePaged<ProjectView, ProfileResponse>(`/api/profiles/${encodeURIComponent(did)}`);
  useOptimistic();
  const profile = list.first?.profile;
  const name = profile?.displayName || (profile?.handle ? `@${profile.handle}` : did);
  useTitle(profile ? name : '');

  if (list.phase === 'loading') return <Status kind="loading" />;
  if (list.phase === 'notfound') return <Status kind="notfound">Profile not found.</Status>;
  if (list.phase === 'error' || !profile) return <Status kind="error" />;

  const projects = optimistic.mergeWith(list.items, (i) => i.kind === 'project' && i.did === did).map(asProject);
  return (
    <>
      <h1 dir="auto">{name}</h1>
      {profile.handle && profile.displayName && <p className="meta">@{profile.handle}</p>}
      <h2 className="visually-hidden">Projects</h2>
      {projects.length === 0 ? <Status kind="empty">No projects yet.</Status> : <ProjectList projects={projects} />}
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} failed={list.moreFailed} onClick={list.loadMore} />
    </>
  );
}
