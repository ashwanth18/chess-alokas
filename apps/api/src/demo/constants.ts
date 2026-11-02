import type { DemoScopeFacts } from './types.js';

export const DEMO_ORG_SLUG = 'akademi-catur-demo';
export const DEMO_ORG_NAME = 'Akademi Catur Demo';

/** Every demo event's name carries this, so a parent on any build can see it isn't real. */
export const DEMO_NAME_SUFFIX = ' (Demo)';

/** `.invalid` is reserved by RFC 2606 and can never reach a mailbox. */
export const DEFAULT_DEMO_EMAIL_DOMAIN = 'alokas-demo.invalid';

/** Only if Supabase refuses `.invalid`: a subdomain you own with no MX record. See docs/DEMO.md. */
export function demoEmailDomain(env: NodeJS.ProcessEnv = process.env): string {
  return (env['DEMO_EMAIL_DOMAIN']?.trim().toLowerCase() || DEFAULT_DEMO_EMAIL_DOMAIN).replace(
    /^@/,
    '',
  );
}

/** Last line of defence for outgoing mail. Accounts are identified by demo_accounts, not by this. */
export function isDemoEmailAddress(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const address = email.trim().toLowerCase();
  return (
    address.endsWith(`@${DEFAULT_DEMO_EMAIL_DOMAIN}`) || address.endsWith(`@${demoEmailDomain(env)}`)
  );
}

export const DEMO_EMAIL_BLOCKED_MESSAGE =
  'Demo: no email was sent. A real organization’s players would receive this.';

export const DEMO_INVITE_BLOCKED_MESSAGE =
  'This is a demo organization, so no invite was sent. A real organization would email this person a one-time link.';

export const DEMO_ACCOUNT_LOCKED_MESSAGE =
  'This is a shared demo account, so it can’t be deleted and its password and email can’t be changed.';

export const DEMO_ORGANIZATION_BLOCKED_MESSAGE =
  'Demo accounts can’t create organizations. Sign up with your own email to create a real one.';

export const DEMO_INVITE_ACCEPT_BLOCKED_MESSAGE =
  'Demo accounts can’t join an organization. Sign in with your own account to accept this invite.';

export const DEMO_EVENT_REGISTRATION_MESSAGE =
  'This is a demo event, so nothing was saved and no real entry was made. Sign in with a demo player account to try registering.';

export const REAL_EVENT_DEMO_ACCOUNT_MESSAGE =
  'Demo accounts can’t enter real tournaments. Sign in with your own account to register.';

export class DemoGuardError extends Error {
  override readonly name = 'DemoGuardError';
}

/**
 * Throws unless deleting "demo data" can only mean the fictional tenant. This runs inside the
 * delete's transaction, so a failure leaves everything as it was.
 */
export function assertDemoScope(facts: DemoScopeFacts): void {
  if (facts.flaggedOrganizations.length > 1) {
    throw new DemoGuardError(
      `${facts.flaggedOrganizations.length} organizations are flagged as demo, and there should be one. Nothing was changed.`,
    );
  }
  const org = facts.flaggedOrganizations[0];
  if (org && org.slug !== DEMO_ORG_SLUG) {
    throw new DemoGuardError(
      `The organization flagged as demo has the slug "${org.slug}", not "${DEMO_ORG_SLUG}". Nothing was changed.`,
    );
  }
  if (facts.unflaggedSlugHolder) {
    throw new DemoGuardError(
      `A real organization already uses the slug "${DEMO_ORG_SLUG}". Nothing was changed.`,
    );
  }
  if (facts.foreignMembers > 0) {
    throw new DemoGuardError(
      `${facts.foreignMembers} member(s) of the demo organization are not demo accounts. Remove them first. Nothing was changed.`,
    );
  }
  if (facts.foreignProfileLinks > 0) {
    throw new DemoGuardError(
      `${facts.foreignProfileLinks} entries in real tournaments point at demo player profiles. Unlink them first. Nothing was changed.`,
    );
  }
}

/** A run that changes a count here undoes itself. */
export function assertRealCountsUnchanged(
  before: Record<string, number>,
  after: Record<string, number>,
): void {
  for (const [key, count] of Object.entries(before)) {
    if (after[key] !== count) {
      throw new DemoGuardError(
        `Real ${key} went from ${count} to ${after[key]} during a demo run, so it was undone.`,
      );
    }
  }
}
