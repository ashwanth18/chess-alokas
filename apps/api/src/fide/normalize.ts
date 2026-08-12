/** Strip Malaysian / Malay patronymic markers and normalize for FIDE name search. */
export function stripPatronomic(name: string): string {
  return name
    .replace(/\bA\s*\/\s*L\b/gi, ' ')
    .replace(/\bA\s*\/\s*P\b/gi, ' ')
    .replace(/\bA\s*\/\s*K\b/gi, ' ')
    .replace(/\bA\/L\b/gi, ' ')
    .replace(/\bA\/P\b/gi, ' ')
    .replace(/\bA\/K\b/gi, ' ')
    // Bare AL / AP / AK between name parts (e.g. DHARSHINI AP MATHAVAN)
    .replace(/\bAL\b/gi, ' ')
    .replace(/\bAP\b/gi, ' ')
    .replace(/\bAK\b/gi, ' ')
    .replace(/\bbinti\b/gi, ' ')
    .replace(/\bbinte\b/gi, ' ')
    .replace(/\bbte\b/gi, ' ')
    .replace(/\bbt\b/gi, ' ')
    .replace(/\bbin\b/gi, ' ')
    .replace(/[.'"`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Significant name tokens for matching (lowercase). */
export function nameTokens(name: string): string[] {
  return stripPatronomic(name)
    .toLowerCase()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

export type NameParts = {
  given: string | null;
  family: string | null;
  cleaned: string;
};

/** Parse roster / FIDE-style name into given + family. */
export function parseNameParts(rawName: string): NameParts {
  const cleaned = stripPatronomic(rawName);
  if (!cleaned) return { given: null, family: null, cleaned: '' };

  if (cleaned.includes(',')) {
    const [last, ...rest] = cleaned.split(',').map((p) => p.trim());
    const first = rest.join(' ').trim();
    const givenToken = first.split(/\s+/).filter(Boolean)[0] ?? null;
    return {
      cleaned,
      family: last || null,
      given: givenToken,
    };
  }

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { given: null, family: null, cleaned };
  if (parts.length === 1) {
    return { cleaned, given: parts[0]!, family: null };
  }
  return {
    cleaned,
    given: parts[0]!,
    family: parts[parts.length - 1]!,
  };
}

/**
 * Score how well a FIDE catalog name fits a roster name.
 * Exact token hits count more than prefix matches.
 */
export function scoreNameMatch(rosterName: string, fideName: string): number {
  const roster = nameTokens(rosterName);
  const fide = nameTokens(fideName);
  if (roster.length === 0 || fide.length === 0) return 0;

  let score = 0;
  for (const t of roster) {
    if (fide.some((f) => f === t)) {
      score += 3;
      continue;
    }
    if (t.length >= 6 && fide.some((f) => f.startsWith(t) || t.startsWith(f))) {
      score += 1;
    }
  }
  return score;
}

/** Keep as candidate for the pick list (at least one solid token). */
export const MIN_CANDIDATE_SCORE = 3;

/** Auto-unique requires both given + family style hits (2×3). */
export const UNIQUE_MIN_SCORE = 6;

/** Clear winner must beat runner-up by this margin. */
export const UNIQUE_SCORE_GAP = 3;

/**
 * Structured search queries for Lichess — never bare surname alone as the only query.
 */
export function nameSearchVariants(rawName: string): string[] {
  const parts = parseNameParts(rawName);
  if (!parts.cleaned) return [];

  const variants: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !variants.includes(t)) variants.push(t);
  };

  if (parts.family && parts.given) {
    push(`${parts.family}, ${parts.given}`);
    push(`${parts.given} ${parts.family}`);
    push(`${parts.family} ${parts.given}`);
  } else {
    push(parts.cleaned);
  }

  // Full cleaned string if multi-token and not already covered
  if (parts.cleaned.includes(' ')) push(parts.cleaned);

  return variants;
}

const COUNTRY_TO_FED: Record<string, string> = {
  malaysia: 'MAS',
  mas: 'MAS',
  singapore: 'SGP',
  sgp: 'SGP',
  indonesia: 'INA',
  ina: 'INA',
  thailand: 'THA',
  tha: 'THA',
  philippines: 'PHI',
  phi: 'PHI',
  india: 'IND',
  ind: 'IND',
  china: 'CHN',
  chn: 'CHN',
  'hong kong': 'HKG',
  hkg: 'HKG',
  vietnam: 'VIE',
  vie: 'VIE',
  australia: 'AUS',
  aus: 'AUS',
  'united states': 'USA',
  usa: 'USA',
  england: 'ENG',
  eng: 'ENG',
  russia: 'RUS',
  rus: 'RUS',
  ukraine: 'UKR',
  ukr: 'UKR',
  germany: 'GER',
  ger: 'GER',
  france: 'FRA',
  fra: 'FRA',
  spain: 'ESP',
  esp: 'ESP',
  japan: 'JPN',
  jpn: 'JPN',
  'south korea': 'KOR',
  korea: 'KOR',
  kor: 'KOR',
  brunei: 'BRU',
  bru: 'BRU',
};

/** Map roster country (name or code) to FIDE federation code. */
export function toFederationCode(country: string | null | undefined): string | null {
  if (!country) return null;
  const trimmed = country.trim();
  if (!trimmed) return null;
  if (/^[A-Za-z]{3}$/.test(trimmed)) return trimmed.toUpperCase();
  const mapped = COUNTRY_TO_FED[trimmed.toLowerCase()];
  return mapped ?? null;
}
