import type { AccountRole, OrganizationMemberRole } from '@chess-alokas/shared';

/**
 * One login, two areas. These rules decide which area someone opens into and what their account menu
 * offers. No React and no storage here, so every case can be tested directly.
 */

export type WorkspaceView = 'player' | 'organizer';
/** Where the menu is being shown: inside one of the two areas, or on a public page like /discover. */
export type MenuPlace = WorkspaceView | 'public';

export const isDesktop =
  Boolean(typeof window !== 'undefined' && window.desktop?.isDesktop) || import.meta.env.VITE_DESKTOP === '1';

/** What the API said about this account. Null until it has answered at least once on this device. */
export interface WorkspaceFacts {
  memberRoles: OrganizationMemberRole[];
  accountRole: AccountRole | null;
  hasPlayerProfile: boolean;
}

export type MenuLink = {
  id: 'run' | 'switch' | 'desk' | 'player';
  label: string;
  to: string;
  /** Following this link is the person's choice, kept per device. */
  remember?: WorkspaceView;
};

/** Opens the organization form on the desk. See Layout. */
export const ORGANIZER_SETUP_PATH = '/app?setup=organization';

export function isOrganizer(facts: WorkspaceFacts): boolean {
  return facts.memberRoles.length > 0 || facts.accountRole === 'organizer' || facts.accountRole === 'both';
}

/** Can't run tournaments anywhere: the desk's tournament list and New have nothing for them. */
export function isArbiterOnly(facts: WorkspaceFacts): boolean {
  return facts.memberRoles.length > 0 && facts.memberRoles.every((role) => role === 'arbiter');
}

/**
 * Both sides of the product are really in use. `account_role = 'both'` can't say this: the database
 * sets it on anyone who creates an organization, because every account starts as 'participant'. A
 * player profile is the evidence of a player side.
 */
export function hasBothSides(facts: WorkspaceFacts): boolean {
  return isOrganizer(facts) && facts.hasPlayerProfile;
}

const deskHome = (facts: WorkspaceFacts | null) => (facts && isArbiterOnly(facts) ? '/team' : '/app');

/** Where someone goes with nowhere particular to be. A return path is decided before this is asked. */
export function landingPath(
  facts: WorkspaceFacts | null,
  options: { desktop: boolean; preferredView: WorkspaceView | null; pendingOrganizer: boolean },
): string {
  if (options.desktop) return deskHome(facts);
  // Signed up as an organizer and the organization isn't made yet. The desk finishes that.
  if (options.pendingOrganizer) return '/app';
  // Nothing known, so most likely offline. The desk is the side that works without a connection.
  if (!facts) return '/app';
  if (!isOrganizer(facts)) return '/player';
  if (hasBothSides(facts) && options.preferredView === 'player') return '/player';
  return deskHome(facts);
}

/** `/app` is the old front door, so a player arriving there still reaches their own page. */
export function deskHomeRedirect(
  facts: WorkspaceFacts | null,
  options: { desktop: boolean; settingUp: boolean; pendingOrganizer: boolean },
): string | null {
  if (options.desktop || options.settingUp || options.pendingOrganizer || !facts) return null;
  return isOrganizer(facts) ? null : '/player';
}

const NEUTRAL_PATHS = /^\/(account|settings|admin)(\/|$)/;

/** Which area's navigation a signed-in page belongs to. Every URL keeps working either way. */
export function currentArea(
  pathname: string,
  facts: WorkspaceFacts | null,
  options: { desktop: boolean; preferredView: WorkspaceView | null },
): WorkspaceView {
  if (options.desktop) return 'organizer';
  if (pathname.startsWith('/player')) return 'player';
  if (!facts) return 'organizer';
  if (!isOrganizer(facts)) return 'player';
  if (NEUTRAL_PATHS.test(pathname) && hasBothSides(facts) && options.preferredView === 'player') return 'player';
  return 'organizer';
}

/** The brand mark's target inside the app. */
export function areaHome(area: WorkspaceView, facts: WorkspaceFacts | null): string {
  return area === 'player' ? '/player' : deskHome(facts);
}

/** The links above Account and Settings in the account menu. */
export function workspaceLinks(
  facts: WorkspaceFacts | null,
  options: { desktop: boolean; place: MenuPlace },
): MenuLink[] {
  const { desktop, place } = options;
  const desk: MenuLink = facts && isArbiterOnly(facts)
    ? { id: 'desk', label: 'Floor duty', to: '/team' }
    : { id: 'desk', label: 'My desk', to: '/app' };
  const player: MenuLink = { id: 'player', label: 'My player page', to: '/player' };

  if (desktop) return place === 'public' ? [desk] : [];
  if (!facts) return [];
  if (!isOrganizer(facts)) {
    const run: MenuLink = { id: 'run', label: 'Run a tournament', to: ORGANIZER_SETUP_PATH };
    return place === 'public' ? [player, run] : [run];
  }
  if (place === 'public') return facts.hasPlayerProfile ? [desk, player] : [desk];
  if (hasBothSides(facts)) {
    return place === 'organizer'
      ? [{ id: 'switch', label: 'Switch to player view', to: '/player', remember: 'player' }]
      : [{ id: 'switch', label: 'Switch to organizer view', to: deskHome(facts), remember: 'organizer' }];
  }
  // An organizer with no player side who opened /player by its URL still needs a way back.
  return place === 'player' ? [desk] : [];
}
