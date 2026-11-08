import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { restoreSession, signOut as oauthSignOut, type Session } from './oauth';

interface SessionState {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    restoreSession()
      .then((s) => active && setSession(s))
      .catch(() => active && setSession(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await oauthSignOut();
    } finally {
      // Always drop local state, even if revocation failed.
      setSession(null);
    }
  }, []);

  const value = useMemo(() => ({ session, loading, signOut }), [session, loading, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
