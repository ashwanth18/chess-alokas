/**
 * The shared demo accounts (docs/DEMO.md). The API and the database enforce what these can do. This
 * is only so the screens can explain it, rather than offering a form that then fails.
 */
const DEMO_EMAIL_SUFFIX = '@alokas-demo.invalid';

export function isDemoEmail(email: string | null | undefined): boolean {
  return Boolean(email?.trim().toLowerCase().endsWith(DEMO_EMAIL_SUFFIX));
}

export function isDemoUser(
  user: { email?: string | null; app_metadata?: Record<string, unknown> } | null | undefined,
): boolean {
  if (!user) return false;
  return user.app_metadata?.['demo_account'] === true || isDemoEmail(user.email);
}

export const DEMO_ACCOUNT_EMAIL_REFUSED =
  'Demo accounts sign in with their password. No email can reach them.';

export const DEMO_ACCOUNT_LOCKED =
  'This is a shared demo account, so its password and email can’t be changed and it can’t be deleted.';
