/** Strip Malaysian patronymic markers and normalize for FIDE name search. */
export function stripPatronomic(name: string): string {
  return name
    .replace(/\bA\/L\b/gi, ' ')
    .replace(/\bA\/P\b/gi, ' ')
    .replace(/\bA\/K\b/gi, ' ')
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

/**
 * Score how well a FIDE catalog name fits a roster name.
 * Exact token hits count more than substrings (avoids Varshan → Devavarshan).
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
    // Substring only for longer tokens, and never if it is only a partial of a longer FIDE token
    // without being that token (e.g. "varshan" inside "devavarshan").
    if (t.length >= 6 && fide.some((f) => f.startsWith(t) || t.startsWith(f))) {
      score += 1;
    }
  }
  return score;
}

/** Minimum score to keep a LIKE hit as a candidate. */
export const MIN_NAME_MATCH_SCORE = 3;

/**
 * Build search variants for a roster name.
 * Prefer FIDE `Last, First`; also try distinctive tokens.
 */
export function nameSearchVariants(rawName: string): string[] {
  const cleaned = stripPatronomic(rawName);
  if (!cleaned) return [];

  const variants: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !variants.includes(t)) variants.push(t);
  };

  push(cleaned);

  if (cleaned.includes(',')) {
    const [last, ...rest] = cleaned.split(',').map((p) => p.trim());
    const first = rest.join(' ').trim();
    if (last && first) {
      push(`${last}, ${first}`);
      push(first);
      push(last);
    }
  } else {
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1]!;
      const first = parts.slice(0, -1).join(' ');
      push(`${last}, ${first}`);
      // Given-name-first Malaysian style: First … Last → also try Last, FirstToken
      const given = parts[0]!;
      if (given.length >= 3 && last.length >= 3) {
        push(`${last}, ${given}`);
      }
      // Distinctive tokens only when long enough to avoid common false LIKE hits
      const sorted = [...parts].sort((a, b) => b.length - a.length);
      for (const p of sorted) {
        if (p.length >= 5) push(p);
      }
    } else if (parts.length === 1 && parts[0]!.length >= 5) {
      push(parts[0]!);
    }
  }

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
