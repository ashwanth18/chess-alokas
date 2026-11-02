import { describe, expect, it } from 'vitest';
import {
  areaHome,
  currentArea,
  deskHomeRedirect,
  hasBothSides,
  isArbiterOnly,
  isOrganizer,
  landingPath,
  workspaceLinks,
  type WorkspaceFacts,
} from './workspace';

const player: WorkspaceFacts = { memberRoles: [], accountRole: 'participant', hasPlayerProfile: true };
const newPlayer: WorkspaceFacts = { memberRoles: [], accountRole: 'participant', hasPlayerProfile: false };
const owner: WorkspaceFacts = { memberRoles: ['owner'], accountRole: 'both', hasPlayerProfile: false };
const roleOnly: WorkspaceFacts = { memberRoles: [], accountRole: 'organizer', hasPlayerProfile: false };
const both: WorkspaceFacts = { memberRoles: ['director'], accountRole: 'both', hasPlayerProfile: true };
const arbiter: WorkspaceFacts = { memberRoles: ['arbiter'], accountRole: 'both', hasPlayerProfile: false };
const arbiterHere: WorkspaceFacts = { memberRoles: ['arbiter', 'director'], accountRole: 'both', hasPlayerProfile: false };

const web = { desktop: false, preferredView: null, pendingOrganizer: false };
const landing = (facts: WorkspaceFacts | null, options: Partial<typeof web> | { preferredView: 'player' | 'organizer' } = {}) =>
  landingPath(facts, { ...web, ...options });

describe('who is what', () => {
  it('counts any membership or an organizer account role as an organizer', () => {
    expect(isOrganizer(owner)).toBe(true);
    expect(isOrganizer(arbiter)).toBe(true);
    expect(isOrganizer(roleOnly)).toBe(true);
    expect(isOrganizer({ ...roleOnly, accountRole: 'both' })).toBe(true);
    expect(isOrganizer(player)).toBe(false);
    expect(isOrganizer({ ...player, accountRole: null })).toBe(false);
  });

  it('calls someone arbiter-only just when no membership can run tournaments', () => {
    expect(isArbiterOnly(arbiter)).toBe(true);
    expect(isArbiterOnly(arbiterHere)).toBe(false);
    expect(isArbiterOnly(owner)).toBe(false);
    expect(isArbiterOnly(player)).toBe(false);
  });

  it('needs a player profile for both sides, because account_role is both for every org creator', () => {
    expect(hasBothSides(both)).toBe(true);
    expect(hasBothSides(owner)).toBe(false);
    expect(hasBothSides(player)).toBe(false);
  });
});

describe('landing', () => {
  it('opens players on their page and organizers on the desk', () => {
    expect(landing(player)).toBe('/player');
    expect(landing(newPlayer)).toBe('/player');
    expect(landing(owner)).toBe('/app');
    expect(landing(roleOnly)).toBe('/app');
  });

  it('sends an arbiter-only member to Floor duty on /team', () => {
    expect(landing(arbiter)).toBe('/team');
    expect(landing(arbiterHere)).toBe('/app');
  });

  it('remembers the last choice of someone with both sides, and no one else', () => {
    expect(landing(both)).toBe('/app');
    expect(landing(both, { preferredView: 'organizer' })).toBe('/app');
    expect(landing(both, { preferredView: 'player' })).toBe('/player');
    expect(landing(owner, { preferredView: 'player' })).toBe('/app');
  });

  it('keeps an organizer signup that is still waiting to create its organization on the desk', () => {
    expect(landing(newPlayer, { pendingOrganizer: true })).toBe('/app');
  });

  it('opens the desk when nothing is known, since it works offline', () => {
    expect(landing(null)).toBe('/app');
  });

  it('never leaves the desk on desktop', () => {
    const desktop = { desktop: true };
    expect(landing(player, desktop)).toBe('/app');
    expect(landing(both, { ...desktop, preferredView: 'player' })).toBe('/app');
    expect(landing(null, desktop)).toBe('/app');
    expect(landing(arbiter, desktop)).toBe('/team');
  });
});

describe('/app', () => {
  const none = { desktop: false, settingUp: false, pendingOrganizer: false };

  it('sends only a known player to their page', () => {
    expect(deskHomeRedirect(player, none)).toBe('/player');
    expect(deskHomeRedirect(owner, none)).toBeNull();
    expect(deskHomeRedirect(arbiter, none)).toBeNull();
    expect(deskHomeRedirect(null, none)).toBeNull();
  });

  it('stays while starting the organizer setup, on desktop, or finishing an organizer signup', () => {
    expect(deskHomeRedirect(player, { ...none, settingUp: true })).toBeNull();
    expect(deskHomeRedirect(player, { ...none, desktop: true })).toBeNull();
    expect(deskHomeRedirect(player, { ...none, pendingOrganizer: true })).toBeNull();
  });
});

describe('current area', () => {
  const web2 = { desktop: false, preferredView: null };

  it('follows the URL for someone with both sides', () => {
    expect(currentArea('/player', both, web2)).toBe('player');
    expect(currentArea('/app', both, { ...web2, preferredView: 'player' })).toBe('organizer');
    expect(currentArea('/tournaments/1', both, web2)).toBe('organizer');
  });

  it('keeps Account and Settings in the area they chose', () => {
    expect(currentArea('/account', both, { ...web2, preferredView: 'player' })).toBe('player');
    expect(currentArea('/settings', both, { ...web2, preferredView: 'organizer' })).toBe('organizer');
    expect(currentArea('/account', both, web2)).toBe('organizer');
  });

  it('never shows a player the organizer navigation', () => {
    for (const path of ['/account', '/settings', '/app', '/tournaments/new']) {
      expect(currentArea(path, player, web2)).toBe('player');
    }
  });

  it('is always the desk on desktop', () => {
    expect(currentArea('/player', both, { desktop: true, preferredView: 'player' })).toBe('organizer');
    expect(currentArea('/account', player, { desktop: true, preferredView: null })).toBe('organizer');
  });

  it('points the brand mark at the right home', () => {
    expect(areaHome('player', both)).toBe('/player');
    expect(areaHome('organizer', both)).toBe('/app');
    expect(areaHome('organizer', arbiter)).toBe('/team');
    expect(areaHome('organizer', null)).toBe('/app');
  });
});

describe('account menu links', () => {
  const inMenu = (facts: WorkspaceFacts | null, place: 'player' | 'organizer' | 'public', desktop = false) =>
    workspaceLinks(facts, { desktop, place }).map((link) => link.label);

  it('shows the switch only to someone with both sides', () => {
    expect(inMenu(both, 'organizer')).toEqual(['Switch to player view']);
    expect(inMenu(both, 'player')).toEqual(['Switch to organizer view']);
    for (const facts of [player, newPlayer, owner, roleOnly, arbiter, arbiterHere, null]) {
      for (const place of ['player', 'organizer', 'public'] as const) {
        expect(inMenu(facts, place).filter((label) => label.startsWith('Switch'))).toEqual([]);
      }
    }
  });

  it('marks the switch as a choice to remember', () => {
    expect(workspaceLinks(both, { desktop: false, place: 'organizer' })[0]).toMatchObject({ to: '/player', remember: 'player' });
    expect(workspaceLinks(both, { desktop: false, place: 'player' })[0]).toMatchObject({ to: '/app', remember: 'organizer' });
  });

  it('offers a player the organizer setup', () => {
    expect(inMenu(player, 'player')).toEqual(['Run a tournament']);
    expect(workspaceLinks(player, { desktop: false, place: 'player' })[0]!.to).toBe('/app?setup=organization');
  });

  it('gives public pages plain links to where the person belongs', () => {
    expect(inMenu(player, 'public')).toEqual(['My player page', 'Run a tournament']);
    expect(inMenu(owner, 'public')).toEqual(['My desk']);
    expect(inMenu(both, 'public')).toEqual(['My desk', 'My player page']);
    expect(inMenu(arbiter, 'public')).toEqual(['Floor duty']);
  });

  it('gives an organizer who opened /player by URL a way back, and nothing extra on the desk', () => {
    expect(inMenu(owner, 'player')).toEqual(['My desk']);
    expect(inMenu(owner, 'organizer')).toEqual([]);
  });

  it('has no player side on desktop', () => {
    for (const facts of [player, owner, both, arbiter, null]) {
      expect(inMenu(facts, 'organizer', true)).toEqual([]);
      expect(inMenu(facts, 'player', true)).toEqual([]);
      expect(inMenu(facts, 'public', true).join()).not.toMatch(/player/i);
    }
  });
});
