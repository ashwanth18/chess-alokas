import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Provider, Session, User } from '@supabase/supabase-js';
import { authRedirectTo, supabase, supabaseConfigured } from '../lib/supabase';
import { db } from '../db/local';

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  displayName: string | null;
  signInWithPassword: (email: string, password: string) => Promise<{ error?: string }>;
  signUpWithPassword: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<{ error?: string }>;
  signInWithOtp: (email: string) => Promise<{ error?: string }>;
  verifyOtp: (email: string, token: string) => Promise<{ error?: string }>;
  signInWithOAuth: (provider: 'google' | 'github') => Promise<{ error?: string }>;
  resetPassword: (email: string) => Promise<{ error?: string }>;
  updatePassword: (password: string) => Promise<{ error?: string }>;
  updateDisplayName: (name: string) => Promise<{ error?: string }>;
  linkIdentity: (provider: 'google' | 'github') => Promise<{ error?: string }>;
  unlinkIdentity: (identityId: string) => Promise<{ error?: string }>;
  signOut: (scope?: 'local' | 'global') => Promise<void>;
  refreshProfile: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function persistOwnerId(userId: string | null) {
  if (userId) await db.meta.put({ key: 'ownerId', value: userId });
  else await db.meta.delete('ownerId');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    if (!supabase || !session?.user) {
      setDisplayName(null);
      return;
    }
    const { data } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', session.user.id)
      .maybeSingle();
    setDisplayName((data?.display_name as string | null) ?? null);
  }, [session?.user]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      void persistOwnerId(data.session?.user.id ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void persistOwnerId(next?.user.id ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

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
      user: session?.user ?? null,
      displayName,
      getAccessToken,
      refreshProfile,
      async signInWithPassword(email, password) {
        if (!supabase) return { error: 'Auth is not configured' };
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error: error?.message };
      },
      async signUpWithPassword(email, password, name) {
        if (!supabase) return { error: 'Auth is not configured' };
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name ?? '' },
            emailRedirectTo: authRedirectTo(),
          },
        });
        return { error: error?.message };
      },
      async signInWithOtp(email) {
        if (!supabase) return { error: 'Auth is not configured' };
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
      async signInWithOAuth(provider) {
        if (!supabase) return { error: 'Auth is not configured' };
        const { error } = await supabase.auth.signInWithOAuth({
          provider: provider as Provider,
          options: { redirectTo: authRedirectTo(), skipBrowserRedirect: false },
        });
        return { error: error?.message };
      },
      async resetPassword(email) {
        if (!supabase) return { error: 'Auth is not configured' };
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: authRedirectTo('/auth/reset'),
        });
        return { error: error?.message };
      },
      async updatePassword(password) {
        if (!supabase) return { error: 'Auth is not configured' };
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
      async linkIdentity(provider) {
        if (!supabase) return { error: 'Auth is not configured' };
        const { error } = await supabase.auth.linkIdentity({
          provider: provider as Provider,
          options: { redirectTo: authRedirectTo() },
        });
        return { error: error?.message };
      },
      async unlinkIdentity(identityId) {
        if (!supabase || !session?.user) return { error: 'Not signed in' };
        const identity = session.user.identities?.find((i) => i.identity_id === identityId);
        if (!identity) return { error: 'Identity not found' };
        const { error } = await supabase.auth.unlinkIdentity(identity);
        return { error: error?.message };
      },
      async signOut(scope = 'local') {
        if (!supabase) return;
        await supabase.auth.signOut({ scope });
        await persistOwnerId(null);
      },
    }),
    [loading, session, displayName, getAccessToken, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
