/**
 * Fixture data for Playwright. Every person, school and event is an invented chess pun that keeps the
 * structure of a real Malaysian name. Never add real names, sample-registrations-*.csv or scripts/arcc-*.json.
 */

/** Everything happens at this instant, in Asia/Kuala_Lumpur (14:32 local). */
export const NOW = '2026-07-14T06:32:00.000Z';

export const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
export const LIVE_TOKEN = 'imaginary-bay-token';
export const EVENT_SLUG = 'imaginary-bay-junior-rapid';
export const TABLE_SLUG = 'imaginary-bay-table-2';
export const USER_ID = '22222222-2222-4222-8222-222222222222';
export const CAT_U12 = '33333333-3333-4333-8333-333333333312';
export const CAT_U18 = '33333333-3333-4333-8333-333333333318';

const U12 = [
  'PUTERI ALEKHINE DAMIA BINTI QUEEN GAMBIT',
  'PUTERI ALEKHINE DAMIA BINTI QUEEN INDIAN',
  'Kavitha Zugzwang a/p Fianchetto Rajaratnam',
  'Tan Zwischen Zug',
  'Muhammad Caro Kann bin Sicilian Najdorf',
  'Lim Gambit Ling',
  'Arjun Pirc a/l Grunfeld Subramaniam',
  'Nur Sicilia Najdorfah binti Mohd Endgame Tablebase',
  'Chong Rook Hao',
  'Wan Rookiah Fianchetta binti Wan Back Rank',
  'Ng Pawn Mei',
  'Priya Benoni a/p Philidor',
];
const U18 = [
  'Tengku Gambit Iskandar bin Tengku Kingside Castle',
  'Vikram Tempo a/l Zwischenzug Krishnan',
  'Yap Pin Yi',
  'SITI BISHOPAH KASPARINA BINTI EN PASSANT',
  'Lee Skewer Xuan',
  'Dayang Nimzo Indiana binti Awang Opposite Bishops',
  'Teoh Rook Lift',
  'Harish Catalan a/l Tartakower',
];
const SCHOOLS = ['SK Pretend Heights', 'SJK(C) Imaginary Bay', 'SJK(T) Nowhere Road', 'SMK Fictional Jaya'];

const uuid = (prefix: string, i: number) => `${prefix}-0000-4000-8000-${String(i).padStart(12, '0')}`;

export type FixturePlayer = {
  id: string;
  name: string;
  rating: number;
  seed: number;
  categoryId: string;
  school: string;
};

export const players: FixturePlayer[] = [
  ...U12.map((name, i) => ({
    id: uuid('aaaaaaaa', i + 1),
    name,
    rating: 1460 - i * 37,
    seed: i + 1,
    categoryId: CAT_U12,
    school: SCHOOLS[i % SCHOOLS.length]!,
  })),
  ...U18.map((name, i) => ({
    id: uuid('bbbbbbbb', i + 1),
    name,
    rating: 1880 - i * 37,
    seed: i + 13,
    categoryId: CAT_U18,
    school: SCHOOLS[i % SCHOOLS.length]!,
  })),
];

export type FixtureGame = {
  id: string;
  round: number;
  board: number;
  whiteId: string;
  blackId: string;
  result: string;
  isBye: boolean;
  categoryId: string;
};

const ROUND1_RESULTS = ['1-0', '0-1', '1/2-1/2', '1-0', '1-0', '0-1', '1/2-1/2', '1-0F', '1-0', '0-1'];
const ROUND2_RESULTS = ['1-0', 'pending', 'pending', '1/2-1/2', 'pending', '0-1', 'pending', '1-0', 'pending', 'pending'];

/** Pairs each section's top half with its bottom half; round 2 shifts by one and swaps colours. */
function buildRound(round: number, results: string[], shift: number): FixtureGame[] {
  const out: FixtureGame[] = [];
  let board = 1;
  for (const cat of [CAT_U12, CAT_U18]) {
    const list = players.filter((p) => p.categoryId === cat);
    const half = Math.floor(list.length / 2);
    for (let i = 0; i < half; i++) {
      const a = list[i]!;
      const b = list[half + ((i + shift) % half)]!;
      const white = round % 2 === 1 ? a : b;
      const black = round % 2 === 1 ? b : a;
      out.push({
        id: uuid(round === 1 ? 'cccccccc' : 'dddddddd', board),
        round,
        board,
        whiteId: white.id,
        blackId: black.id,
        result: results[board - 1] ?? 'pending',
        isBye: false,
        categoryId: cat,
      });
      board++;
    }
  }
  return out;
}

export const games: FixtureGame[] = [...buildRound(1, ROUND1_RESULTS, 0), ...buildRound(2, ROUND2_RESULTS, 1)];

export const categories = [
  { id: CAT_U12, name: 'U12', prizePlaces: 3 },
  { id: CAT_U18, name: 'U18', prizePlaces: 3 },
];

export const livePayload = {
  tournament: {
    name: 'Imaginary Bay Junior Rapid',
    date: '2026-07-14',
    rounds: 5,
    currentRound: 2,
    confirmedRounds: 1,
    mixCategories: false,
    status: 'in_progress',
    prizePlaces: 3,
    tiebreakOrder: null,
    sharedPlaces: true,
  },
  categories,
  players: players.map((p) => ({
    id: p.id,
    name: p.name,
    rating: p.rating,
    city: 'Pretend Heights',
    state: 'Selangor',
    country: 'MAS',
    seed: p.seed,
    categoryIds: [p.categoryId],
  })),
  games,
};

const nameOf = (id: string) => players.find((p) => p.id === id)!.name;

export function floorView(status: 'needs_pin' | 'pending') {
  const g = games.find((x) => x.round === 2 && x.board === 2)!;
  return {
    slug: TABLE_SLUG,
    tableNumber: 2,
    tournamentName: 'Imaginary Bay Junior Rapid',
    tournamentId: TOURNAMENT_ID,
    pinRound: 2,
    round: 2,
    gameId: g.id,
    whiteId: g.whiteId,
    blackId: g.blackId,
    whiteName: nameOf(g.whiteId),
    blackName: nameOf(g.blackId),
    status,
    result: null,
    sessionOk: status === 'pending',
    whiteCards: { illegalMove: 0, warning: 0 },
    blackCards: { illegalMove: 0, warning: 0 },
    forfeitReason: null,
  };
}

export const floorZone = {
  tournamentId: TOURNAMENT_ID,
  tournamentName: 'Imaginary Bay Junior Rapid',
  round: 2,
  arbiterName: 'Goh En Passant',
  boards: games
    .filter((g) => g.round === 2)
    .map((g) => ({
      tableNumber: g.board,
      slug: `imaginary-bay-table-${g.board}`,
      gameId: g.id,
      categoryId: g.categoryId,
      categoryName: g.categoryId === CAT_U12 ? 'U12' : 'U18',
      whiteName: nameOf(g.whiteId),
      blackName: nameOf(g.blackId),
      result: g.result === 'pending' ? null : g.result,
      isBye: false,
      locked: g.result !== 'pending',
    })),
};

const eventBase = {
  id: TOURNAMENT_ID,
  publicSlug: EVENT_SLUG,
  name: 'Imaginary Bay Junior Rapid',
  date: '2026-08-22',
  style: 'swiss',
  rounds: 5,
  status: 'draft',
  registrationOpen: true,
  registrationDeadline: '2026-08-15T15:59:00.000Z',
  maxParticipants: 120,
  registeredCount: 20,
  venueName: 'Dewan Tiada Di Peta',
  venueAddress: '12 Jalan Pretend, Imaginary Bay',
  city: 'Imaginary Bay',
  state: 'Selangor',
  country: 'Malaysia',
  latitude: null,
  longitude: null,
  timeControl: '15+5',
  entryFeeCents: 5000,
  currency: 'MYR',
  descriptionMd: 'A rapid open for young players. All names on this page are invented.',
  organizationName: 'Pretend Heights Chess Academy',
};

export const publicEvents = {
  events: [
    { ...eventBase, distanceKm: null, categories: categories.map((c) => ({ id: c.id, name: c.name })) },
    {
      ...eventBase,
      id: '44444444-4444-4444-8444-444444444444',
      publicSlug: 'nowhere-road-blitz',
      name: 'Nowhere Road Blitz',
      date: '2026-09-05',
      entryFeeCents: 0,
      registeredCount: 7,
      maxParticipants: null,
      city: 'Nowhere Road',
      distanceKm: null,
      categories: [{ id: CAT_U18, name: 'Open' }],
    },
  ],
};

export const publicEventDetail = {
  event: {
    ...eventBase,
    rulesMd: 'FIDE Rapid rules apply. Bring your own clock if you have one.',
    paymentInstructions: 'DuitNow to Pretend Heights Chess Academy, 000-0000000',
    paymentQrUrl: null,
    registrationFormSchema: { collectSchool: true, collectFideId: true, collectPhone: true, customQuestions: [] },
    publicToken: LIVE_TOKEN,
  },
  categories: categories.map((c, i) => ({
    id: c.id,
    name: c.name,
    filter: { logic: 'and', rules: [] },
    sortOrder: i,
    prizePlaces: c.prizePlaces,
  })),
  participants: [],
};

export const fixtureUser = {
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'director@example.invalid',
  app_metadata: { provider: 'email' },
  user_metadata: { display_name: 'Director Rook' },
  identities: [],
  created_at: '2026-01-01T00:00:00.000Z',
};

/** Local Dexie rows for the signed-in desk, matching db/local.ts. */
export function dexieSeed() {
  const updatedAt = NOW;
  return {
    tournaments: [
      {
        id: TOURNAMENT_ID,
        name: 'Imaginary Bay Junior Rapid',
        date: '2026-07-14',
        style: 'swiss',
        rounds: 5,
        status: 'in_progress',
        currentRound: 2,
        confirmedRounds: 1,
        mixCategories: false,
        prizePlaces: 3,
        ownerId: USER_ID,
        tableCount: 10,
        updatedAt,
        dirty: 0,
      },
    ],
    categories: categories.map((c, i) => ({
      id: c.id,
      tournamentId: TOURNAMENT_ID,
      name: c.name,
      filter: { logic: 'and', rules: [] },
      sortOrder: i,
      updatedAt,
      dirty: 0,
    })),
    participants: players.map((p) => ({
      id: p.id,
      tournamentId: TOURNAMENT_ID,
      name: p.name,
      age: p.categoryId === CAT_U12 ? 11 : 16,
      gender: null,
      rating: p.rating,
      school: p.school,
      customFields: {},
      categoryIds: [p.categoryId],
      seed: p.seed,
      updatedAt,
      dirty: 0,
    })),
    games: games.map((g) => ({ ...g, tournamentId: TOURNAMENT_ID, updatedAt, dirty: 0 })),
  };
}
