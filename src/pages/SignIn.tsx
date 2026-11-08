import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { normalizeIdentifier } from '../auth/config';
import { signIn } from '../auth/oauth';
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
    } catch {
      setError('Could not start sign-in. Check the handle and try again.');
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Sign in</h1>
      <form onSubmit={onSubmit} noValidate>
        <label htmlFor="handle">Your AT Protocol handle</label>
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
          aria-describedby={error ? 'handle-error' : undefined}
        />
        {error && (
          <p id="handle-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || loading}>
          {busy ? 'Redirecting...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
