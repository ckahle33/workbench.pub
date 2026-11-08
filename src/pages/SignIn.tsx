import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { normalizeIdentifier } from '../auth/config';
import { signIn, SignInError } from '../auth/oauth';
import { useSession } from '../auth/SessionContext';
import { useTitle } from '../hooks';

export function SignIn() {
  const { session, loading } = useSession();
  useTitle('Sign in');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const handle = normalizeIdentifier(value);
    if (!handle) {
      setError('Enter a valid handle such as alice.bsky.social, or a DID.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await signIn(handle);
    } catch (err) {
      setError(
        err instanceof SignInError && err.reason === 'invalid-handle'
          ? 'Could not start sign-in. Check the handle and try again.'
          : 'Sign-in is unavailable right now. Try again later.',
      );
      setBusy(false);
    }
  }

  return (
    <div className="form-page signin">
      <h1>Sign in</h1>
      <p className="form-intro">
        Use your Bluesky or other AT Protocol account. Your projects are saved in that account, not on this site.
      </p>
      <form onSubmit={onSubmit} noValidate className="signin-form">
        <label htmlFor="handle">Your AT Protocol handle</label>
        <div className="signin-row">
          <input
            id="handle"
            name="handle"
            type="text"
            inputMode="url"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="alice.bsky.social"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'handle-error' : 'handle-help'}
          />
          <button type="submit" disabled={busy || loading}>
            {busy ? 'Redirecting...' : 'Sign in'}
          </button>
        </div>
        {error ? (
          <p id="handle-error" role="alert" className="field-error">
            {error}
          </p>
        ) : (
          <p id="handle-help" className="helper signin-help">
            For example alice.bsky.social, or a DID.
          </p>
        )}
      </form>
    </div>
  );
}
