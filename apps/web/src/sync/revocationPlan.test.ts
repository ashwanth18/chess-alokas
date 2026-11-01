import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deviceRevokedIds,
  idsNotYetCleaned,
  markCleaned,
  mergeNotice,
  noticeMessages,
  planRevocation,
  readRevokedIds,
  recordRevokedList,
  stripTournaments,
} from './revocationPlan';

const ME = 'user-1';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const response = (extra: Record<string, unknown> = {}) => ({
  tournaments: [],
  categories: [],
  participants: [],
  games: [],
  serverTime: '2026-11-01T00:00:00.000Z',
  revokedTournamentIds: [A],
  revokedForUserId: ME,
  ...extra,
});

describe('readRevokedIds gives authority to delete only when', () => {
  it('the response is complete, for this user, with a list of ids', () => {
    expect(readRevokedIds(response(), ME, ME)).toEqual([A]);
    expect(readRevokedIds(response({ revokedTournamentIds: [A, A, B] }), ME, ME)).toEqual([A, B]);
    expect(readRevokedIds(response({ revokedTournamentIds: [] }), ME, ME)).toEqual([]);
  });

  it('not from an older server', () => {
    const old = response();
    delete (old as Record<string, unknown>)['revokedTournamentIds'];
    delete (old as Record<string, unknown>)['revokedForUserId'];
    expect(readRevokedIds(old, ME, ME)).toBeNull();
    expect(readRevokedIds(response({ revokedForUserId: undefined }), ME, ME)).toBeNull();
  });

  it('not from a partial response', () => {
    for (const key of ['tournaments', 'categories', 'participants', 'games', 'serverTime']) {
      expect(readRevokedIds(response({ [key]: undefined }), ME, ME), key).toBeNull();
    }
    expect(readRevokedIds(null, ME, ME)).toBeNull();
    expect(readRevokedIds(undefined, ME, ME)).toBeNull();
  });

  it('not when it was meant for someone else, or the account changed mid-sync', () => {
    expect(readRevokedIds(response({ revokedForUserId: 'user-2' }), ME, ME)).toBeNull();
    expect(readRevokedIds(response(), ME, 'user-2')).toBeNull();
    expect(readRevokedIds(response(), ME, null)).toBeNull();
    expect(readRevokedIds(response({ revokedForUserId: null }), null, null)).toBeNull();
  });

  it('not when any entry is malformed', () => {
    expect(readRevokedIds(response({ revokedTournamentIds: A }), ME, ME)).toBeNull();
    expect(readRevokedIds(response({ revokedTournamentIds: [A, '*'] }), ME, ME)).toBeNull();
    expect(readRevokedIds(response({ revokedTournamentIds: [A, 7] }), ME, ME)).toBeNull();
  });
});

describe('planRevocation', () => {
  const base = {
    revokedIds: [A],
    heldIds: new Set([A, B]),
    deliveredIds: new Set<string>(),
    pendingChanges: new Map<string, number>(),
    otherAccountsOnDevice: false,
  };

  it('removes only what the server listed', () => {
    expect(planRevocation(base)).toEqual({ remove: [A], heldBack: [] });
    expect(planRevocation({ ...base, revokedIds: [] }).remove).toEqual([]);
  });

  it('ignores a listed tournament this device does not hold', () => {
    expect(planRevocation({ ...base, heldIds: new Set([B]) }).remove).toEqual([]);
  });

  it('keeps a tournament the same response delivered', () => {
    expect(planRevocation({ ...base, deliveredIds: new Set([A]) }).remove).toEqual([]);
  });

  it('removes one with pending changes when no other account uses the device', () => {
    const pendingChanges = new Map([[A, 3]]);
    expect(planRevocation({ ...base, pendingChanges }).remove).toEqual([A]);
  });

  it('holds back pending changes that could be another account’s', () => {
    const pendingChanges = new Map([[A, 3]]);
    expect(planRevocation({ ...base, pendingChanges, otherAccountsOnDevice: true })).toEqual({
      remove: [],
      heldBack: [A],
    });
    expect(planRevocation({ ...base, otherAccountsOnDevice: true }).remove).toEqual([A]);
  });
});

describe('stripTournaments', () => {
  const tables = {
    tournaments: [{ id: A }, { id: B }],
    categories: [{ id: 'c', tournamentId: A }, { id: 'd', tournamentId: B }],
    certificateTemplates: [{ id: 't', tournamentId: null }],
    meta: [{ key: 'clientId', value: A }],
  };

  it('removes the tournament and related rows, and counts it', () => {
    const out = stripTournaments(tables, new Set([A]));
    expect(out.removedTournaments).toBe(1);
    expect(out.tables['tournaments']).toEqual([{ id: B }]);
    expect(out.tables['categories']).toEqual([{ id: 'd', tournamentId: B }]);
    expect(out.tables['certificateTemplates']).toEqual([{ id: 't', tournamentId: null }]);
    expect(out.tables['meta']).toEqual([{ key: 'clientId', value: A }]);
  });

  it('changes nothing with no ids', () => {
    expect(stripTournaments(tables, new Set())).toEqual({ tables, removedTournaments: 0 });
  });
});

describe('notice', () => {
  it('names the tournaments and counts dropped changes', () => {
    const messages = noticeMessages({
      tournaments: ['Spring Open', 'Club Cup', 'Junior Rapid'],
      droppedChanges: 1,
      heldBack: [],
      backupsNotCleaned: 0,
    });
    expect(messages[0]).toBe(
      'You no longer have access to Spring Open, Club Cup and Junior Rapid, so they were removed from this device.',
    );
    expect(messages[1]).toBe('1 unsaved change was discarded and not saved online.');
    expect(messages).toHaveLength(2);
  });

  it('merges with one not yet dismissed', () => {
    const merged = mergeNotice(
      { tournaments: ['A'], droppedChanges: 1, heldBack: ['B'], backupsNotCleaned: 0 },
      { tournaments: ['B'], droppedChanges: 2, heldBack: [], backupsNotCleaned: 0 },
    );
    expect(merged).toEqual({
      tournaments: ['A', 'B'],
      droppedChanges: 3,
      heldBack: [],
      backupsNotCleaned: 0,
    });
  });
});

describe('device memory', () => {
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
    key: (i: number) => [...stored.keys()][i] ?? null,
    get length() {
      return stored.size;
    },
  });
  beforeEach(() => stored.clear());

  it('blocks a restore for any account’s list, and lifts when access returns', () => {
    recordRevokedList('u1', [A]);
    recordRevokedList('u2', [B]);
    expect(deviceRevokedIds()).toEqual(new Set([A, B]));
    recordRevokedList('u1', []);
    expect(deviceRevokedIds()).toEqual(new Set([B]));
  });

  it('cleans snapshots again after access comes back and goes again', () => {
    recordRevokedList('u1', [A]);
    markCleaned('u1', [A]);
    expect(idsNotYetCleaned('u1', [A])).toEqual([]);
    recordRevokedList('u1', []);
    recordRevokedList('u1', [A]);
    expect(idsNotYetCleaned('u1', [A])).toEqual([A]);
  });
});
