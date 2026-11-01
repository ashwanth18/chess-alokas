import { describe, expect, it } from 'vitest';
import { describeAsOf, describeSync, formatClock, type SyncFacts } from './sync';

const AS_OF = '2026-07-14T06:32:00.000Z';
const base: SyncFacts = { device: 'laptop', connected: true, pending: 0, rejected: 0, cloudAsOf: AS_OF };
const line = (facts: Partial<SyncFacts>, key: 'where' | 'cloud' | 'audience') =>
  describeSync({ ...base, ...facts }).find((l) => l.key === key);

describe('describeSync', () => {
  it('always says first that the work is safe on this machine, even offline', () => {
    for (const facts of [{}, { connected: false }, { rejected: 2, pending: 2 }]) {
      const first = describeSync({ ...base, ...facts })[0]!;
      expect(first.key).toBe('where');
      expect(first.text).toBe('Everything saved on this laptop');
      expect(first.marker).toBe('solid');
    }
    expect(line({ device: 'phone' }, 'where')?.text).toBe('Everything saved on this phone');
  });

  it('claims the cloud has everything only when it does', () => {
    const cloud = line({}, 'cloud')!;
    expect(cloud.text).toContain('Cloud has everything, as of');
    expect(cloud.text).toContain(formatClock(AS_OF));
    expect(cloud).toMatchObject({ tone: 'go', marker: 'solid' });
  });

  it('never says Online or Synced in any state', () => {
    const states: Array<Partial<SyncFacts>> = [
      {},
      { connected: null },
      { connected: false },
      { connected: false, pending: 3 },
      { syncing: true },
      { failed: true, pending: 2 },
      { pending: 4 },
      { pending: 4, rejected: 4 },
      { cloudAsOf: null },
    ];
    for (const facts of states) {
      for (const l of describeSync({ ...base, ...facts, showAudience: true })) {
        expect(l.text).not.toMatch(/\bonline\b|\bsynced\b/i);
      }
    }
  });

  it('reports rejections as needing a person, over any good news', () => {
    const cloud = line({ pending: 4, rejected: 4 }, 'cloud')!;
    expect(cloud.text).toBe('4 changes refused by the cloud. Needs you.');
    expect(cloud).toMatchObject({ tone: 'flag', marker: 'hollow' });
    expect(cloud.text).not.toContain('Cloud has everything');
    expect(line({ pending: 1, rejected: 1 }, 'cloud')!.text).toBe('1 change refused by the cloud. Needs you.');
  });

  it('shows offline as amber and hollow, never red', () => {
    const cloud = line({ connected: false, pending: 3 }, 'cloud')!;
    expect(cloud.text).toBe('No connection. 3 changes will go to the cloud when it returns.');
    expect(cloud).toMatchObject({ tone: 'wait', marker: 'hollow' });
    expect(line({ connected: false }, 'cloud')!.tone).toBe('wait');
    expect(line({ connected: false }, 'cloud')!.text).toContain('Cloud had everything as of');
  });

  it('counts waiting changes without the refused ones', () => {
    expect(line({ connected: false, pending: 5, rejected: 2 }, 'cloud')!.tone).toBe('flag');
    expect(line({ pending: 1 }, 'cloud')!.text).toBe('1 change waiting to go to the cloud.');
  });

  it('does not claim delivery while sending or after a failure', () => {
    expect(line({ syncing: true }, 'cloud')).toMatchObject({ tone: 'wait', marker: 'hollow' });
    expect(line({ failed: true }, 'cloud')!.text).toContain('Could not reach the cloud');
    expect(line({ failed: true, pending: 2 }, 'cloud')!.text).toContain('2 changes will try again');
  });

  it('is honest about never having synced', () => {
    expect(line({ cloudAsOf: null }, 'cloud')).toMatchObject({ text: 'Not sent to the cloud yet.', marker: 'hollow' });
  });

  it('says who is affected only when someone is behind', () => {
    expect(line({ showAudience: true }, 'audience')).toBeUndefined();
    const offline = line({ showAudience: true, connected: false }, 'audience')!;
    expect(offline.text).toContain('Floor phones keep their own results');
    expect(offline.text).toContain(`stays at ${formatClock(AS_OF)}`);
    expect(line({ connected: false }, 'audience')).toBeUndefined();
    expect(line({ showAudience: true, connected: false, cloudAsOf: null }, 'audience')!.text).toContain("doesn't have this yet");
  });
});

describe('describeAsOf', () => {
  it('always gives the time', () => {
    expect(describeAsOf(AS_OF, true)).toBe(`As of ${formatClock(AS_OF)}`);
    expect(describeAsOf(AS_OF, false)).toBe(`No connection. Showing the list as of ${formatClock(AS_OF)}.`);
    expect(describeAsOf(null, false)).toBe('No connection.');
  });
});
