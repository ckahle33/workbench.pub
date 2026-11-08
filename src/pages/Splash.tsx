import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, type FeedItem, type Page } from '../api';
import { useSession } from '../auth/SessionContext';
import { FeedCard } from '../components/FeedCard';
import { DateText } from '../components/Timeline';

export const SPLASH_TITLE = 'workbench.pub: show how it’s made';

/**
 * `/`: the splash for signed-out visitors, the feed for everyone signed in. While the session is
 * still being restored nothing is shown (same height as the page), so a signed-in visitor never
 * sees the splash flash before the redirect.
 */
export function Landing() {
  const { session, loading } = useSession();
  if (loading) return <div className="splash-pending" aria-busy="true" />;
  if (session) return <Navigate to="/feed" replace />;
  return <Splash />;
}

/** A sample project. Static and labelled as an example; nothing here is a real person's work. */
const EXAMPLE = {
  topic: 'electronics',
  title: 'Two-knob fuzz pedal',
  summary: 'A fuzz from an old two-transistor schematic, built on a breadboard first and then boxed.',
  updates: [
    {
      n: 4,
      date: '2026-04-19T19:30:00.000Z',
      heading: 'First sound through an amp',
      notes: 'It works. Too much bass at full gain, so the input capacitor gets smaller next.',
      tile: { tone: 'dark', big: 'FIRST SOUND', small: 'GAIN 10 · VOLUME 4' },
    },
    {
      n: 3,
      date: '2026-04-06T17:10:00.000Z',
      heading: 'Enclosure drilled',
      notes: 'Printed a template and drilled small first. The footswitch hole is 1 mm off, and you can see it.',
      tile: { tone: 'light', big: '5 HOLES', small: '1590B ENCLOSURE' },
    },
    {
      n: 2,
      date: '2026-03-22T20:40:00.000Z',
      heading: 'Breadboard, and a hum',
      notes: 'It fuzzes. It also hums. Touching the ground rail stops it, so the ground is the first suspect.',
      tile: { tone: 'panel', big: 'HUM', small: 'BREADBOARD' },
    },
    {
      n: 1,
      date: '2026-03-03T18:00:00.000Z',
      heading: 'Parts on the bench',
      notes: 'Two transistors, two pots, a handful of resistors and a box. Ordered spares in case I burn one.',
      tile: { tone: 'dark', big: '2N3904 ×2', small: 'PARTS LIST' },
    },
  ],
} as const;

function ExampleTimeline() {
  return (
    <figure className="example" aria-labelledby="example-caption">
      <figcaption id="example-caption" className="example-head">
        <span className="meta-line">
          <span className="example-flag">Example</span>
          <span>{EXAMPLE.topic}</span>
          <span>{EXAMPLE.updates.length} updates</span>
        </span>
        <span className="example-title">{EXAMPLE.title}</span>
        <span className="visually-hidden">: a sample project to show the format, not a real post.</span>
        <span className="example-summary">{EXAMPLE.summary}</span>
      </figcaption>
      <ol className="timeline example-timeline">
        {EXAMPLE.updates.map((u, i) => (
          <li key={u.n}>
            <article className="entry" aria-labelledby={`example-u${u.n}`}>
              <p className={`entry-num${i === 0 ? ' is-newest' : ''}`}>
                <span className="visually-hidden">Update </span>
                {String(u.n).padStart(2, '0')}
              </p>
              <div className="entry-body">
                <div className="entry-head">
                  <h3 id={`example-u${u.n}`}>{u.heading}</h3>
                  <span className="entry-date">
                    <DateText iso={u.date} />
                  </span>
                </div>
                <p className="notes">{u.notes}</p>
                <div className={`example-tile tone-${u.tile.tone}`} aria-hidden="true">
                  <span className="example-tile-big">{u.tile.big}</span>
                  <span className="example-tile-small">{u.tile.small}</span>
                </div>
              </div>
            </article>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** Up to three real, recent updates. Renders nothing while loading, on failure, or when empty. */
function LatestFromSite() {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<Page<FeedItem>>('/api/feed?limit=3')
      .then((p) => !cancelled && setItems(Array.isArray(p.items) ? p.items.slice(0, 3) : []))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, []);
  if (!items || items.length === 0) return null;
  return (
    <section className="splash-section splash-latest" aria-labelledby="splash-latest-h">
      <div className="splash-section-head">
        <h2 id="splash-latest-h">Latest from the site</h2>
        <Link to="/feed" className="splash-more">
          See the feed
        </Link>
      </div>
      <ul className="cards">
        {items.map((u) => (
          <FeedCard key={u.uri} item={u} />
        ))}
      </ul>
    </section>
  );
}

const STEPS = [
  { title: 'Sign in', text: 'Use the Bluesky account you already have. There is no new password.' },
  { title: 'Start a project', text: 'Give it a title, a one-line summary and a topic, such as electronics or ceramics.' },
  { title: 'Add updates as you go', text: 'A photo and one line is enough. Each update gets a date and a number in the timeline.' },
];

export function Splash() {
  useEffect(() => {
    document.title = SPLASH_TITLE;
  }, []);
  return (
    <div className="splash">
      <section className="splash-hero" aria-labelledby="splash-h">
        <h1 id="splash-h">
          Show how it’s made<span className="dot">.</span>
        </h1>
        <div className="splash-hero-row">
          <p className="splash-lede">
            Post a project as a dated timeline of photos and notes, from the first parts on the bench to the finished thing. Other people can follow along and reply.
          </p>
          <div className="splash-cta">
            <div className="splash-buttons">
              <Link to="/signin" className="btn btn-primary btn-large">
                Sign in with Bluesky
              </Link>
              <a href="#how" className="splash-link">
                How it works
              </a>
            </div>
            <p className="label">Free. Uses your existing Bluesky account.</p>
          </div>
        </div>
      </section>

      <section className="splash-section splash-example-section" aria-labelledby="splash-example-h">
        <div className="splash-split">
          <div className="splash-section-head splash-aside-head">
            <h2 id="splash-example-h">One project, one timeline.</h2>
            <p>
              Every update is dated and numbered, newest on top, so the process is the main thing on the page, not only the result. This one is an example.
            </p>
          </div>
          <ExampleTimeline />
        </div>
      </section>

      <section id="how" className="splash-section" aria-labelledby="splash-how-h">
        <div className="splash-section-head">
          <h2 id="splash-how-h">How it works</h2>
        </div>
        <ol className="splash-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="splash-step-num" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
        <p className="splash-note">Posting an update to Bluesky as well is optional. You choose each time.</p>
      </section>

      <section className="splash-section splash-own" aria-labelledby="splash-own-h">
        <h2 id="splash-own-h">Yours to keep.</h2>
        <div className="splash-own-body">
          <p>
            Your projects, updates and replies are saved in your own Bluesky account, not in this site’s database. workbench.pub indexes them and shows them. Everything
            you post is public.
          </p>
          <Link to="/about">How your data is stored, and what that means</Link>
        </div>
      </section>

      <LatestFromSite />

      <section className="splash-close" aria-labelledby="splash-close-h">
        <h2 id="splash-close-h">Start with what is on your bench.</h2>
        <div className="splash-buttons">
          <Link to="/signin" className="btn btn-large btn-inverse">
            Sign in with Bluesky
          </Link>
          <Link to="/feed" className="splash-link">
            Look around first
          </Link>
        </div>
      </section>
    </div>
  );
}
