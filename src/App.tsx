import { Link, Route, Routes } from 'react-router-dom';
import { useSession } from './auth/SessionContext';
import { NewProject } from './pages/NewProject';
import { NewUpdate } from './pages/NewUpdate';
import { Home } from './pages/Home';
import { Profile } from './pages/Profile';
import { Project } from './pages/Project';
import { SignIn } from './pages/SignIn';
import { Topic } from './pages/Topic';
import { Update } from './pages/Update';
import { useTitle } from './hooks';

function NotFound() {
  useTitle('Page not found');
  return <p className="status">Page not found.</p>;
}

function SiteHeader() {
  const { session, loading, signOut } = useSession();
  return (
    <header className="site-header">
      <Link to="/" className="site-name">
        workbench.pub
      </Link>
      <nav aria-label="Main">
        {loading ? null : session ? (
          <>
            <Link to="/new">New project</Link>
            <Link to={`/profile/${session.did}`}>@{session.handle}</Link>
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </>
        ) : (
          <Link to="/signin">Sign in</Link>
        )}
      </nav>
    </header>
  );
}

export function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/t/:slug" element={<Topic />} />
          <Route path="/p/:did/:rkey" element={<Project />} />
          <Route path="/p/:did/:rkey/update" element={<NewUpdate />} />
          <Route path="/new" element={<NewProject />} />
          <Route path="/u/:did/:rkey" element={<Update />} />
          <Route path="/profile/:did" element={<Profile />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  );
}
