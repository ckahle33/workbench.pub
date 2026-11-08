import { useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { safeHttpUrl } from '../api';
import { useSession } from '../auth/SessionContext';
import { usePaged } from '../hooks';
import { LIMITS, normalizeSlug } from '../../shared/lexicons';
import { createTopic } from '../records/write';
import { LoadMore, Status } from './Status';

export const GENERIC_ERROR = 'Something went wrong. Please try again.';

/** Writers throw messages that start with "Could not" for network failures; anything else gets a generic message. */
export function writeErrorMessage(e: unknown): string {
  return e instanceof Error && /^Could not [\w ]+\.( Please try again\.)?$/.test(e.message) ? e.message : GENERIC_ERROR;
}

/** After a failed validation, move focus to the first invalid control (call after the errors have rendered). */
export function focusFirstInvalid(form: HTMLElement | null): void {
  form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}

export function SignInPrompt({ what }: { what: string }) {
  return (
    <section aria-labelledby="signin-h">
      <h1 id="signin-h">Sign in to {what}</h1>
      <p>You need to sign in with your AT Protocol account first.</p>
      <p>
        <Link to="/signin">Sign in</Link>
      </p>
    </section>
  );
}

export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  return children ? (
    <p id={id} role="alert" className="field-error">
      {children}
    </p>
  ) : null;
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  multiline?: boolean;
  error?: string;
  hint?: string;
  required?: boolean;
}

/** Labelled text input or textarea with a hard length limit and a remaining-characters count. */
export function TextField({ label, value, onChange, max, multiline, error, hint, required }: TextFieldProps) {
  const id = useId();
  const describedBy = [error ? `${id}-err` : '', hint ? `${id}-hint` : '', `${id}-count`].filter(Boolean).join(' ');
  const common = {
    id,
    value,
    maxLength: max,
    required,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    dir: 'auto' as const,
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p id={`${id}-hint`} className="meta">
          {hint}
        </p>
      )}
      {multiline ? (
        <textarea {...common} rows={6} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input {...common} type="text" onChange={(e) => onChange(e.target.value)} />
      )}
      <p id={`${id}-count`} className="meta">
        {max - value.length} characters left
      </p>
      <FieldError id={`${id}-err`}>{error}</FieldError>
    </div>
  );
}

// ---- Images -------------------------------------------------------------------

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export interface PickedImage {
  id: number;
  file: File;
  alt: string;
}
let imageId = 0;

export function ImagePicker({ images, onChange, showErrors }: { images: PickedImage[]; onChange: (v: PickedImage[]) => void; showErrors: boolean }) {
  const inputId = useId();
  const [pickError, setPickError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function onPick(files: FileList | null) {
    const picked = Array.from(files ?? []);
    if (input.current) input.current.value = '';
    const bad = picked.find((f) => !IMAGE_TYPES.includes(f.type));
    const good = picked.filter((f) => IMAGE_TYPES.includes(f.type));
    const room = LIMITS.images - images.length;
    const message =
      bad
        ? `${bad.name} is not a supported image. Use JPEG, PNG, WebP or GIF.`
        : good.length > room
          ? `You can add up to ${LIMITS.images} photos.`
          : null;
    setPickError(message);
    if (room > 0 && good.length > 0) {
      onChange([...images, ...good.slice(0, room).map((file) => ({ id: ++imageId, file, alt: '' }))]);
    }
  }

  return (
    <fieldset className="field">
      <legend>Photos</legend>
      <label htmlFor={inputId}>Add photos</label>
      <p className="meta">
        Up to {LIMITS.images} photos (JPEG, PNG, WebP or GIF). Each needs a short description for people who cannot see it.
      </p>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        multiple
        disabled={images.length >= LIMITS.images}
        aria-invalid={pickError ? true : undefined}
        aria-describedby={pickError ? `${inputId}-err` : undefined}
        onChange={(e) => onPick(e.target.files)}
      />
      <FieldError id={`${inputId}-err`}>{pickError}</FieldError>
      <ul className="composer-list">
        {images.map((img, i) => {
          const missing = showErrors && img.alt.trim() === '';
          const altId = `${inputId}-alt-${img.id}`;
          return (
            <li key={img.id}>
              <p className="meta">{img.file.name}</p>
              <label htmlFor={altId}>{`Alt text for photo ${i + 1} (${img.file.name})`}</label>
              <input
                id={altId}
                type="text"
                maxLength={LIMITS.title}
                value={img.alt}
                dir="auto"
                aria-invalid={missing ? true : undefined}
                aria-describedby={missing ? `${altId}-err` : undefined}
                onChange={(e) => onChange(images.map((x) => (x.id === img.id ? { ...x, alt: e.target.value } : x)))}
              />
              <FieldError id={`${altId}-err`}>{missing ? `Alt text is required for photo ${i + 1}.` : null}</FieldError>
              <button type="button" onClick={() => onChange(images.filter((x) => x.id !== img.id))}>
                {`Remove photo ${i + 1}`}
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

// ---- Links --------------------------------------------------------------------

export interface LinkRow {
  id: number;
  url: string;
  title: string;
}
let rowId = 0;
export const newLinkRow = (): LinkRow => ({ id: ++rowId, url: '', title: '' });

/** Rows with an address become link definitions; empty rows are ignored; bad addresses are errors keyed by row id. */
export function cleanLinks(rows: LinkRow[]): { value: { url: string; title?: string }[]; errors: Record<number, string> } {
  const value: { url: string; title?: string }[] = [];
  const errors: Record<number, string> = {};
  rows.forEach((r, i) => {
    const url = r.url.trim();
    if (!url && !r.title.trim()) return;
    const href = safeHttpUrl(url);
    if (!href) errors[r.id] = `Link ${i + 1} needs a web address starting with http:// or https://.`;
    else value.push(r.title.trim() ? { url, title: r.title.trim() } : { url });
  });
  return { value, errors };
}

export function LinkList({ rows, onChange, errors }: { rows: LinkRow[]; onChange: (v: LinkRow[]) => void; errors: Record<number, string> }) {
  const base = useId();
  const set = (id: number, patch: Partial<LinkRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <fieldset className="field">
      <legend>Links</legend>
      <ul className="composer-list">
        {rows.map((r, i) => (
          <li key={r.id}>
            <label htmlFor={`${base}-u${r.id}`}>{`Link ${i + 1} address`}</label>
            <input
              id={`${base}-u${r.id}`}
              type="url"
              inputMode="url"
              maxLength={2048}
              value={r.url}
              placeholder="https://"
              aria-invalid={errors[r.id] ? true : undefined}
              aria-describedby={errors[r.id] ? `${base}-e${r.id}` : undefined}
              onChange={(e) => set(r.id, { url: e.target.value })}
            />
            <label htmlFor={`${base}-t${r.id}`}>{`Link ${i + 1} title (optional)`}</label>
            <input id={`${base}-t${r.id}`} type="text" maxLength={LIMITS.title} value={r.title} dir="auto" onChange={(e) => set(r.id, { title: e.target.value })} />
            <FieldError id={`${base}-e${r.id}`}>{errors[r.id]}</FieldError>
            <button type="button" onClick={() => onChange(rows.filter((x) => x.id !== r.id))}>{`Remove link ${i + 1}`}</button>
          </li>
        ))}
      </ul>
      <button type="button" disabled={rows.length >= LIMITS.links} onClick={() => onChange([...rows, newLinkRow()])}>
        Add link
      </button>
      {rows.length >= LIMITS.links && <p className="meta">Up to {LIMITS.links} links.</p>}
    </fieldset>
  );
}

// ---- Parts --------------------------------------------------------------------

export interface PartRow {
  id: number;
  item: string;
  quantity: string;
  note: string;
}
export const newPartRow = (): PartRow => ({ id: ++rowId, item: '', quantity: '', note: '' });

export function cleanParts(rows: PartRow[]): { value: { item: string; quantity: string; note?: string }[]; errors: Record<number, string> } {
  const value: { item: string; quantity: string; note?: string }[] = [];
  const errors: Record<number, string> = {};
  rows.forEach((r, i) => {
    const item = r.item.trim();
    const quantity = r.quantity.trim();
    const note = r.note.trim();
    if (!item && !quantity && !note) return;
    if (!item || !quantity) errors[r.id] = `Part ${i + 1} needs both an item and a quantity.`;
    else value.push(note ? { item, quantity, note } : { item, quantity });
  });
  return { value, errors };
}

export function PartsList({ rows, onChange, errors }: { rows: PartRow[]; onChange: (v: PartRow[]) => void; errors: Record<number, string> }) {
  const base = useId();
  const set = (id: number, patch: Partial<PartRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <fieldset className="field">
      <legend>Parts</legend>
      <ul className="composer-list">
        {rows.map((r, i) => (
          <li key={r.id}>
            <label htmlFor={`${base}-i${r.id}`}>{`Part ${i + 1} item`}</label>
            <input id={`${base}-i${r.id}`} type="text" maxLength={LIMITS.title} value={r.item} dir="auto" aria-invalid={errors[r.id] ? true : undefined} aria-describedby={errors[r.id] ? `${base}-e${r.id}` : undefined} onChange={(e) => set(r.id, { item: e.target.value })} />
            <label htmlFor={`${base}-q${r.id}`}>{`Part ${i + 1} quantity`}</label>
            <input id={`${base}-q${r.id}`} type="text" maxLength={40} value={r.quantity} dir="auto" aria-invalid={errors[r.id] ? true : undefined} aria-describedby={errors[r.id] ? `${base}-e${r.id}` : undefined} onChange={(e) => set(r.id, { quantity: e.target.value })} />
            <label htmlFor={`${base}-n${r.id}`}>{`Part ${i + 1} note (optional)`}</label>
            <input id={`${base}-n${r.id}`} type="text" maxLength={LIMITS.summary} value={r.note} dir="auto" onChange={(e) => set(r.id, { note: e.target.value })} />
            <FieldError id={`${base}-e${r.id}`}>{errors[r.id]}</FieldError>
            <button type="button" onClick={() => onChange(rows.filter((x) => x.id !== r.id))}>{`Remove part ${i + 1}`}</button>
          </li>
        ))}
      </ul>
      <button type="button" disabled={rows.length >= LIMITS.parts} onClick={() => onChange([...rows, newPartRow()])}>
        Add part
      </button>
      {rows.length >= LIMITS.parts && <p className="meta">Up to {LIMITS.parts} parts.</p>}
    </fieldset>
  );
}

// ---- Topic selector -----------------------------------------------------------

interface TopicItem {
  uri: string;
  slug: string;
  name: string;
  description: string;
}
const NEW_TOPIC = '__new__';

/**
 * Only canonical slugs ever leave this component: existing topics come from the API, and a new
 * topic is written with createTopic first, whose returned slug is what gets selected.
 */
export function TopicSelector({ value, onChange, error }: { value: string | null; onChange: (slug: string | null) => void; error?: string }) {
  const id = useId();
  const { session } = useSession();
  const list = usePaged<TopicItem>('/api/topics');
  const [extras, setExtras] = useState<TopicItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const known = [...list.items, ...extras.filter((e) => !list.items.some((t) => t.slug === e.slug))];
  const previewSlug = normalizeSlug(name);

  async function create() {
    if (!previewSlug || !session) {
      setCreateError('Topic name needs 2 to 40 letters or numbers.');
      return;
    }
    setCreateError(null);
    if (known.some((t) => t.slug === previewSlug)) {
      setCreating(false);
      onChange(previewSlug);
      return;
    }
    setBusy(true);
    try {
      const made = await createTopic(session, { name: name.trim(), description: '' });
      setExtras((x) => [...x, { uri: made.uri, slug: made.slug, name: name.trim(), description: '' }]);
      setCreating(false);
      setName('');
      onChange(made.slug);
    } catch (e) {
      setCreateError(writeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label htmlFor={id}>Topic</label>
      {list.phase === 'loading' && <Status kind="loading" />}
      {list.phase === 'error' && <Status kind="error">Could not load topics. You can still create a new one.</Status>}
      <select
        id={id}
        value={creating ? NEW_TOPIC : (value ?? '')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={(e) => {
          if (e.target.value === NEW_TOPIC) {
            setCreating(true);
            onChange(null);
          } else {
            setCreating(false);
            onChange(e.target.value || null);
          }
        }}
      >
        <option value="">Choose a topic…</option>
        {known.map((t) => (
          <option key={t.slug} value={t.slug}>{`${t.name} (#${t.slug})`}</option>
        ))}
        <option value={NEW_TOPIC}>Create a new topic…</option>
      </select>
      <LoadMore label="Load more topics" hasMore={list.hasMore} loading={list.loadingMore} failed={list.moreFailed} onClick={list.loadMore} />
      {value && !creating && <p className="meta">Topic that will be used: #{value}</p>}
      <FieldError id={`${id}-err`}>{error}</FieldError>
      {creating && (
        <div className="subform">
          <TextField label="New topic name" value={name} onChange={setName} max={LIMITS.title} error={createError ?? undefined} />
          <p className="meta">{previewSlug ? <>Slug that will be used: #{previewSlug}</> : 'Slug that will be used: (enter 2 to 40 letters or numbers)'}</p>
          <button type="button" disabled={busy} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create topic'}
          </button>
        </div>
      )}
    </div>
  );
}
