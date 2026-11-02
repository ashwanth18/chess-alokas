export const PENDING_SIGNUP_STORAGE_KEY = 'alokas:pendingSignupAction';

/** Signed up as an organizer, and the organization is still to be created once they're signed in. */
export function hasPendingOrganizerSignup(): boolean {
  try {
    const raw = localStorage.getItem(PENDING_SIGNUP_STORAGE_KEY);
    if (!raw) return false;
    const pending = JSON.parse(raw) as { role?: string; orgName?: string };
    return pending.role === 'organizer' && Boolean(pending.orgName);
  } catch {
    return false;
  }
}
