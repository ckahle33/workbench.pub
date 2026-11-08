import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSession } from '../auth/SessionContext';
import type { Author, Page, ProjectView } from '../api';
import { ProjectTable } from '../components/ProjectTable';
import { LoadMore, Status } from '../components/Status';
import { usePaged, useTitle } from '../hooks';
import { asProject, optimistic, useOptimistic } from '../optimistic';

interface ProfileResponse extends Page<ProjectView> {
  profile: Author;
}

/** Names longer than this get the smaller display size (long DIDs, long handles). */
const LONG_NAME = 22;

export function Profile() {
  const { did = '' } = useParams();
  const list = usePaged<ProjectView, ProfileResponse>(`/api/profiles/${encodeURIComponent(did)}`);
  const { session } = useSession();
  const mine = useOptimistic();
  const loaded = list.phase === 'ready' ? list.items : null;
  useEffect(() => {
    if (loaded) optimistic.prune(loaded, (r) => r.kind === 'project' && r.did === did);
  }, [loaded, mine, did]);
  // The server only knows DIDs with indexed content; your own profile still renders before that.
  const own = list.phase === 'notfound' && session?.did === did;
  const profile = own ? { did, handle: session.handle.startsWith('did:') ? undefined : session.handle } : list.first?.profile;
  const name = profile?.displayName || (profile?.handle ? `@${profile.handle}` : did);
  useTitle(profile ? name : '');

  if (list.phase === 'loading') return <Status kind="loading" />;
  if (list.phase === 'notfound' && !own) {
    return (
      <Status kind="notfound" action={<Link to="/" className="btn">See the latest updates</Link>}>
        Profile not found.
      </Status>
    );
  }
  if (list.phase === 'error' || !profile) return <Status kind="error" />;

  const projects = optimistic.mergeWith(list.items, (i) => i.kind === 'project' && i.did === did).map(asProject);
  const isMe = session?.did === did;
  // Counts only when the whole list is loaded; a partial count would be wrong.
  const counts = !list.hasMore && projects.length > 0
    ? [
        { label: 'Projects', n: projects.length },
        { label: 'In progress', n: projects.filter((p) => p.status === 'in-progress').length, accent: true },
        { label: 'Finished', n: projects.filter((p) => p.status === 'finished').length },
        { label: 'Paused', n: projects.filter((p) => p.status === 'paused').length },
      ]
    : null;

  return (
    <>
      <header className="profile-head">
        <p className="meta-line">
          <span>Profile</span>
          {counts && <span className="num">{`${counts[0].n} ${counts[0].n === 1 ? 'project' : 'projects'}`}</span>}
          {profile.handle && profile.displayName && <span className="as-is" dir="auto">@{profile.handle}</span>}
        </p>
        <h1 dir="auto" className={`profile-name${Array.from(name).length > LONG_NAME ? ' is-long' : ''}`}>
          {name}
        </h1>
      </header>

      {counts && (
        <dl className="count-strip">
          {counts.map((c) => (
            <div key={c.label}>
              <dt>{c.label}</dt>
              <dd className={c.accent && c.n > 0 ? 'is-accent' : undefined}>{c.n}</dd>
            </div>
          ))}
        </dl>
      )}

      <section aria-labelledby="profile-projects-h" className="section">
        <h2 id="profile-projects-h" className="section-title">
          Projects
        </h2>
        {projects.length === 0 ? (
          <Status
            kind="empty"
            action={
              isMe ? (
                <Link to="/new" className="btn btn-primary">
                  Start a project
                </Link>
              ) : undefined
            }
          >
            No projects yet.
          </Status>
        ) : (
          <ProjectTable projects={projects} showTopic label={`Projects by ${name}`} />
        )}
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} failed={list.moreFailed} onClick={list.loadMore} />
      </section>
    </>
  );
}
