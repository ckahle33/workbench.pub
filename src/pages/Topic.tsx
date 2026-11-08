import { Link, useParams } from 'react-router-dom';
import type { Page, ProjectView, TopicInfo } from '../api';
import { useSession } from '../auth/SessionContext';
import { FollowButton } from '../components/FollowButton';
import { ProjectTable } from '../components/ProjectTable';
import { LoadMore, Status } from '../components/Status';
import { TopicFilter } from '../components/TopicFilter';
import { usePaged, useTitle } from '../hooks';
import { asProject, optimistic, useOptimistic } from '../optimistic';

interface TopicResponse extends Page<ProjectView> {
  topic: TopicInfo;
}

function TopicBody({ slug }: { slug: string }) {
  const list = usePaged<ProjectView, TopicResponse>(`/api/topics/${encodeURIComponent(slug)}`);
  const { session } = useSession();
  useOptimistic();
  const topic = list.first?.topic;
  useTitle(topic?.name ?? '');

  if (list.phase === 'loading') return <Status kind="loading" />;
  if (list.phase === 'notfound') {
    return (
      <Status kind="notfound" action={<Link to="/" className="btn">See the latest updates</Link>}>
        Topic not found.
      </Status>
    );
  }
  if (list.phase === 'error' || !topic) return <Status kind="error" />;

  const projects = optimistic.mergeWith(list.items, (i) => i.kind === 'project' && i.topicSlug === slug).map(asProject);
  return (
    <>
      <header className="topic-head">
        <p className="meta-line">
          <span>Topic</span>
          <span className="as-is" dir="auto">
            #{topic.slug}
          </span>
        </p>
        <h1 dir="auto">{topic.name}</h1>
        {topic.description && (
          <p className="topic-description" dir="auto">
            {topic.description}
          </p>
        )}
        <div className="topic-actions">
          <FollowButton kind="topic" subject={topic.slug} />
        </div>
      </header>
      <section aria-labelledby="topic-projects-h" className="section">
        <h2 id="topic-projects-h" className="section-title">
          Projects
        </h2>
        {projects.length === 0 ? (
          <Status
            kind="empty"
            action={
              session ? (
                <Link to="/new" className="btn btn-primary">
                  Start a project
                </Link>
              ) : undefined
            }
          >
            No projects yet.
          </Status>
        ) : (
          <ProjectTable projects={projects} label={`Projects in ${topic.name}`} />
        )}
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} failed={list.moreFailed} onClick={list.loadMore} />
      </section>
    </>
  );
}

export function Topic() {
  const { slug = '' } = useParams();
  return (
    <div className="with-filter">
      <div className="filter-col">
        <TopicFilter current={slug} />
      </div>
      <div className="main-col">
        <TopicBody slug={slug} />
      </div>
    </div>
  );
}
