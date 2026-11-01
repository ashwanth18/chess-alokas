/**
 * How a player's name is displayed. Pure functions only; `PlayerName` renders the result.
 *
 * The rules (docs/design/DESIGN_PLAN.md, "Names: the rule", plus the founder's decisions):
 * - Nothing ever truncates a name.
 * - ALL CAPS or all-lowercase input shows in Title Case. Mixed-case input stays as typed.
 * - The patronym marker is always lowered: bin, binti, a/l, a/p.
 * - The stored value is never changed. Certificates and legal uses keep reading the original.
 * - On public pages the disambiguator is `#no · section`, never the school.
 */

/** Written forms that all mean the same marker. The marker itself is the part shown lowered. */
const MARKERS = new Set(['bin', 'binti', 'binte', 'bt', 'bte', 'a/l', 'a/p', 's/o', 'd/o']);

/**
 * "Bin" is also a Chinese given name: Tan Bin Hao, LIM BIN WEI. A surname from this list, one word
 * before the marker and one word after it reads as a Chinese name, not a patronym. It is a heuristic,
 * and getting it wrong only changes one letter's case and the line break.
 */
const CHINESE_SURNAMES = new Set(
  (
    'ang au aw chan chang chee cheah chen cheng cheong chew chia chin chong choo choong chow chu chua chuah ' +
    'foo fong gan goh gooi hew ho hoo hong kee khoo koh kok kong kuan kuah kwan lai lam lau law lee leong leow ' +
    'lew liew lim lin ling liu loh loo low lu mah ng ong ooi pang poh quah seah see sim soh song tan tang tay ' +
    'tee teh teo teoh tew thong toh wee wong woo wu yap yee yeo yeoh yong yu'
  ).split(' '),
);

const canonicalMarker = (word: string) => word.toLowerCase().replace(/\.$/, '');

const isMarkerWord = (word: string) => MARKERS.has(canonicalMarker(word));

/** Index of the first patronym marker in the words, or -1. A marker needs a name on both sides. */
function markerIndex(words: string[]): number {
  for (let i = 1; i < words.length - 1; i++) {
    if (!isMarkerWord(words[i]!)) continue;
    if (
      canonicalMarker(words[i]!) === 'bin' &&
      i === 1 &&
      words.length === 3 &&
      CHINESE_SURNAMES.has(words[0]!.toLowerCase())
    ) {
      continue;
    }
    return i;
  }
  return -1;
}

const hasUpper = (s: string) => s !== s.toLowerCase();
const hasLower = (s: string) => s !== s.toUpperCase();

const ROMAN = /^(?:ii|iii|iv|vi|vii|viii)$/i;

/** Title-cases one space-separated word, keeping hyphens, dots and apostrophes as boundaries. */
function titleWord(word: string): string {
  if (ROMAN.test(word)) return word.toUpperCase();
  return word
    .toLowerCase()
    .replace(/\p{L}[\p{L}\p{M}'’]*/gu, (part) => {
      const first = part[0]!.toUpperCase() + part.slice(1);
      // O'Neil and D'Souza capitalise after the apostrophe. Ma'ruf and Sa'adah do not.
      return first.replace(/^(\p{L})(['’])(\p{L})/u, (_, a: string, q: string, b: string) => a + q + b.toUpperCase());
    });
}

export type NameParts = {
  /** Exactly what was stored. Use this for certificates, exports and anything legal. */
  original: string;
  /** The whole name as displayed. */
  display: string;
  /** Given name, or the whole name when there is no patronym. */
  given: string;
  /** "binti Queen Gambit", or null when there is no patronym. */
  rest: string | null;
};

export function nameParts(raw: string): NameParts {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { original: raw, display: '', given: '', rest: null };

  const joined = words.join(' ');
  // Mixed case means someone typed it deliberately. One-case input carries no information.
  const keepAsTyped = hasUpper(joined) && hasLower(joined);
  const split = markerIndex(words);

  const shown = words.map((word, i) => {
    if (split !== -1 && i >= split && i < words.length - 1 && isMarkerWord(word)) {
      return canonicalMarker(word);
    }
    return keepAsTyped ? word : titleWord(word);
  });

  const display = shown.join(' ');
  if (split === -1) return { original: raw, display, given: display, rest: null };
  return {
    original: raw,
    display,
    given: shown.slice(0, split).join(' '),
    rest: shown.slice(split).join(' '),
  };
}

export const displayName = (raw: string) => nameParts(raw).display;

/** `#12 · U12`. The public form: no school, per the founder's decision on children's data. */
export function formatDisambiguator(info: { no?: number | null; section?: string | null }): string {
  const parts: string[] = [];
  if (info.no != null) parts.push(`#${info.no}`);
  if (info.section) parts.push(info.section);
  return parts.join(' · ');
}

const compareKey = (raw: string) =>
  displayName(raw)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '');

function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Two keys a reader could mistake for each other at a glance. */
function looksAlike(a: string, b: string): boolean {
  if (a === b) return true;
  const shared = sharedPrefix(a, b);
  if (shared >= 16) return true;
  return shared >= 10 && shared >= 0.6 * Math.min(a.length, b.length);
}

/**
 * The ids of players whose name could be mistaken for another player's. Show a disambiguator for
 * these. Sorting makes it linear after the sort: the longest shared prefix is always a neighbour.
 */
export function findLookalikes<T extends { id: string; name: string }>(players: readonly T[]): Set<string> {
  const sorted = players
    .map((p) => ({ id: p.id, key: compareKey(p.name) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const out = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (looksAlike(prev.key, cur.key)) {
      out.add(prev.id);
      out.add(cur.id);
    }
  }
  return out;
}

/**
 * Width of a name at each font-stretch, relative to 100%. Measured in a browser on a 40-character
 * name in Archivo: 1863 at 100%, 1475 at 75%, 1275 at 62%.
 */
const WIDTH_CURVE: ReadonlyArray<readonly [stretch: number, ratio: number]> = [
  [100, 1],
  [75, 1475 / 1863],
  [62, 1275 / 1863],
];

export const MIN_STRETCH = 62;

/**
 * The font-stretch that makes a line of `natural` px fit `available` px, rounded down to a whole percent.
 * Returns null when even the narrowest width isn't enough, and then the caller wraps instead.
 */
export function stretchToFit(natural: number, available: number): number | null {
  if (natural <= available) return 100;
  if (available <= 0) return null;
  const want = available / natural;
  for (let i = 1; i < WIDTH_CURVE.length; i++) {
    const [sHigh, rHigh] = WIDTH_CURVE[i - 1]!;
    const [sLow, rLow] = WIDTH_CURVE[i]!;
    if (want >= rLow) {
      const t = (want - rLow) / (rHigh - rLow);
      return Math.floor(sLow + t * (sHigh - sLow));
    }
  }
  return null;
}
