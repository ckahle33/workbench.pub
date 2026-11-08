import { useId } from 'react';
import { FieldError } from './Composer';
import { clipGraphemes, graphemeLength, linkLengthFor } from '../records/crosspost';

interface Props {
  did: string;
  checked: boolean;
  onChecked: (v: boolean) => void;
  caption: string;
  onCaption: (v: string) => void;
  budget: number;
  error?: string;
}

/** Opt-in "Also post this to Bluesky" with an editable caption. Controlled; the page owns the state. */
export function CrosspostBox({ did, checked, onChecked, caption, onCaption, budget, error }: Props) {
  const id = useId();
  const left = budget - graphemeLength(caption);
  return (
    <fieldset className="field crosspost">
      <legend>Bluesky</legend>
      <label className="check" htmlFor={`${id}-on`}>
        <input id={`${id}-on`} type="checkbox" checked={checked} onChange={(e) => onChecked(e.target.checked)} />
        Also post this to Bluesky
      </label>
      {checked && (
        <>
          <label htmlFor={`${id}-caption`}>Bluesky caption</label>
          <textarea
            id={`${id}-caption`}
            rows={3}
            dir="auto"
            value={caption}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${error ? `${id}-err ` : ''}${id}-note ${id}-count`}
            onChange={(e) => onCaption(clipGraphemes(e.target.value, budget))}
          />
          <p id={`${id}-count`} className="meta">
            {left} characters left. The link back takes {linkLengthFor(did) + 1} of Bluesky's 300.
          </p>
          <FieldError id={`${id}-err`}>{error}</FieldError>
          <p id={`${id}-note`} className="meta">
            Posts a link back to this update. Your followers on Bluesky will see it. Deleting the update later does not delete the Bluesky post.
          </p>
        </>
      )}
    </fieldset>
  );
}
