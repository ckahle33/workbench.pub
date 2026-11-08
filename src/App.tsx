import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { useSession } from './auth/SessionContext';
import { SiteFooter } from './components/SiteFooter';
import { About } from './pages/About';
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
  return (
    <section className="not-found" aria-labelledby="nf-h">
      <h1 id="nf-h">404</h1>
      <p>Page not found. The address may be wrong, or the page was removed.</p>
      <div className="actions">
        <Link to="/" className="btn btn-primary">
          Go to the latest updates
        </Link>
      </div>
    </section>
  );
}

function SiteHeader() {
  const { session, loading, signOut } = useSession();
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link to="/" className="wordmark">
          workbench<span className="dot">.</span>pub
        </Link>
        <nav aria-label="Main" className="site-nav">
          <NavLink to="/" end>
            Latest
          </NavLink>
          <NavLink to="/about">About</NavLink>
          {!loading && session && (
            <NavLink to="/new" className="btn btn-primary">
              New project
            </NavLink>
          )}
        </nav>
        <div className="header-actions">
          {loading ? null : session ? (
            <>
              <NavLink to={`/profile/${session.did}`} className="header-user" dir="auto">
                @{session.handle}
              </NavLink>
              <button type="button" className="btn-text" onClick={() => void signOut()}>
                Sign out
              </button>
            </>
          ) : (
            <NavLink to="/signin">Sign in</NavLink>
          )}
        </div>
      </div>
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
      <main id="main" className="page">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/t/:slug" element={<Topic />} />
          <Route path="/p/:did/:rkey" element={<Project />} />
          <Route path="/p/:did/:rkey/update" element={<NewUpdate />} />
          <Route path="/new" element={<NewProject />} />
          <Route path="/u/:did/:rkey" element={<Update />} />
          <Route path="/profile/:did" element={<Profile />} />
          <Route path="/about" element={<About />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <SiteFooter />
    </>
  );
}
