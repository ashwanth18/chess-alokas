import { describe, expect, it } from 'vitest';
import { isExcludedFromRound, withAbsentThisRound } from '@chess-alokas/shared';
import type { LocalParticipant } from '../db/local';
import { bulkAbsentConfirmMessage, checkInPatch } from './rollCall';
import { conflictMessage, flushBanner, summarizeFlush, type QueuedFloorResult } from './floorQueue';
import { findLikelyDuplicates, needsPaymentConfirmation } from './registrationReview';
import { draftFromPlayer, roundBlockingDelete, validatePlayerDraft } from './playerEditing';
import { classifyRequest } from './swRouting';
import { getNextPairingRound } from './tournamentProgress';
import { isNumericAgeColumn } from './importParse';

function player(extra: Partial<LocalParticipant> = {}): LocalParticipant {
  return {
    id: 'p1',
    tournamentId: 't',
    name: 'A',
    age: 10,
    customFields: {},
    categoryIds: [],
    updatedAt: '',
    dirty: 0,
    ...extra,
  };
}

describe('roll call', () => {
  const absent = () => ({ ...player(), ...withAbsentThisRound(player(), 1) }) as LocalParticipant;

  it('check-in clears a Round 1 absence before pairing', () => {
    const patch = checkInPatch(absent(), true, false);
    expect(patch.customFields.checkedIn).toBe(true);
    expect(isExcludedFromRound({ ...absent(), ...patch }, 1)).toBe(false);
  });
  it('leaves absences alone once Round 1 is paired', () => {
    expect(checkInPatch(absent(), true, true).excludedRounds).toBeUndefined();
  });
  it('clearing check-in does not touch availability', () => {
    expect(checkInPatch(absent(), false, false).excludedRounds).toBeUndefined();
  });
  it('warns louder when the whole field would go absent', () => {
    expect(bulkAbsentConfirmMessage(30, 30)).toMatch(/WHOLE field/);
    expect(bulkAbsentConfirmMessage(5, 30)).not.toMatch(/WHOLE field/);
  });
});

describe('next pairing round', () => {
  it('stays on Round 1 when everyone in every category is absent', () => {
    const ps = [1, 2].map((n) =>
      player({ id: `p${n}`, categoryIds: ['c1'], excludedRounds: [1] }),
    );
    expect(getNextPairingRound(5, [{ id: 'c1' }], ps, [], false)).toBe(1);
  });
  it('still skips a later round where a whole category sat out', () => {
    const ps = [1, 2].map((n) =>
      player({ id: `p${n}`, categoryIds: ['c1'], withdrawnFromRound: 2 }),
    );
    const games = [{ round: 1, categoryId: 'c1', deletedAt: null }] as never[];
    expect(getNextPairingRound(3, [{ id: 'c1' }], ps, games, false)).toBeNull();
  });
});

describe('floor queue accounting', () => {
  const item = (tableNumber: number): QueuedFloorResult => ({
    slug: `s${tableNumber}`,
    token: 't',
    result: '0-1',
    tableNumber,
    queuedAt: '',
  });

  it('separates accepted, offline and rejected', () => {
    const s = summarizeFlush([
      { item: item(1), attempt: { ok: true } },
      { item: item(2), attempt: { ok: false, error: 'Failed to fetch' } },
      { item: item(3), attempt: { ok: false, error: 'Result already locked for this table' } },
    ]);
    expect(s.submitted).toBe(1);
    expect(s.remaining.map((r) => r.tableNumber)).toEqual([2]);
    expect(s.rejected.map((r) => r.item.tableNumber)).toEqual([3]);
    expect(flushBanner(s)).toBe(
      'Synced 1 queued result. 1 not accepted — see the table below. 1 still waiting for connection.',
    );
  });
  it('never reports a rejection as synced', () => {
    const s = summarizeFlush([{ item: item(3), attempt: { ok: false, error: 'locked' } }]);
    expect(flushBanner(s)).not.toMatch(/Synced/);
  });
  it('says what the server holds', () => {
    const base = { slug: 's', tableNumber: 3, result: '0-1', reason: 'locked', rejectedAt: '' };
    expect(conflictMessage({ ...base, serverResult: '1-0' })).toMatch(/NOT saved.*holds 1-0/);
    expect(conflictMessage({ ...base, serverResult: '0-1' })).toMatch(/already recorded/);
    expect(conflictMessage({ ...base, serverResult: null })).toMatch(/NOT saved — locked/);
  });
});

describe('registration review', () => {
  const reg = (id: string, name: string, extra = {}) => ({
    id,
    status: 'pending',
    playerSnapshot: { name },
    ...extra,
  });
  it('asks for confirmation only on paid entries without a receipt', () => {
    expect(needsPaymentConfirmation({ hasReceipt: false, paymentStatus: 'pending_receipt' }, 3000)).toBe(true);
    expect(needsPaymentConfirmation({ hasReceipt: true, paymentStatus: 'submitted' }, 3000)).toBe(false);
    expect(needsPaymentConfirmation({ hasReceipt: false, paymentStatus: 'not_required' }, 0)).toBe(false);
  });
  it('flags repeat submissions and roster clashes, ignoring case and rejected rows', () => {
    const flags = findLikelyDuplicates(
      [
        reg('a', 'Guest Kid'),
        reg('b', 'guest  kid'),
        reg('c', 'On Roster'),
        reg('d', 'Solo'),
        reg('e', 'Solo', { status: 'rejected' }),
      ],
      [{ name: 'ON ROSTER' }],
    );
    expect(flags.get('a')).toMatch(/more than once/);
    expect(flags.get('b')).toMatch(/more than once/);
    expect(flags.get('c')).toMatch(/roster/);
    expect(flags.has('d')).toBe(false);
  });
  it('treats different birth years as different children', () => {
    const flags = findLikelyDuplicates(
      [
        reg('a', 'Sam', { playerSnapshot: { name: 'Sam', yearOfBirth: 2012 } }),
        reg('b', 'Sam', { playerSnapshot: { name: 'Sam', yearOfBirth: 2015 } }),
      ],
      [],
    );
    expect(flags.size).toBe(0);
  });
});

describe('player editing', () => {
  it('blocks deleting anyone on a board, reporting the earliest round', () => {
    const games = [
      { round: 2, whiteId: 'p1', blackId: 'x', deletedAt: null },
      { round: 1, whiteId: 'x', blackId: 'p1', deletedAt: null },
      { round: 1, whiteId: 'gone', blackId: 'y', deletedAt: 'yes' },
    ];
    expect(roundBlockingDelete('p1', games)).toBe(1);
    expect(roundBlockingDelete('gone', games)).toBeNull();
  });
  it('validates the form', () => {
    const d = draftFromPlayer();
    expect(validatePlayerDraft(d)).toMatch(/name/);
    expect(validatePlayerDraft({ ...d, name: 'A', yearOfBirth: '1800' })).toMatch(/1920/);
    expect(validatePlayerDraft({ ...d, name: 'A', email: 'bad' })).toMatch(/email/);
    expect(validatePlayerDraft({ ...d, name: 'A', yearOfBirth: '2014' })).toBeNull();
  });
});

describe('service worker routing', () => {
  const base = { origin: 'https://app.test', method: 'GET', mode: 'cors' };
  const route = (url: string, extra = {}) => classifyRequest({ ...base, url, ...extra });
  it('never touches the API, other origins, writes or authenticated requests', () => {
    expect(route('https://app.test/api/sync/pull')).toBe('passthrough');
    expect(route('https://app.test/api/x', { mode: 'navigate' })).toBe('passthrough');
    expect(route('https://x.supabase.co/auth/v1/user')).toBe('passthrough');
    expect(route('https://app.test/assets/a.js', { method: 'POST' })).toBe('passthrough');
    expect(route('https://app.test/assets/a.js', { hasAuthHeader: true })).toBe('passthrough');
  });
  it('serves navigations and hashed assets', () => {
    expect(route('https://app.test/t/abc', { mode: 'navigate' })).toBe('navigate');
    expect(route('https://app.test/assets/a-123.js')).toBe('asset');
    expect(route('https://app.test/favicon.svg')).toBe('passthrough');
  });
});

describe('import column detection', () => {
  it('does not treat an upload column as age', () => {
    expect(isNumericAgeColumn('AGE PROOF (UPLOAD NRIC OR BIRTH CERTIFICATE)')).toBe(false);
    expect(isNumericAgeColumn('Age')).toBe(true);
    expect(isNumericAgeColumn('AGE CATEGORY/ KATEGORI UMUR')).toBe(false);
  });
});
