import { createClient, type Session, type User, type Provider } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const supabaseConfigured = Boolean(url && anon);

export const supabase = supabaseConfigured
  ? createClient(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null;

export type { Session, User, Provider };

export function authRedirectTo(path = '/auth/callback'): string {
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}
