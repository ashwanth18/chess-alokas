import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  isAuthApiError,
  isAuthSessionMissingError,
  type Session,
  type User,
} from '@supabase/supabase-js';
import * as Sentry from '@sentry/react';
import { authRedirectTo, supabase, supabaseConfigured } from '../lib/supabase';
import { persistOwnerId } from '../lib/ownerIdSink';
import { sentryEnabled } from '../instrument';
import { clearBootIssue, reportBootIssue } from '../lib/bootDiagnostics';
import { DEMO_ACCOUNT_EMAIL_REFUSED, DEMO_ACCOUNT_LOCKED, isDemoEmail, isDemoUser } from '../lib/demoAccount';
import { setAnalyticsSuppressed } from '../lib/pageAnalytics';

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  /**
   * True when `user` comes from the saved sign-in because its token could not be
   * refreshed (no network). Local work continues; `session` stays null, so no
   * token is available for cloud calls until the refresh succeeds.
   */
  sessionOffline: boolean;
  displayName: string | null;
  isPlatformAdmin: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error?: string }>;
  signUpWithPassword: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<{ error?: string }>;
  signInWithOtp: (email: string) => Promise<{ error?: string }>;
  verifyOtp: (email: string, token: string) => Promise<{ error?: string }>;
  resetPassword: (email: string) => Promise<{ error?: string }>;
  updatePassword: (password: string) => Promise<{ error?: string }>;
  updateDisplayName: (name: string) => Promise<{ error?: string }>;
  signOut: (scope?: 'local' | 'global') => Promise<void>;
  refreshProfile: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isDesktopApp(): boolean {
  return (
    typeof window !== 'undefined' &&
    (Boolean(window.desktop?.isDesktop) || import.meta.env.VITE_DESKTOP === '1')
  );
}

const DESKTOP_RESET_MESSAGE =
  'Reset your password at chess-manager.alokas.com in your browser, then sign in here.';

function authStorageKey(): string | null {
  if (!supabase) return null;
  const fromClient = (supabase.auth as unknown as { storageKey?: unknown }).storageKey;
  return typeof fromClient === 'string' ? fromClient : null;
}

/** The saved sign-in as supabase-js stored it, read without touching the network. */
function readCachedSignIn(): { user: User; expired: boolean } | null {
  const key = authStorageKey();
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: User; expires_at?: number; refresh_token?: string };
    if (!parsed?.user?.id || !parsed.refresh_token) return null;
    return {
      user: parsed.user,
      expired: !parsed.expires_at || parsed.expires_at * 1000 <= Date.now(),
    };
  } catch {
    return null;
  }
}

/** The auth server said no. Anything else (no network, 5xx, timeout) may succeed later. */
function isDefinitiveAuthRejection(err: unknown): boolean {
  if (isAuthSessionMissingError(err)) return true;
  return isAuthApiError(err) && err.status >= 400 && err.status < 500;
}

/** supabase-js waits on any refresh in flight, which can take a long time to fail offline. */
async function signOutWithin(scope: 'local' | 'global', ms: number): Promise<{ error: unknown }> {
  if (!supabase) return { error: null };
  const attempt = supabase.auth.signOut({ scope }).then(
    ({ error }) => ({ error: error as unknown }),
    (err: unknown) => ({ error: err }),
  );
  const timeout = new Promise<{ error: unknown }>((resolve) => {
    window.setTimeout(() => resolve({ error: new Error('Sign-out timed out') }), ms);
  });
  return Promise.race([attempt, timeout]);
}

function removeStoredSignIn() {
  const key = authStorageKey();
  if (key) {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(`${key}-code-verifier`);
  }
}

/** Sign-out must work offline, where supabase-js can return before clearing its storage. */
async function clearSignInLocally() {
  const { error } = await signOutWithin('local', 3_000);
  if (error) removeStoredSignIn();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [offlineUser, setOfflineUser] = useState<User | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  useEffect(() => {
    setAnalyticsSuppressed(isDemoUser(session?.user));
  }, [session?.user]);

  const refreshProfile = useCallback(async () => {
    if (!supabase || !session?.user) {
      setDisplayName(null);
      setIsPlatformAdmin(false);
      return;
    }
    const jwtAdmin = Boolean(
      (session.user.app_metadata as Record<string, unknown> | undefined)?.['platform_admin'],
    );
    const { data, error } = await supabase
      .from('profiles')
      .select('display_name, is_platform_admin')
      .eq('id', session.user.id)
      .maybeSingle();
    if (error) {
      console.warn('[auth] profiles select failed; using JWT admin claim', error.message);
      setDisplayName(null);
      setIsPlatformAdmin(jwtAdmin);
      return;
    }
    setDisplayName((data?.display_name as string | null) ?? null);
    // Profile is source of truth when readable; JWT claim covers select failures / cache lag.
    setIsPlatformAdmin(Boolean(data?.is_platform_admin) || jwtAdmin);
  }, [session?.user]);

  useEffect(() => {
    if (!supabase) {
      reportBootIssue(
        'AUTH_NOT_CONFIGURED',
        'Sign-in is not configured in this build (missing Supabase keys).',
      );
      setLoading(false);
      return;
    }
    let mounted = true;
    let settled = false;
    // An expired token needs the network to refresh, and that can take a long
    // time to fail. Don't make someone without Wi-Fi wait for it to reach their data.
    const cached = readCachedSignIn();
    if (cached?.expired) {
      setOfflineUser(cached.user);
      setLoading(false);
    }
    const timer = window.setTimeout(() => {
      if (!mounted || settled) return;
      reportBootIssue(
        'AUTH_SESSION_TIMEOUT',
        'Cached sign-in did not load within 10 seconds. You can still sign in.',
      );
      setLoading(false);
    }, 10_000);
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return;
        settled = true;
        if (data.session) {
          clearBootIssue();
          setSession(data.session);
          setOfflineUser(null);
          void persistOwnerId(data.session.user.id);
          return;
        }
        const stillSaved = readCachedSignIn();
        if (error && !isDefinitiveAuthRejection(error) && stillSaved) {
          // Could not refresh right now. Keep local access with no token.
          console.warn('[auth] could not refresh sign-in; working offline', error.message);
          setOfflineUser(stillSaved.user);
          return;
        }
        if (error) reportBootIssue('AUTH_SESSION_FAILED', error.message);
        else clearBootIssue();
        setSession(null);
        setOfflineUser(null);
        void persistOwnerId(null);
      })
      .catch((err) => {
        if (!mounted) return;
        settled = true;
        const message = err instanceof Error ? err.message : String(err);
        reportBootIssue('AUTH_SESSION_FAILED', message);
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (mounted) setLoading(false);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (next) {
        setSession(next);
        setOfflineUser(null);
        void persistOwnerId(next.user.id);
        return;
      }
      setSession(null);
      // INITIAL_SESSION also reports null when a refresh merely failed; the saved
      // sign-in is still there then. SIGNED_OUT is what a real rejection or sign-out sends.
      const saved = event === 'SIGNED_OUT' ? null : readCachedSignIn();
      setOfflineUser(saved?.user ?? null);
      if (!saved) void persistOwnerId(null);
    });
    return () => {
      mounted = false;
      window.clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  // While working offline, keep trying to get a real session back.
  const hasOfflineUser = Boolean(offlineUser);
  useEffect(() => {
    const client = supabase;
    if (!client || !hasOfflineUser) return;
    let running = false;
    const retry = () => {
      if (running) return;
      running = true;
      void client.auth
        .getSession()
        .then(({ data }) => {
          if (!data.session) return;
          setSession(data.session);
          setOfflineUser(null);
        })
        .catch(() => undefined)
        .finally(() => {
          running = false;
        });
    };
    const interval = window.setInterval(retry, 30_000);
    window.addEventListener('online', retry);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', retry);
    };
  }, [hasOfflineUser]);

  // The API answered 401. That alone does not prove the sign-in is dead: on flaky
  // Wi-Fi a failed refresh leaves the request with no token at all. Ask the auth
  // server. Sign out only if it rejects the refresh token, or if a just-refreshed
  // token is rejected again.
  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let checking = false;
    let refreshedAt = 0;
    const signOutNow = async () => {
      await clearSignInLocally();
      setSession(null);
      setOfflineUser(null);
      await persistOwnerId(null);
    };
    const onExpired = () => {
      if (checking) return;
      checking = true;
      void (async () => {
        try {
          if (Date.now() - refreshedAt < 60_000) {
            await signOutNow();
            return;
          }
          const { error } = await client.auth.refreshSession();
          if (!error) {
            refreshedAt = Date.now();
          } else if (isDefinitiveAuthRejection(error)) {
            await signOutNow();
          } else {
            console.warn('[auth] 401 but could not reach the auth server; keeping sign-in', error.message);
          }
        } finally {
          checking = false;
        }
      })();
    };
    window.addEventListener('auth:session-expired', onExpired);
    return () => window.removeEventListener('auth:session-expired', onExpired);
  }, []);

  useEffect(() => {
    if (!sentryEnabled) return;
    // Opaque id only: no email or other personal data goes to error reporting.
    const id = session?.user.id ?? offlineUser?.id;
    Sentry.setUser(id ? { id } : null);
  }, [session?.user.id, offlineUser?.id]);

  const getAccessToken = useCallback(async () => {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: supabaseConfigured,
      loading,
      session,
      user: session?.user ?? offlineUser,
      sessionOffline: !session && Boolean(offlineUser),
      displayName,
      isPlatformAdmin,
      getAccessToken,
      refreshProfile,
      async signInWithPassword(email, password) {
        if (!supabase) return { error: 'Auth is not configured' };
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error?.message };
      },
      async signUpWithPassword(email, password, name) {
        if (!supabase) return { error: 'Auth is not configured' };
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name ?? '' },
            emailRedirectTo: authRedirectTo(),
          },
        });
        // With email confirmation on, an address already in use comes back as a user with no identities.
        if (!error && data.user?.identities?.length === 0) {
          return { error: 'There is already an account with this email. Sign in instead, or reset your password.' };
        }
        return { error: error?.message };
      },
      async signInWithOtp(email) {
        if (!supabase) return { error: 'Auth is not configured' };
        if (isDemoEmail(email)) return { error: DEMO_ACCOUNT_EMAIL_REFUSED };
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: authRedirectTo(), shouldCreateUser: true },
        });
        return { error: error?.message };
      },
      async verifyOtp(email, token) {
        if (!supabase) return { error: 'Auth is not configured' };
        const { error } = await supabase.auth.verifyOtp({
          email,
          token,
          type: 'email',
        });
        return { error: error?.message };
      },
      async resetPassword(email) {
        if (!supabase) return { error: 'Auth is not configured' };
        if (isDemoEmail(email)) return { error: DEMO_ACCOUNT_EMAIL_REFUSED };
        if (isDesktopApp()) return { error: DESKTOP_RESET_MESSAGE };
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: authRedirectTo('/auth/reset'),
        });
        return { error: error?.message };
      },
      async updatePassword(password) {
        if (!supabase) return { error: 'Auth is not configured' };
        if (isDemoUser(session?.user)) return { error: DEMO_ACCOUNT_LOCKED };
        const { error } = await supabase.auth.updateUser({ password });
        return { error: error?.message };
      },
      async updateDisplayName(name) {
        if (!supabase || !session?.user) return { error: 'Not signed in' };
        const { error } = await supabase.from('profiles').upsert({
          id: session.user.id,
          display_name: name.trim() || null,
          updated_at: new Date().toISOString(),
        });
        if (!error) setDisplayName(name.trim() || null);
        return { error: error?.message };
      },
      async signOut(scope = 'local') {
        if (!supabase) return;
        if (offlineUser && !session) {
          // No reachable server: end it on this device now rather than wait for a timeout.
          removeStoredSignIn();
          void signOutWithin('local', 3_000);
        } else {
          const { error } = await signOutWithin(scope, 5_000);
          // Offline the server call fails; the sign-out on this device must still happen.
          if (error) removeStoredSignIn();
        }
        setSession(null);
        setOfflineUser(null);
        await persistOwnerId(null);
        if (sentryEnabled) Sentry.setUser(null);
      },
    }),
    [loading, session, offlineUser, displayName, isPlatformAdmin, getAccessToken, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
