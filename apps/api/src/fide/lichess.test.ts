import { describe, expect, it } from 'vitest';
import { mapLichessPlayer } from './lichess.js';

describe('mapLichessPlayer', () => {
  it('maps ratings and treats 0 as null', () => {
    const row = mapLichessPlayer({
      id: 35825898,
      name: 'Vijayan, Logitan',
      federation: 'mas',
      year: 2014,
      title: null,
      standard: 1802,
      rapid: 0,
      blitz: 1712,
    });
    expect(row).toMatchObject({
      fideId: 35825898,
      name: 'Vijayan, Logitan',
      federation: 'MAS',
      birthYear: 2014,
      standard: 1802,
      rapid: null,
      blitz: 1712,
      inactive: false,
    });
  });
});
