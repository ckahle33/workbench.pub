import { Link } from 'react-router-dom';
import { REPO_URL } from '../pages/About';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <span className="label">workbench.pub</span>
        <nav aria-label="Footer">
          <Link to="/about">About</Link>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
