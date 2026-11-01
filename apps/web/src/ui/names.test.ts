import { describe, expect, it } from 'vitest';
import { displayName, findLookalikes, formatDisambiguator, nameParts, stretchToFit } from './names';

describe('nameParts: Malaysian patronyms', () => {
  it.each([
    ['PUTERI ALEKHINE DAMIA BINTI QUEEN GAMBIT', 'Puteri Alekhine Damia', 'binti Queen Gambit'],
    ['MUHAMMAD CARO KANN BIN SICILIAN NAJDORF', 'Muhammad Caro Kann', 'bin Sicilian Najdorf'],
    ['ARJUN PIRC A/L GRUNFELD SUBRAMANIAM', 'Arjun Pirc', 'a/l Grunfeld Subramaniam'],
    ['KAVITHA ZUGZWANG A/P FIANCHETTO RAJARATNAM', 'Kavitha Zugzwang', 'a/p Fianchetto Rajaratnam'],
    ['kavitha zugzwang a/p fianchetto', 'Kavitha Zugzwang', 'a/p Fianchetto'],
  ])('%s', (raw, given, rest) => {
    const parts = nameParts(raw);
    expect(parts.given).toBe(given);
    expect(parts.rest).toBe(rest);
    expect(parts.display).toBe(`${given} ${rest}`);
  });

  it('lowers the marker even when the rest was typed in mixed case', () => {
    expect(nameParts('Siti Bishopah BINTI En Passant').display).toBe('Siti Bishopah binti En Passant');
    expect(nameParts('Vikram Tempo A/L Krishnan').rest).toBe('a/l Krishnan');
    expect(nameParts('Harish Catalan A/P Tartakower').rest).toBe('a/p Tartakower');
  });

  it('accepts the common written variants', () => {
    expect(nameParts('NUR SICILIA BT MOHD ENDGAME').rest).toBe('bt Mohd Endgame');
    expect(nameParts('NUR SICILIA BTE. MOHD').rest).toBe('bte Mohd');
    expect(nameParts('VIKRAM TEMPO S/O KRISHNAN').rest).toBe('s/o Krishnan');
    expect(nameParts('THIVYA DRAGON D/O LEVENFISH').rest).toBe('d/o Levenfish');
  });

  it('splits at the first marker and lowers later ones', () => {
    const parts = nameParts('AHMAD BIN ALI BIN ABU');
    expect(parts.given).toBe('Ahmad');
    expect(parts.rest).toBe('bin Ali bin Abu');
  });

  it('needs a name on both sides of a marker', () => {
    expect(nameParts('BIN ROOK').rest).toBeNull();
    expect(nameParts('BIN ROOK').display).toBe('Bin Rook');
    expect(nameParts('AHMAD BIN').rest).toBeNull();
    expect(nameParts('Ahmad Bin').display).toBe('Ahmad Bin');
  });

  it('treats Bin as a given name in a three-word Chinese name', () => {
    expect(nameParts('TAN BIN HAO')).toMatchObject({ display: 'Tan Bin Hao', rest: null });
    expect(nameParts('Lim Bin Wei').display).toBe('Lim Bin Wei');
    // A longer name is a patronym even with a surname from that list.
    expect(nameParts('TAN BIN AHMAD ROOK').rest).toBe('bin Ahmad Rook');
    expect(nameParts('AIMAN BIN HAO').rest).toBe('bin Hao');
  });

  it('does not treat words that merely contain a marker as a marker', () => {
    expect(nameParts('Sabina Binti-Rook').rest).toBeNull();
    expect(nameParts('ROBIN BINTANG').rest).toBeNull();
  });
});

describe('displayName: casing', () => {
  it('Title Cases one-case input', () => {
    expect(displayName('TAN ZWISCHEN ZUG')).toBe('Tan Zwischen Zug');
    expect(displayName('lim gambit ling')).toBe('Lim Gambit Ling');
  });

  it('keeps mixed-case input as typed', () => {
    expect(displayName('Tan McGambit deRook')).toBe('Tan McGambit deRook');
    expect(displayName('LEE Skewer')).toBe('LEE Skewer');
  });

  it('handles hyphens, dots and apostrophes', () => {
    expect(displayName('SITI-AISHAH ROOK')).toBe('Siti-Aishah Rook');
    expect(displayName("O'NEIL D'SOUZA")).toBe("O'Neil D'Souza");
    expect(displayName("MA'RUF SA'ADAH")).toBe("Ma'ruf Sa'adah");
    expect(displayName('S.KUMAR ROOK')).toBe('S.Kumar Rook');
  });

  it('keeps generational numerals capitalised', () => {
    expect(displayName('ROOK LIFT III')).toBe('Rook Lift III');
  });

  it('collapses stray spaces', () => {
    expect(displayName('  tan   zwischen  zug ')).toBe('Tan Zwischen Zug');
  });

  it('leaves scripts without case alone', () => {
    expect(displayName('陈车豪')).toBe('陈车豪');
    expect(displayName('கவிதா ரூக்')).toBe('கவிதா ரூக்');
  });

  it('handles an empty name', () => {
    expect(nameParts('   ')).toMatchObject({ display: '', given: '', rest: null });
  });

  it('never changes the stored original', () => {
    const raw = '  PUTERI  DAMIA BINTI QUEEN ';
    expect(nameParts(raw).original).toBe(raw);
  });
});

describe('formatDisambiguator', () => {
  it('uses # number and section', () => {
    expect(formatDisambiguator({ no: 12, section: 'U12' })).toBe('#12 · U12');
    expect(formatDisambiguator({ no: 12 })).toBe('#12');
    expect(formatDisambiguator({ section: 'U12' })).toBe('U12');
    expect(formatDisambiguator({})).toBe('');
  });
});

describe('findLookalikes', () => {
  it('flags the two children who differ only at the end', () => {
    const found = findLookalikes([
      { id: 'a', name: 'PUTERI ALEKHINE DAMIA BINTI QUEEN GAMBIT' },
      { id: 'b', name: 'Puteri Alekhine Damia binti Queen Indian' },
      { id: 'c', name: 'Tan Zwischen Zug' },
    ]);
    expect([...found].sort()).toEqual(['a', 'b']);
  });

  it('flags identical names regardless of case or stray spaces', () => {
    const found = findLookalikes([
      { id: 'a', name: 'tan  wei' },
      { id: 'b', name: 'TAN WEI' },
    ]);
    expect(found.size).toBe(2);
  });

  it('leaves names with a short shared start alone', () => {
    const found = findLookalikes([
      { id: 'a', name: 'Muhammad Caro Kann' },
      { id: 'b', name: 'Muhammad Pawn Storm' },
      { id: 'c', name: 'Lim Gambit Ling' },
      { id: 'd', name: 'Lee Skewer Xuan' },
    ]);
    expect(found.size).toBe(0);
  });
});

describe('stretchToFit', () => {
  it('stays at 100% when it fits', () => {
    expect(stretchToFit(300, 300)).toBe(100);
  });

  it('narrows along the measured curve', () => {
    expect(stretchToFit(1863, 1475)).toBe(75);
    expect(stretchToFit(1863, 1275)).toBe(62);
    const mid = stretchToFit(1000, 900)!;
    expect(mid).toBeGreaterThan(75);
    expect(mid).toBeLessThan(100);
  });

  it('gives up below the narrowest width, so the caller wraps instead', () => {
    expect(stretchToFit(1863, 1200)).toBeNull();
    expect(stretchToFit(100, 0)).toBeNull();
  });
});
