import { Link } from 'react-router-dom';
import type { ProjectView } from '../api';
import { StatusBadge } from './StatusBadge';

export function ProjectList({ projects }: { projects: ProjectView[] }) {
  return (
    <ul className="cards">
      {projects.map((p) => (
        <li key={p.uri}>
          <h2 dir="auto">
            <Link to={`/p/${p.did}/${p.rkey}`}>{p.title}</Link>
          </h2>
          <p className="meta">
            <StatusBadge status={p.status} />
          </p>
          <p dir="auto">{p.summary}</p>
        </li>
      ))}
    </ul>
  );
}
