import { useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  cleanLinks,
  cleanParts,
  FieldError,
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
import { resizeImage } from '../records/image';
import { plainImages } from '../records/blobs';
import { createUpdate } from '../records/write';
import { LIMITS } from '../../shared/lexicons';

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
  const formRef = useRef<HTMLFormElement>(null);

  if (loading) return <Status kind="loading" />;
  if (!session) return <SignInPrompt what="add an update" />;
  if (session.did !== did) {
    return (
      <section>
        <h1>Add update</h1>
        <p role="alert">You can only add updates to your own projects.</p>
        <p>
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
      const resized = await Promise.all(images.map((i) => resizeImage(i.file)));
      const files = resized.map((blob, n) => ({
        file: new File([blob], `photo-${n + 1}.jpg`, { type: blob.type || 'image/jpeg' }),
        alt: images[n].alt.trim(),
      }));
      const result = await createUpdate(session, {
        project: projectUri,
        heading: heading.trim(),
        body: body.trim(),
        images: files,
        links: l.value,
        parts: p.value,
      });
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
      });
      navigate(`/p/${did}/${rkey}`);
    } catch (err) {
      setSubmitError(writeErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={(e) => void onSubmit(e)} noValidate className="composer">
      <h1>Add update</h1>
      <p>
        <Link to={`/p/${did}/${rkey}`}>Back to the project</Link>
      </p>
      <TextField label="Heading" value={heading} onChange={setHeading} max={LIMITS.heading} error={errors.heading} />
      <TextField label="Notes" value={body} onChange={setBody} max={LIMITS.body} multiline error={errors.body} />
      <ImagePicker images={images} onChange={setImages} showErrors={showAltErrors} />
      <LinkList rows={links} onChange={setLinks} errors={linkErrors} />
      <PartsList rows={parts} onChange={setParts} errors={partErrors} />
      <FieldError id="submit-error">{submitError}</FieldError>
      <button type="submit" disabled={busy}>
        {busy ? 'Posting…' : 'Post update'}
      </button>
    </form>
  );
}
