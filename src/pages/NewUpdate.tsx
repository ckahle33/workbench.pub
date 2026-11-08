import { useRef, useState, type FormEvent } from 'react';
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
import { Status } from '../components/Status';
import { useSession } from '../auth/SessionContext';
import { useTitle } from '../hooks';
import { optimistic } from '../optimistic';
import { ImageTooLargeError, resizeImage } from '../records/image';
import { plainImages } from '../records/blobs';
import { createUpdate } from '../records/write';
import { LIMITS } from '../../shared/lexicons';

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
    const invalid = !!(next.heading || next.body || altMissing || Object.keys(l.errors).length || Object.keys(p.errors).length);
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
      afterWrite(() => navigate(href));
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
        <p>
          <Link to={postedHref}>Back to the project</Link>
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
      <div className="form-submit">
        <FieldError id="submit-error">{submitError}</FieldError>
        <button type="submit" aria-disabled={busy || undefined}>
          {busy ? 'Posting…' : 'Post update'}
        </button>
      </div>
    </form>
  );
}
