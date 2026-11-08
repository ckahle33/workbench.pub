import { Link } from 'react-router-dom';
import { useTitle } from '../hooks';

export const REPO_URL = 'https://github.com/ckahle33/workbench.pub';

/** Public explainer. Plain text only; voice rules are in PRODUCT.md. */
export function About() {
  useTitle('About');
  return (
    <div className="about">
      <h1>About</h1>
      <p className="about-lede">A place for makers to show a project as it gets made.</p>

      <section aria-labelledby="about-what">
        <h2 id="about-what">What it is</h2>
        <p>
          A project has a title and a timeline of dated updates: photos, notes, links and parts lists. Anyone can start a topic, such as electronics, ceramics or
          woodworking. People can follow projects and topics, and reply to individual updates.
        </p>
      </section>

      <section aria-labelledby="about-how">
        <h2 id="about-how">How it works</h2>
        <ol className="about-steps" aria-label="Steps">
          <li>
            <h3>Sign in</h3>
            <p>Use an existing Bluesky account. There is no separate password.</p>
          </li>
          <li>
            <h3>Start a project</h3>
            <p>Give it a title, a short summary and a topic.</p>
          </li>
          <li>
            <h3>Add updates as you go</h3>
            <p>A photo and one line is enough. When you add an update you can choose to post it to Bluesky as well.</p>
          </li>
          <li>
            <h3>Others follow and reply</h3>
            <p>People can follow the project or its topic and reply to each update.</p>
          </li>
        </ol>
      </section>

      <section aria-labelledby="about-atproto">
        <h2 id="about-atproto">Why AT Protocol: your own account</h2>
        <p>
          Your projects, updates and replies are saved as records in your own AT Protocol account, not in a database that belongs to this site. workbench.pub keeps
          an index of public records so it can show them. Because the data lives in your account, you can leave, or use other apps that read the same records.
        </p>
        <p>What that means in practice:</p>
        <ul className="about-list">
          <li>Everything you post is public.</li>
          <li>Deleting a post here deletes the record from your account.</li>
          <li>We can hide something from this site, but we cannot remove it from your account.</li>
        </ul>
      </section>

      <section aria-labelledby="about-cost">
        <h2 id="about-cost">What it costs and who runs it</h2>
        <p>
          It is free. It is run by its maker, one person, and it is at an early stage, so expect rough edges. The code is on{' '}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          .
        </p>
      </section>

      <section aria-labelledby="about-faq">
        <h2 id="about-faq">Questions</h2>
        <h3>Do I need a new account?</h3>
        <p>
          No. You need a Bluesky account, which is free to create at{' '}
          <a href="https://bsky.app" target="_blank" rel="noopener noreferrer">
            bsky.app
          </a>
          . You sign in with that account.
        </p>
        <h3>What can I post?</h3>
        <p>Projects, and updates to them with notes, up to 6 photos, up to 8 links and a parts list. You can also reply to updates and start topics.</p>
        <h3>Can others edit my projects?</h3>
        <p>No. Only you can change what is in your account. Other people can follow and reply.</p>
        <h3>How do I report something?</h3>
        <p>Use the Report button on a project or an update. Reports are reviewed by hand.</p>
        <h3>How do I delete something?</h3>
        <p>Use the delete control on your own posts.</p>
        <h3>What are topics?</h3>
        <p>
          A topic is a subject area, such as electronics or ceramics. Each project belongs to one topic, and you can follow a topic to see new projects in it.
        </p>
      </section>

      <p className="about-actions">
        <Link to="/" className="btn btn-primary">
          See the latest updates
        </Link>
      </p>
    </div>
  );
}
