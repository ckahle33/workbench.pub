import { useEffect, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  cleanLinks,
  cleanParts,
  afterWrite,
  FieldError,
  POSTED_TEXT,
  focusFirstInvalid,
  ImagePicker,
  LinkList,
  PartsList,
  SignInPrompt,
  TextField,
  writeErrorMessage,
  type LinkRow,
  type PartRow,
  type PickedImage,
} from '../components/Composer';
import { CrosspostBox } from '../components/CrosspostBox';
import { Status } from '../components/Status';
import { api } from '../api';
import { useSession } from '../auth/SessionContext';
import { useTitle } from '../hooks';
import { optimistic } from '../optimistic';
import { ImageTooLargeError, resizeImage } from '../records/image';
import { plainImages } from '../records/blobs';
import { buildCaption, captionBudget, createCrosspost, permalink } from '../records/crosspost';
import { crosspostFailureNotice } from '../records/errors';
import { createUpdate } from '../records/write';
import { LIMITS } from '../../shared/lexicons';

const CONFIRM_MS = 1500;

function readFlag(key: string): boolean {
  try {
    return !!key && window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** A photo could not be prepared; its message is ours and safe to show. */
class PhotoError extends Error {}

export function NewUpdate() {
  const { did = '', rkey = '' } = useParams();
  const { session, loading } = useSession();
  const navigate = useNavigate();
  useTitle('Add update');
  const [heading, setHeading] = useState('');
  const [body, setBody] = useState('');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [parts, setParts] = useState<PartRow[]>([]);
  const [errors, setErrors] = useState<{ heading?: string; body?: string }>({});
  const [linkErrors, setLinkErrors] = useState<Record<number, string>>({});
  const [partErrors, setPartErrors] = useState<Record<number, string>>({});
  const [showAltErrors, setShowAltErrors] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [postedHref, setPostedHref] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Set once the person has left this page (unmount or a click on a link), so late results never navigate or set state.
  const leftRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    leftRef.current = false;
    return () => {
      leftRef.current = true;
      clearTimeout(timerRef.current);
    };
  }, []);
  // Cross-post: opt-in, remembered per account; null means "not chosen on this page yet".
  const [crosspostChoice, setCrosspostChoice] = useState<boolean | null>(null);
  const [captionEdit, setCaptionEdit] = useState<string | null>(null);
  const [captionError, setCaptionError] = useState<string | undefined>();
  const [projectTitle, setProjectTitle] = useState('');
  const [crosspostState, setCrosspostState] = useState<'idle' | 'posting' | 'done'>('idle');
  const [crosspostNotice, setCrosspostNotice] = useState<string | null>(null);
  const storageKey = session ? `wb.crosspost:${session.did}` : '';
  const crosspost = crosspostChoice ?? readFlag(storageKey);
  const budget = captionBudget(did);
  const caption = captionEdit ?? buildCaption({ heading, body, projectTitle }, budget);

  function chooseCrosspost(v: boolean) {
    setCrosspostChoice(v);
    try {
      window.localStorage.setItem(storageKey, v ? '1' : '0');
    } catch {
      /* the choice just is not remembered */
    }
  }

  useEffect(() => {
    if (!crosspost || projectTitle || !did) return;
    const projectUri = `at://${did}/pub.workbench.project/${rkey}`;
    const known = optimistic.find(projectUri)?.title;
    if (known) {
      setProjectTitle(known);
      return;
    }
    let cancelled = false;
    api
      .get<{ project?: { title?: string } }>(`/api/projects/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}?limit=1`)
      .then((r) => !cancelled && typeof r.project?.title === 'string' && setProjectTitle(r.project.title))
      .catch(() => {}); // the caption simply has no project title
    return () => {
      cancelled = true;
    };
  }, [crosspost, projectTitle, did, rkey]);

  if (loading) return <Status kind="loading" />;
  if (!session) return <SignInPrompt what="add an update" />;
  if (session.did !== did) {
    return (
      <section className="form-page">
        <h1>Add update</h1>
        <p role="alert" className="state-error">You can only add updates to your own projects.</p>
        <p className="form-intro">
          <Link to={`/p/${did}/${rkey}`}>Back to the project</Link>
        </p>
      </section>
    );
  }

  const projectUri = `at://${did}/pub.workbench.project/${rkey}`;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!session || busy) return;
    const l = cleanLinks(links);
    const p = cleanParts(parts);
    const next = {
      heading: heading.trim() ? undefined : 'Give this update a heading.',
      body: body.trim() ? undefined : 'Write a few notes.',
    };
    const altMissing = images.some((i) => i.alt.trim() === '');
    const captionProblem = crosspost && !caption.trim() ? 'Add a caption for the Bluesky post, or untick it.' : undefined;
    setCaptionError(captionProblem);
    const invalid = !!(next.heading || next.body || altMissing || captionProblem || Object.keys(l.errors).length || Object.keys(p.errors).length);
    setSubmitError(null);
    flushSync(() => {
      setErrors(next);
      setLinkErrors(l.errors);
      setPartErrors(p.errors);
      setShowAltErrors(true);
    });
    if (invalid) {
      focusFirstInvalid(formRef.current);
      return;
    }

    setBusy(true);
    try {
      // One photo at a time: decoding several full-resolution phone photos at once can crash the tab.
      const files: { file: File; alt: string }[] = [];
      for (const [n, img] of images.entries()) {
        let blob: Blob;
        try {
          blob = await resizeImage(img.file);
        } catch (err) {
          throw new PhotoError(
            err instanceof ImageTooLargeError
              ? `Photo ${n + 1} is too large (over 25 MB). Choose a smaller one.`
              : `Could not process photo ${n + 1}. Try a different photo.`,
          );
        }
        files.push({ file: new File([blob], `photo-${n + 1}.jpg`, { type: blob.type || 'image/jpeg' }), alt: img.alt.trim() });
      }
      let result: Awaited<ReturnType<typeof createUpdate>>;
      try {
        result = await createUpdate(session, {
          project: projectUri,
          heading: heading.trim(),
          body: body.trim(),
          images: files,
          links: l.value,
          parts: p.value,
        });
      } catch (err) {
        setSubmitError(writeErrorMessage(err, 'post your update'));
        setBusy(false);
        return;
      }
      // Saved. From here nothing may be reported as a failure, and the form stays locked (no duplicate).
      const href = `/p/${did}/${rkey}`;
      afterWrite(() =>
        optimistic.add({
          kind: 'update',
          uri: result.uri,
          did: session.did,
          createdAt: new Date().toISOString(),
          projectUri,
          heading: heading.trim(),
          body: body.trim(),
          images: plainImages(result.images),
          links: l.value,
          parts: p.value,
        }),
      );
      afterWrite(() => setPostedHref(href));
      if (crosspost) {
        // A separate step after the update is saved. A failure never undoes the update and is never retried.
        afterWrite(() => setCrosspostState('posting'));
        try {
          const first = plainImages(result.images)[0];
          await createCrosspost(session, {
            caption,
            url: permalink(session.did, result.uri.split('/').pop() ?? ''),
            title: projectTitle ? `${projectTitle}: ${heading.trim()}` : heading.trim(),
            description: body.trim(),
            thumb: first && images[0] ? { ref: first.image, original: images[0].file } : undefined,
          });
        } catch (err) {
          // If they already left, createCrosspost has logged it; there is nowhere to show it.
          if (!leftRef.current) {
            afterWrite(() => setCrosspostNotice(crosspostFailureNotice(err)));
            afterWrite(() => setCrosspostState('idle'));
          }
          return; // stay on this page so the notice can be read
        }
        if (leftRef.current) return;
        // Show the confirmation for a moment, then go to the project unless they have left.
        afterWrite(() => setCrosspostState('done'));
        timerRef.current = setTimeout(() => {
          if (!leftRef.current) navigate(href);
        }, CONFIRM_MS);
        return;
      }
      if (!leftRef.current) afterWrite(() => navigate(href));
    } catch (err) {
      setSubmitError(err instanceof PhotoError ? err.message : writeErrorMessage(err, 'post your update'));
      setBusy(false);
    }
  }

  if (postedHref) {
    return (
      <section className="form-page">
        <h1>Add update</h1>
        <p role="status">{POSTED_TEXT}</p>
        {crosspostState === 'posting' && <p role="status">Posting to Bluesky…</p>}
        {crosspostState === 'done' && <p role="status">Posted to Bluesky.</p>}
        {crosspostNotice && <p role="status">{crosspostNotice}</p>}
        <p>
          <Link to={postedHref} onClick={() => (leftRef.current = true)}>
            Back to the project
          </Link>
        </p>
      </section>
    );
  }

  return (
    <form ref={formRef} onSubmit={(e) => void onSubmit(e)} noValidate className="composer form-page">
      <h1>Add update</h1>
      <p className="form-intro">
        A dated step in the timeline: what you did, what changed, what went wrong. <Link to={`/p/${did}/${rkey}`}>Back to the project</Link>
      </p>
      <TextField label="Heading" value={heading} onChange={setHeading} max={LIMITS.heading} error={errors.heading} />
      <TextField label="Notes" value={body} onChange={setBody} max={LIMITS.body} multiline error={errors.body} />
      <ImagePicker images={images} onChange={setImages} showErrors={showAltErrors} />
      <LinkList rows={links} onChange={setLinks} errors={linkErrors} />
      <PartsList rows={parts} onChange={setParts} errors={partErrors} />
      <CrosspostBox did={did} checked={crosspost} onChecked={chooseCrosspost} caption={caption} onCaption={setCaptionEdit} budget={budget} error={captionError} />
      <div className="form-submit">
        <FieldError id="submit-error">{submitError}</FieldError>
        <button type="submit" aria-disabled={busy || undefined}>
          {busy ? 'Posting…' : 'Post update'}
        </button>
      </div>
    </form>
  );
}
