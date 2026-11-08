import { Link } from 'react-router-dom';
import type { ProjectView } from '../api';
import { StatusBadge } from './StatusBadge';
import { DateText } from './Timeline';

/** Projects as a ruled table; scrolls inside its own box on narrow screens. */
export function ProjectTable({ projects, showTopic = false, label }: { projects: ProjectView[]; showTopic?: boolean; label: string }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="project-table">
        <thead>
          <tr>
            <th scope="col">Project</th>
            {showTopic && <th scope="col">Topic</th>}
            <th scope="col">Status</th>
            <th scope="col" className="col-date">
              Started
            </th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.uri} className={p.status === 'paused' ? 'is-paused' : undefined}>
              <td className="col-project">
                <Link to={`/p/${p.did}/${p.rkey}`} className="pt-title" dir="auto">
                  {p.title}
                </Link>
                {p.summary && (
                  <p className="pt-summary" dir="auto">
                    {p.summary}
                  </p>
                )}
              </td>
              {showTopic && (
                <td className="col-topic">
                  <Link to={`/t/${p.topicSlug}`} dir="auto">
                    {p.topicSlug}
                  </Link>
                </td>
              )}
              <td>
                <StatusBadge status={p.status} />
              </td>
              <td className="col-date">
                <DateText iso={p.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
