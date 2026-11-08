import { useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { afterWrite, FieldError, POSTED_TEXT, focusFirstInvalid, SignInPrompt, TextField, TopicSelector, writeErrorMessage } from '../components/Composer';
import { Status } from '../components/Status';
import { useSession } from '../auth/SessionContext';
import { useTitle } from '../hooks';
import { optimistic } from '../optimistic';
import { createProject } from '../records/write';
import { LIMITS, type ProjectStatus } from '../../shared/lexicons';

const STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: 'in-progress', label: 'In progress' },
  { value: 'paused', label: 'Paused' },
  { value: 'finished', label: 'Finished' },
];

export function NewProject() {
  const { session, loading } = useSession();
  const navigate = useNavigate();
  useTitle('New project');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('in-progress');
  const [topic, setTopic] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ title?: string; summary?: string; topic?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [postedHref, setPostedHref] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  if (loading) return <Status kind="loading" />;
  if (!session) return <SignInPrompt what="start a project" />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!session || busy) return;
    const next = {
      title: title.trim() ? undefined : 'Give your project a title.',
      summary: summary.trim() ? undefined : 'Add a short summary.',
      topic: topic ? undefined : 'Choose a topic, or create a new one.',
    };
    setSubmitError(null);
    if (next.title || next.summary || next.topic || !topic) {
      flushSync(() => setErrors(next));
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors(next);
    setBusy(true);
    const t = title.trim();
    const s = summary.trim();
    let uri: string;
    try {
      ({ uri } = await createProject(session, { title: t, summary: s, topic, status }));
    } catch (err) {
      setSubmitError(writeErrorMessage(err, 'create your project'));
      setBusy(false);
      return;
    }
    // Saved. From here nothing may be reported as a failure, and the form stays locked (no duplicate).
    const href = `/p/${session.did}/${uri.split('/').pop()}`;
    afterWrite(() => optimistic.add({ kind: 'project', uri, did: session.did, createdAt: new Date().toISOString(), title: t, summary: s, topicSlug: topic, status }));
    afterWrite(() => setPostedHref(href));
    afterWrite(() => navigate(href));
  }

  if (postedHref) {
    return (
      <section className="form-page">
        <h1>New project</h1>
        <p role="status">{POSTED_TEXT}</p>
        <p>
          <Link to={postedHref}>View your project</Link>
        </p>
      </section>
    );
  }

  return (
    <form ref={formRef} onSubmit={(e) => void onSubmit(e)} noValidate className="composer form-page">
      <h1>New project</h1>
      <p className="form-intro">A project is the thing you are making. You add dated updates to it as the work goes on.</p>
      <TextField label="Title" value={title} onChange={setTitle} max={LIMITS.title} error={errors.title} />
      <TextField label="Summary" value={summary} onChange={setSummary} max={LIMITS.summary} multiline error={errors.summary} />
      <div className="field">
        <label htmlFor="project-status">Status</label>
        <select id="project-status" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <TopicSelector value={topic} onChange={setTopic} error={errors.topic} />
      <div className="form-submit">
        <FieldError id="submit-error">{submitError}</FieldError>
        <button type="submit" aria-disabled={busy || undefined}>
          {busy ? 'Creating…' : 'Create project'}
        </button>
      </div>
    </form>
  );
}
