import type { Store } from '../db.js';
import { DEMO_EVENT_REGISTRATION_MESSAGE, REAL_EVENT_DEMO_ACCOUNT_MESSAGE } from './constants.js';

type TournamentRef = { organizationId?: string | null; ownerId?: string | null };

export async function isDemoTournament(store: Store, tournament: TournamentRef): Promise<boolean> {
  if (tournament.organizationId) {
    return Boolean((await store.getOrganization(tournament.organizationId))?.isDemo);
  }
  return Boolean(tournament.ownerId && (await store.demo().isAccount(tournament.ownerId)));
}

/**
 * Why this person can't enter this event, or null if they can. Demo accounts stay among demo events,
 * so they can't reach a real organizer's queue, and nobody else's details end up in a shared tenant.
 */
export async function demoEntryRefusal(
  store: Store,
  tournament: TournamentRef,
  userId: string | null,
): Promise<string | null> {
  const demoUser = userId ? await store.demo().isAccount(userId) : false;
  if (await isDemoTournament(store, tournament)) {
    return demoUser ? null : DEMO_EVENT_REGISTRATION_MESSAGE;
  }
  return demoUser ? REAL_EVENT_DEMO_ACCOUNT_MESSAGE : null;
}

/** Views of demo pages stay out of analytics. A page view names its event in one of these ways. */
export async function isDemoPageView(
  store: Store,
  view: { path: string; tournamentId?: string | null; liveToken?: string | null },
): Promise<boolean> {
  if (/[?&]demo=1(&|$)/.test(view.path)) return true;
  const tournament = view.tournamentId
    ? await store.getTournament(view.tournamentId)
    : view.liveToken
      ? await store.getTournamentByPublicToken(view.liveToken)
      : await tournamentFromPath(store, view.path);
  return tournament ? isDemoTournament(store, tournament) : false;
}

function tournamentFromPath(store: Store, path: string) {
  const slug = /^\/register\/([^/?#]+)/.exec(path)?.[1];
  return slug ? store.getTournamentBySlugOrId(decodeURIComponent(slug)) : Promise.resolve(null);
}
