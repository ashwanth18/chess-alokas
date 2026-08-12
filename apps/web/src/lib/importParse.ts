/** Helpers for CSV/XLSX registration import (Malaysian youth events, etc.). */

const AGE_CATEGORY_HINT = /categor|kategori|group|bahagian|section/i;
const NRIC_KEY_HINT = /nric|ic\b|mykad|identification/i;

/** True when a column looks like numeric age, not "AGE CATEGORY". */
export function isNumericAgeColumn(columnName: string): boolean {
  const c = columnName.toLowerCase().trim();
  if (AGE_CATEGORY_HINT.test(c)) return false;
  if (c === 'age' || c === 'years' || c === 'yr') return true;
  if (/\bage\b/.test(c) && !AGE_CATEGORY_HINT.test(c)) return true;
  return c === 'years old' || c === 'umur';
}

export function isAgeCategoryColumn(columnName: string): boolean {
  const c = columnName.toLowerCase().trim();
  return AGE_CATEGORY_HINT.test(c) && (/\bage\b/.test(c) || /umur/.test(c) || /categor|kategori/.test(c));
}

/** Normalize common registration gender labels to F/M. */
export function normalizeGender(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim().toUpperCase();
  if (!t) return undefined;
  if (t === 'F' || t === 'P' || t.startsWith('F/') || t.startsWith('P/') || t.startsWith('FEMALE')) {
    return 'F';
  }
  if (t === 'M' || t === 'L' || t.startsWith('M/') || t.startsWith('L/') || t.startsWith('MALE')) {
    return 'M';
  }
  return raw.trim();
}

/** Parse Malaysian NRIC first 6 digits into a Date, or null. */
export function birthDateFromNric(
  nric: string | null | undefined,
  asOf: Date = new Date(),
): Date | null {
  if (!nric) return null;
  const digits = String(nric).replace(/\D/g, '');
  if (digits.length < 6) return null;
  const yy = parseInt(digits.slice(0, 2), 10);
  const mm = parseInt(digits.slice(2, 4), 10);
  const dd = parseInt(digits.slice(4, 6), 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  const yearNow = asOf.getFullYear();
  const century = yy <= yearNow % 100 ? 2000 : 1900;
  const birth = new Date(century + yy, mm - 1, dd);
  if (Number.isNaN(birth.getTime())) return null;
  return birth;
}

/**
 * Malaysian NRIC birth date: first 6 digits YYMMDD.
 * Returns approximate age in whole years, or null if unparsable.
 */
export function ageFromNric(nric: string | null | undefined, asOf: Date = new Date()): number | null {
  const birth = birthDateFromNric(nric, asOf);
  if (!birth) return null;

  const yearNow = asOf.getFullYear();
  let age = yearNow - birth.getFullYear();
  const hadBirthday =
    asOf.getMonth() > birth.getMonth() ||
    (asOf.getMonth() === birth.getMonth() && asOf.getDate() >= birth.getDate());
  if (!hadBirthday) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

export function yearOfBirthFromNric(
  nric: string | null | undefined,
  asOf: Date = new Date(),
): number | null {
  const birth = birthDateFromNric(nric, asOf);
  if (!birth) return null;
  const y = birth.getFullYear();
  if (y < 1900 || y > asOf.getFullYear()) return null;
  return y;
}

export function yearOfBirthFromAge(
  age: number | null | undefined,
  asOf: Date = new Date(),
): number | null {
  if (age == null || age <= 0 || age > 120) return null;
  return asOf.getFullYear() - age;
}

/** Parse a YOB column, full DOB string, or 4-digit year. */
export function parseYearOfBirthValue(raw: string | undefined | null, asOf: Date = new Date()): number | null {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  const maxYear = asOf.getFullYear();
  if (/^\d{4}$/.test(t)) {
    const y = parseInt(t, 10);
    if (y >= 1900 && y <= maxYear) return y;
    return null;
  }
  const iso = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    const y = parseInt(iso[1]!, 10);
    if (y >= 1900 && y <= maxYear) return y;
  }
  const dmy = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) {
    const y = parseInt(dmy[3]!, 10);
    if (y >= 1900 && y <= maxYear) return y;
  }
  const parsed = new Date(t);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    if (y >= 1900 && y <= maxYear) return y;
  }
  return null;
}

export function resolveYearOfBirth(opts: {
  yearRaw?: string;
  nric?: string;
  age?: number;
  asOf?: Date;
}): number | null {
  const asOf = opts.asOf ?? new Date();
  const fromRaw = parseYearOfBirthValue(opts.yearRaw, asOf);
  if (fromRaw) return fromRaw;
  const fromNric = yearOfBirthFromNric(opts.nric, asOf);
  if (fromNric) return fromNric;
  return yearOfBirthFromAge(opts.age, asOf);
}

export function displayYearOfBirth(p: {
  yearOfBirth?: number | null;
  age?: number | null;
}): number | null {
  if (p.yearOfBirth != null && p.yearOfBirth >= 1900) return p.yearOfBirth;
  return yearOfBirthFromAge(p.age);
}

/** Prefer school; fall back to legacy club. */
export function displaySchool(p: {
  school?: string | null;
  club?: string | null;
}): string | null {
  const s = p.school?.trim();
  if (s) return s;
  const c = p.club?.trim();
  return c || null;
}

/** Parse labels like "UNDER 12", "U12", "Under-18" into an age band upper bound. */
export function ageBandFromCategoryLabel(label: string | null | undefined): {
  maxExclusive: number;
  minInclusive: number;
} | null {
  if (!label) return null;
  const t = label.trim().toUpperCase().replace(/\s+/g, ' ');
  const under = t.match(/^(?:UNDER|U)\s*-?\s*(\d{1,2})$/);
  if (under) {
    const max = parseInt(under[1]!, 10);
    if (max > 0 && max <= 99) return { minInclusive: 0, maxExclusive: max };
  }
  const range = t.match(/^(\d{1,2})\s*[-–]\s*(\d{1,2})$/);
  if (range) {
    const min = parseInt(range[1]!, 10);
    const max = parseInt(range[2]!, 10);
    if (min >= 0 && max > min) return { minInclusive: min, maxExclusive: max + 1 };
  }
  return null;
}

/** Infer a usable age for filtering when CSV has category labels / NRIC instead of numeric age. */
export function resolveImportAge(opts: {
  ageRaw: string;
  ageCategoryLabel?: string;
  nric?: string;
  asOf?: Date;
}): number {
  const parsed = parseInt(opts.ageRaw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;

  const fromNric = ageFromNric(opts.nric, opts.asOf);
  if (fromNric != null) return fromNric;

  const band = ageBandFromCategoryLabel(opts.ageCategoryLabel);
  if (band) {
    // Use top of band so "UNDER 18" → 17 (U12/U18 presets), not a low midpoint.
    return Math.max(band.minInclusive, band.maxExclusive - 1);
  }

  return 0;
}

export function findNricInRow(
  row: Record<string, unknown>,
  cellText: (v: unknown) => string,
): string | undefined {
  for (const [key, val] of Object.entries(row)) {
    if (!NRIC_KEY_HINT.test(key)) continue;
    const text = cellText(val);
    if (text) return text;
  }
  return undefined;
}

export function findAgeCategoryInRow(
  row: Record<string, unknown>,
  cellText: (v: unknown) => string,
): string | undefined {
  for (const [key, val] of Object.entries(row)) {
    if (!isAgeCategoryColumn(key)) continue;
    const text = cellText(val);
    if (text) return text;
  }
  return undefined;
}

/** Pull NRIC-like values out of participant customFields for repair. */
export function nricFromCustomFields(customFields: Record<string, unknown> | null | undefined): string | undefined {
  if (!customFields) return undefined;
  for (const [key, val] of Object.entries(customFields)) {
    if (!NRIC_KEY_HINT.test(key)) continue;
    if (val == null) continue;
    const text = String(val).trim();
    if (text) return text;
  }
  return undefined;
}

/** Match "UNDER 12" registration labels to category names like "Under 12" / "U12". */
export function categoryNameMatchesLabel(
  categoryName: string,
  ageCategoryLabel: string,
): boolean {
  const norm = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim()
      .replace(/^U (\d)/, 'UNDER $1')
      .replace(/^U(\d)/, 'UNDER $1');
  const a = norm(categoryName);
  const b = norm(ageCategoryLabel);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const numA = a.match(/UNDER\s*(\d{1,2})/)?.[1];
  const numB = b.match(/UNDER\s*(\d{1,2})/)?.[1];
  return Boolean(numA && numB && numA === numB);
}
