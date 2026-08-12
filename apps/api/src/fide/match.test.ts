import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchOnePlayer } from './match.js';
import * as lichess from './lichess.js';
import type { FidePlayerRow } from './types.js';

function player(partial: Partial<FidePlayerRow> & Pick<FidePlayerRow, 'fideId' | 'name'>): FidePlayerRow {
  return {
    federation: 'MAS',
    birthYear: null,
    title: null,
    sex: null,
    standard: null,
    rapid: null,
    blitz: null,
    inactive: false,
    ...partial,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('matchOnePlayer via Lichess', () => {
  it('exact match by FIDE ID', async () => {
    vi.spyOn(lichess, 'lichessGetById').mockResolvedValue(
      player({
        fideId: 35825898,
        name: 'Vijayan, Logitan',
        birthYear: 2014,
        standard: 1802,
        rapid: 1718,
        blitz: 1712,
      }),
    );
    const res = await matchOnePlayer({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'LOGITAN A/L VIJAYAN',
      fideId: 35825898,
    });
    expect(res.status).toBe('exact');
    expect(res.selectedFideId).toBe(35825898);
  });

  it('uniquely matches Logitan, not Kavinayaa', async () => {
    vi.spyOn(lichess, 'lichessGetById').mockResolvedValue(null);
    vi.spyOn(lichess, 'lichessSearch').mockImplementation(async (q) => {
      const all = [
        player({ fideId: 35889489, name: 'Vijayan, Kavinayaa', birthYear: 2015 }),
        player({
          fideId: 35825898,
          name: 'Vijayan, Logitan',
          birthYear: 2014,
          standard: 1802,
        }),
      ];
      const needle = q.toLowerCase();
      return all.filter(
        (p) =>
          p.name.toLowerCase().includes(needle.replace(',', '').split(/\s+/).join(' ')) ||
          needle.includes('logitan') ||
          needle.includes('vijayan'),
      );
    });

    const res = await matchOnePlayer({
      id: '00000000-0000-4000-8000-000000000002',
      name: 'LOGITAN A/L VIJAYAN',
      country: 'Malaysia',
    });
    expect(res.status).toBe('unique');
    expect(res.selectedFideId).toBe(35825898);
  });

  it('does not auto-unique on surname-only Tarmizi hit', async () => {
    vi.spyOn(lichess, 'lichessGetById').mockResolvedValue(null);
    vi.spyOn(lichess, 'lichessSearch').mockResolvedValue([
      player({
        fideId: 5701234,
        name: 'Mohd Tarmizi, Muhd Hafiy Safwan',
        inactive: true,
        standard: 1723,
      }),
    ]);

    const res = await matchOnePlayer({
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Azrid Mifzal Adrian bin Tarmizi',
      country: 'MAS',
    });
    expect(res.status).not.toBe('unique');
    expect(res.selectedFideId).toBeNull();
  });

  it('does not unique-match Vijay Balakrishnan to Vijay Veeshwaa', async () => {
    vi.spyOn(lichess, 'lichessGetById').mockResolvedValue(null);
    vi.spyOn(lichess, 'lichessSearch').mockResolvedValue([
      player({ fideId: 1, name: 'Vijay, Veeshwaa' }),
    ]);

    const res = await matchOnePlayer({
      id: '00000000-0000-4000-8000-000000000004',
      name: 'VIJAY A/L BALAKRISHNAN',
      country: 'MAS',
    });
    expect(res.status).not.toBe('unique');
  });
});
