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
      // Distinctive token: prefer longer non-generic parts
      const sorted = [...parts].sort((a, b) => b.length - a.length);
      for (const p of sorted) {
        if (p.length >= 4) push(p);
      }
    } else if (parts.length === 1) {
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
