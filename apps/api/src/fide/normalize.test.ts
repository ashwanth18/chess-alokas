import { describe, expect, it } from 'vitest';
import { nameSearchVariants, stripPatronomic, toFederationCode } from './normalize.js';
import { decideMatchStatus } from './match.js';
import { parseFideXmlPlayers } from './importList.js';
import type { FidePlayerRow } from './types.js';

describe('stripPatronomic / nameSearchVariants', () => {
  it('strips Malaysian A/L and builds Last, First', () => {
    expect(stripPatronomic('Logitan A/L Vijayan')).toBe('Logitan Vijayan');
    const variants = nameSearchVariants('Logitan A/L Vijayan');
    expect(variants).toContain('Vijayan, Logitan');
    expect(variants.some((v) => v.includes('Logitan'))).toBe(true);
    expect(variants.every((v) => !/A\/L/i.test(v))).toBe(true);
  });

  it('keeps FIDE Last, First form', () => {
    const variants = nameSearchVariants('Vijayan, Logitan');
    expect(variants[0]).toBe('Vijayan, Logitan');
    expect(variants).toContain('Logitan');
  });
});

describe('toFederationCode', () => {
  it('maps Malaysia to MAS and passes through codes', () => {
    expect(toFederationCode('Malaysia')).toBe('MAS');
    expect(toFederationCode('mas')).toBe('MAS');
    expect(toFederationCode('SGP')).toBe('SGP');
    expect(toFederationCode('Singapore')).toBe('SGP');
    expect(toFederationCode(null)).toBeNull();
  });
});

describe('decideMatchStatus', () => {
  const row = (id: number): FidePlayerRow => ({
    fideId: id,
    name: 'Vijayan, Logitan',
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
    expect(decideMatchStatus([row(1)], true)).toEqual({
      status: 'exact',
      selectedFideId: 1,
    });
  });

  it('preselects unique name matches and leaves collisions ambiguous', () => {
    expect(decideMatchStatus([row(1)], false).status).toBe('unique');
    expect(decideMatchStatus([row(1), row(2)], false)).toEqual({
      status: 'ambiguous',
      selectedFideId: null,
    });
    expect(decideMatchStatus([], false).status).toBe('not_found');
  });
});

describe('parseFideXmlPlayers', () => {
  it('parses a tiny fixture', async () => {
    const xml = `<?xml version="1.0"?>
<playerslist>
  <player>
    <fideid>35825898</fideid>
    <name>Vijayan, Logitan</name>
    <country>MAS</country>
    <sex>M</sex>
    <title></title>
    <rating>1802</rating>
    <rapid_rating>1718</rapid_rating>
    <blitz_rating>1712</blitz_rating>
    <birthday>2014</birthday>
    <flag></flag>
  </player>
  <player>
    <fideid>100</fideid>
    <name>Inactive, Player</name>
    <country>USA</country>
    <rating></rating>
    <rapid_rating></rapid_rating>
    <blitz_rating></blitz_rating>
    <birthday>1990</birthday>
    <flag>i</flag>
  </player>
</playerslist>`;
    const rows = await parseFideXmlPlayers(xml);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      fideId: 35825898,
      name: 'Vijayan, Logitan',
      federation: 'MAS',
      birthYear: 2014,
      standard: 1802,
      rapid: 1718,
      blitz: 1712,
      inactive: false,
    });
    expect(rows[1]).toMatchObject({
      fideId: 100,
      standard: null,
      inactive: true,
    });
  });
});
