import { describe, expect, it } from 'vitest';
import {
  MIN_CANDIDATE_SCORE,
  UNIQUE_MIN_SCORE,
  nameSearchVariants,
  parseNameParts,
  scoreNameMatch,
  stripPatronomic,
  toFederationCode,
} from './normalize.js';
import { decideMatchStatus } from './match.js';
import type { FidePlayerRow } from './types.js';

describe('stripPatronomic / nameSearchVariants', () => {
  it('strips Malaysian A/L and builds Last, First queries', () => {
    expect(stripPatronomic('Logitan A/L Vijayan')).toBe('Logitan Vijayan');
    const variants = nameSearchVariants('Logitan A/L Vijayan');
    expect(variants).toContain('Vijayan, Logitan');
    expect(variants).toContain('Logitan Vijayan');
    expect(variants.every((v) => !/A\/L/i.test(v))).toBe(true);
    // Must not search bare surname alone as the only structured form
    expect(variants.some((v) => v === 'Vijayan' || v === 'VIJAYAN')).toBe(false);
  });

  it('strips bare AP and Malay bin', () => {
    expect(stripPatronomic('DHARSHINI AP MATHAVAN')).toBe('DHARSHINI MATHAVAN');
    expect(stripPatronomic('Azrid Mifzal Adrian bin Tarmizi')).toBe('Azrid Mifzal Adrian Tarmizi');
    const parts = parseNameParts('Azrid Mifzal Adrian bin Tarmizi');
    expect(parts.given).toBe('Azrid');
    expect(parts.family).toBe('Tarmizi');
  });

  it('rejects surname-only false friends', () => {
    expect(scoreNameMatch('VARSHAN A/L H GANASH', 'Elumalai, Devavarshan')).toBeLessThan(
      MIN_CANDIDATE_SCORE,
    );
    expect(scoreNameMatch('LOGITAN A/L VIJAYAN', 'Vijayan, Kavinayaa')).toBeLessThan(
      UNIQUE_MIN_SCORE,
    );
    expect(scoreNameMatch('LOGITAN A/L VIJAYAN', 'Vijayan, Logitan')).toBeGreaterThanOrEqual(
      UNIQUE_MIN_SCORE,
    );
    expect(scoreNameMatch('VIJAY A/L BALAKRISHNAN', 'Vijay, Veeshwaa')).toBeLessThan(
      UNIQUE_MIN_SCORE,
    );
    expect(scoreNameMatch('DHARSHINI AP MATHAVAN', 'Saravanan, Dharshini')).toBeLessThan(
      UNIQUE_MIN_SCORE,
    );
  });
});

describe('toFederationCode', () => {
  it('maps Malaysia to MAS and passes through codes', () => {
    expect(toFederationCode('Malaysia')).toBe('MAS');
    expect(toFederationCode('mas')).toBe('MAS');
    expect(toFederationCode('SGP')).toBe('SGP');
    expect(toFederationCode(null)).toBeNull();
  });
});

describe('decideMatchStatus', () => {
  const row = (id: number, name: string): FidePlayerRow => ({
    fideId: id,
    name,
    federation: 'MAS',
    birthYear: 2014,
    title: null,
    sex: 'M',
    standard: 1802,
    rapid: 1718,
    blitz: 1712,
    inactive: false,
  });

  it('marks exact ID hits', () => {
    expect(decideMatchStatus([row(1, 'Vijayan, Logitan')], true)).toEqual({
      status: 'exact',
      selectedFideId: 1,
    });
  });

  it('requires dual-token score for unique; surname-only stays ambiguous', () => {
    const logitan = row(35825898, 'Vijayan, Logitan');
    const kavinayaa = row(35889489, 'Vijayan, Kavinayaa');
    const scores = new Map<number, number>([
      [logitan.fideId, scoreNameMatch('LOGITAN A/L VIJAYAN', logitan.name)],
      [kavinayaa.fideId, scoreNameMatch('LOGITAN A/L VIJAYAN', kavinayaa.name)],
    ]);
    const ranked = [logitan, kavinayaa].sort(
      (a, b) => (scores.get(b.fideId) ?? 0) - (scores.get(a.fideId) ?? 0),
    );
    expect(decideMatchStatus(ranked, false, scores)).toEqual({
      status: 'unique',
      selectedFideId: 35825898,
    });

    const onlySurname = [kavinayaa];
    const weak = new Map([[kavinayaa.fideId, scoreNameMatch('LOGITAN A/L VIJAYAN', kavinayaa.name)]]);
    expect(decideMatchStatus(onlySurname, false, weak).status).toBe('ambiguous');
  });

  it('leaves multi-candidate collisions ambiguous without clear gap', () => {
    const a = row(1, 'Balakrishnan, Vijay');
    const b = row(2, 'Balakrishnan, Vijayan');
    const scores = new Map([
      [1, UNIQUE_MIN_SCORE],
      [2, UNIQUE_MIN_SCORE],
    ]);
    expect(decideMatchStatus([a, b], false, scores)).toEqual({
      status: 'ambiguous',
      selectedFideId: null,
    });
  });
});
