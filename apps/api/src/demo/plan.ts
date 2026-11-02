import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  assignStartRanks,
  computeStandings,
  createRng,
  simulateResult,
  type EnginePlayer,
  type PastGame,
} from '@chess-alokas/pairing-engine';
import { bbpPairingsAvailable } from '@chess-alokas/pairing-engine/bbp';
import { buildDemoCertificateTemplate, stampCertificate } from '@chess-alokas/certificates';
import {
  PRIVACY_NOTICE_VERSION,
  certificateYear,
  formatCertificateSerial,
  type Category,
  type FilterGroup,
  type Game,
  type GameResult,
  type Participant,
  type PlayerProfile,
  type Tournament,
  type TournamentRegistration,
  type TournamentStyle,
} from '@chess-alokas/shared';
import { hashArbiterPin } from '../floor/pin.js';
import { pairRoundOfficial } from '../lib/dutchPairing.js';
import {
  DEMO_NAME_SUFFIX,
  DEMO_ORG_NAME,
  DEMO_ORG_SLUG,
  demoEmailDomain,
} from './constants.js';
import { AINA, HAZIQ, JUNIOR_PLAYERS, OPEN_PLAYERS, PRIYA, SAMPLE_NRIC, demoEmailFor, type DemoPerson } from './roster.js';
import { pngDataUrl, sampleQrPng, sampleReceiptPng } from './sampleImage.js';
import type {
  DemoAccount,
  DemoCapabilities,
  DemoCertificateRow,
  DemoFile,
  DemoOrganization,
  DemoPlan,
  DemoResultEvent,
  DemoTournamentPlan,
} from './types.js';

/** Stable, so links in the guide and printed QR codes keep working after a reset. */
export const DEMO_LINKS = {
  liveToken: 'alokas-demo-live-rapid',
  completedToken: 'alokas-demo-live-final',
  slugs: {
    inProgress: 'demo-piala-rapid',
    kualaLumpur: 'demo-terbuka-kuala-lumpur',
    penang: 'demo-rapid-pulau-pinang',
    cheltenham: 'demo-cheltenham-rapid',
  },
} as const;

export const DEFAULT_DEMO_FLOOR_PIN = '246810';

/** The wrapper names a fictional event carries everywhere, on every build of every client. */
const DEMO_NOTICE =
  'This is a fictional demo event for showing Chess Alokas. It is not a real tournament: please do not attend, pay or enter.';
const DEMO_PAYMENT_NOTE =
  'DEMO ONLY. This event is not real. Please do not send money. The QR code below is a picture, not a way to pay.';

const NO_FILTER: FilterGroup = { logic: 'and', rules: [] };
const OPEN_FILTER: FilterGroup = { logic: 'and', rules: [{ field: 'age', op: 'gte', value: 12 }] };
const U12_FILTER: FilterGroup = { logic: 'and', rules: [{ field: 'age', op: 'lt', value: 12 }] };

const ARBITER_NAME = 'Hakim (demo arbiter)';
const DIRECTOR_NAME = 'Farah (demo director)';

export interface DemoPlanInput {
  /** The day the demo is built for. Every date is relative to it. */
  now: Date;
  organizationId: string;
  accounts: Record<'owner' | 'director' | 'arbiter' | 'parent' | 'teen', DemoAccount>;
  capabilities: DemoCapabilities;
  floorPin?: string;
  /** Defaults to FIDE Dutch where the binary is installed, otherwise the in-house Swiss. */
  style?: TournamentStyle;
  env?: NodeJS.ProcessEnv;
}

function dayOffset(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function endOfDayOffset(now: Date, days: number): string {
  return `${dayOffset(now, days)}T15:59:00.000Z`;
}

function minutesAgo(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

function baseTournament(
  input: DemoPlanInput,
  style: TournamentStyle,
  fields: Partial<Tournament> & { name: string; date: string; rounds: number; status: Tournament['status'] },
): Tournament {
  return {
    id: randomUUID(),
    style,
    currentRound: 0,
    confirmedRounds: 0,
    mixCategories: false,
    prizePlaces: 3,
    awardScope: 'per_category',
    tiebreakOrder: null,
    sharedPlaces: true,
    ownerId: input.accounts.owner.userId,
    organizationId: input.organizationId,
    tableCount: 0,
    publicEnabled: false,
    country: 'Malaysia',
    currency: 'MYR',
    entryFeeCents: 0,
    descriptionMd: DEMO_NOTICE,
    updatedAt: input.now.toISOString(),
    ...fields,
    name: `${fields.name}${DEMO_NAME_SUFFIX}`,
  } as Tournament;
}

function makeCategory(tournamentId: string, name: string, filter: FilterGroup, sortOrder: number, nowIso: string): Category {
  return { id: randomUUID(), tournamentId, name, filter, sortOrder, prizePlaces: null, updatedAt: nowIso };
}

function makeParticipant(
  tournamentId: string,
  person: DemoPerson,
  categoryIds: string[],
  domain: string,
  now: Date,
  fields: Partial<Participant> = {},
): Participant & { checkedIn?: boolean } {
  return {
    id: randomUUID(),
    tournamentId,
    name: person.name,
    age: now.getUTCFullYear() - person.yearOfBirth,
    gender: person.gender,
    rating: person.rating,
    fideId: null,
    club: null,
    school: person.school,
    city: person.city,
    state: person.state,
    country: 'Malaysia',
    yearOfBirth: person.yearOfBirth,
    email: demoEmailFor(person, domain),
    customFields: {},
    categoryIds,
    playerProfileId: null,
    updatedAt: now.toISOString(),
    ...fields,
  };
}

function toEngine(p: Participant): EnginePlayer {
  return { id: p.id, name: p.name, rating: p.rating ?? null, seed: p.seed };
}

function toPast(g: Game): PastGame {
  return { round: g.round, whiteId: g.whiteId, blackId: g.blackId, result: g.result, isBye: g.isBye };
}

interface PlayOptions {
  tournament: Tournament;
  categories: Category[];
  participants: Participant[];
  /** Rounds that have been paired. */
  throughRound: number;
  /** Rounds whose results are all in. A later paired round is still being played. */
  finishedRounds: number;
  seed: number;
  now: Date;
  /** Boards with one of these players stay unfinished in the live round. */
  stillPlaying?: Set<string>;
  /** Boards with one of these players are finished in the live round. */
  alreadyFinished?: Set<string>;
  /** Round and board position in the first section where the arbiter's first entry was wrong. */
  correction?: { round: number; note: string };
}

/**
 * Plays a tournament through the same pairing code the desk uses: one pool per category, boards
 * numbered on from the section before, and every round paired from the results before it.
 */
async function playRounds(options: PlayOptions): Promise<{ games: Game[]; events: DemoResultEvent[] }> {
  const { tournament, categories, participants, now } = options;
  const games: Game[] = [];
  const events: DemoResultEvent[] = [];
  const rng = createRng(options.seed);
  let corrected = false;

  for (let round = 1; round <= options.throughRound; round++) {
    const roundLive = round > options.finishedRounds;
    const playedAt = minutesAgo(now, (options.throughRound - round) * 45 + 25);
    let boardOffset = 0;
    for (const category of categories) {
      const pool = participants.filter(
        (p) =>
          p.categoryIds.includes(category.id) &&
          (p.withdrawnFromRound == null || round < p.withdrawnFromRound),
      );
      if (pool.length === 0) continue;
      const earlier = games.filter((g) => g.categoryId === category.id);
      const pairing = await pairRoundOfficial(tournament.style, {
        players: pool.map(toEngine),
        pastGames: earlier.map(toPast),
        round,
        totalRounds: tournament.rounds,
      });
      let categoryMax = 0;
      for (const board of pairing.boards) {
        categoryMax = Math.max(categoryMax, board.board);
        const white = pool.find((p) => p.id === board.whiteId) ?? null;
        const black = pool.find((p) => p.id === board.blackId) ?? null;
        const game: Game = {
          id: randomUUID(),
          tournamentId: tournament.id,
          categoryId: category.id,
          round,
          board: board.board + boardOffset,
          whiteId: board.whiteId,
          blackId: board.blackId,
          result: board.isBye ? 'bye' : 'pending',
          isBye: board.isBye,
          resultLockedAt: null,
          resultEnteredByName: null,
          resultEnteredByRole: null,
          resultOverrideCount: 0,
          updatedAt: playedAt,
        };
        games.push(game);
        if (board.isBye || !white || !black) continue;

        const holds = (set?: Set<string>) =>
          Boolean(set && (set.has(white.id) || set.has(black.id)));
        const finished = roundLive
          ? !holds(options.stillPlaying) && (holds(options.alreadyFinished) || rng() < 0.55)
          : true;
        if (!finished) {
          rng();
          continue;
        }
        const result = simulateResult(toEngine(white), toEngine(black), 'rating_biased', rng) as GameResult;
        game.result = result;
        game.resultLockedAt = playedAt;
        game.resultEnteredByName = ARBITER_NAME;
        game.resultEnteredByRole = 'floor';

        const eventBase = {
          gameId: game.id,
          tournamentId: tournament.id,
          actorUserId: null,
          createdAt: playedAt,
        };
        const isCorrection =
          !corrected &&
          options.correction?.round === round &&
          category === categories[0] &&
          result !== '1/2-1/2';
        if (isCorrection) {
          corrected = true;
          const wrong: GameResult = result === '1-0' ? '0-1' : '1-0';
          events.push({
            ...eventBase,
            id: randomUUID(),
            result: wrong,
            previousResult: 'pending',
            actorRole: 'floor',
            actorName: ARBITER_NAME,
            note: null,
          });
          events.push({
            ...eventBase,
            id: randomUUID(),
            result,
            previousResult: wrong,
            actorRole: 'director',
            actorName: DIRECTOR_NAME,
            note: options.correction!.note,
          });
          game.resultEnteredByName = DIRECTOR_NAME;
          game.resultEnteredByRole = 'director';
          game.resultOverrideCount = 1;
        } else {
          events.push({
            ...eventBase,
            id: randomUUID(),
            result,
            previousResult: 'pending',
            actorRole: 'floor',
            actorName: ARBITER_NAME,
            note: null,
          });
        }
      }
      boardOffset += categoryMax;
    }
  }
  return { games, events };
}

function withSeeds(participants: Participant[], categories: Category[]): void {
  for (const category of categories) {
    const pool = participants.filter((p) => p.categoryIds.includes(category.id));
    const ranks = assignStartRanks(pool);
    for (const p of pool) p.seed = ranks.get(p.id);
  }
}

function tablesFor(tournamentId: string, count: number, nowIso: string): DemoTournamentPlan['tables'] {
  return Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    tournamentId,
    tableNumber: i + 1,
    slug: randomBytes(16).toString('base64url'),
    createdAt: nowIso,
  }));
}

function highestBoard(games: Game[]): number {
  return games.reduce((max, g) => Math.max(max, g.board), 0);
}

function emptyPlan(tournament: DemoTournamentPlan['tournament']): DemoTournamentPlan {
  return {
    tournament,
    categories: [],
    participants: [],
    games: [],
    resultEvents: [],
    cards: [],
    tables: [],
    alerts: [],
    registrations: [],
    certificates: [],
  };
}

function profileFor(
  person: DemoPerson,
  accountUserId: string,
  relationship: PlayerProfile['relationship'],
  isPrimary: boolean,
  email: string,
  nowIso: string,
): PlayerProfile {
  return {
    id: randomUUID(),
    accountUserId,
    isPrimary,
    relationship,
    fullName: person.name,
    yearOfBirth: person.yearOfBirth,
    gender: person.gender,
    nationalId: SAMPLE_NRIC,
    fideRapid: person.rating,
    alokasRating: 1000,
    school: person.school,
    city: person.city,
    state: person.state,
    country: 'Malaysia',
    email,
    phone: '+60 12-000 0000',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

async function buildCertificates(
  plan: DemoTournamentPlan,
  files: DemoFile[],
  now: Date,
  template: Awaited<ReturnType<typeof buildDemoCertificateTemplate>>,
): Promise<void> {
  const { tournament, categories, participants, games } = plan;
  const prefix = 'DEMO';
  const pad = 3;
  const year = certificateYear(tournament.date ?? null);
  let sequence = 1;
  const nowIso = now.toISOString();
  for (const category of categories) {
    const pool = participants.filter((p) => p.categoryIds.includes(category.id));
    const standings = computeStandings(
      pool.map(toEngine),
      games.filter((g) => g.categoryId === category.id).map(toPast),
      { tiebreakOrder: null, sharedPlaces: true },
    );
    for (const row of standings) {
      const person = pool.find((p) => p.id === row.id);
      if (!person) continue;
      const rank = row.rank;
      const winner = rank <= (tournament.prizePlaces ?? 3);
      const serial = formatCertificateSerial(prefix, sequence, pad, year);
      sequence += 1;
      const pdf = await stampCertificate(template.template, template.layout, {
        name: person.name,
        award: winner ? `Place ${rank}, ${category.name}` : `Participation, ${category.name}`,
        tournament: tournament.name,
        date: tournament.date ?? '',
        serial,
      });
      const id = randomUUID();
      const certificate: DemoCertificateRow = {
        id,
        tournamentId: tournament.id,
        participantId: person.id,
        type: winner ? 'winner' : 'participation',
        rank: winner ? rank : null,
        categoryId: category.id,
        recipientEmail: person.email || null,
        recipientName: person.name,
        storagePath: `${tournament.id}/${id}.pdf`,
        contentSha256: createHash('sha256').update(pdf).digest('hex'),
        byteSize: pdf.byteLength,
        status: 'stored',
        serial,
        createdAt: nowIso,
      };
      plan.certificates.push(certificate);
      files.push({
        kind: 'certificate',
        tournamentId: tournament.id,
        ownerId: id,
        contentType: 'application/pdf',
        bytes: pdf,
      });
    }
  }
  tournament.certSerialPrefix = prefix;
  tournament.certSerialPad = pad;
  tournament.certSerialNext = sequence;
}

/** An organizer's form. The richer kinds of question appear once 034 is on this database. */
function registrationForm(capabilities: DemoCapabilities): Tournament['registrationFormSchema'] {
  const base = {
    collectSchool: true,
    collectFideId: true,
    collectPhone: true,
    customQuestions: [
      {
        id: 'tshirt',
        label: 'T-shirt size',
        type: 'select',
        required: true,
        options: ['XS', 'S', 'M', 'L', 'XL'],
      },
      { id: 'dietary', label: 'Any dietary needs?', type: 'text', required: false },
    ],
  };
  if (!capabilities.formBuilder) return base as Tournament['registrationFormSchema'];
  return {
    ...base,
    collectNric: true,
    collectAgeProof: false,
    malayLabels: true,
    customQuestions: [
      { ...base.customQuestions[0], labelMs: 'Saiz baju' },
      { ...base.customQuestions[1], labelMs: 'Keperluan pemakanan?' },
      {
        id: 'photos',
        label: 'May we use photos from the event?',
        labelMs: 'Boleh kami guna gambar acara?',
        type: 'checkbox',
        required: false,
      },
    ],
  } as unknown as Tournament['registrationFormSchema'];
}

interface EntrySpec {
  person: DemoPerson;
  status: TournamentRegistration['status'];
  receipt: boolean;
  category: Category;
  profile?: PlayerProfile | null;
  submittedBy?: string | null;
  note?: string;
}

function addEntries(
  plan: DemoTournamentPlan,
  entries: EntrySpec[],
  input: DemoPlanInput,
  files: DemoFile[],
  domain: string,
): void {
  const { tournament } = plan;
  const fee = tournament.entryFeeCents ?? 0;
  entries.forEach((entry, index) => {
    const createdAt = minutesAgo(input.now, (entries.length - index) * 190);
    const id = randomUUID();
    const email = entry.profile?.email ?? demoEmailFor(entry.person, domain);
    let participantId: string | null = null;
    if (entry.status === 'approved') {
      const participant = makeParticipant(
        tournament.id,
        entry.person,
        [entry.category.id],
        domain,
        input.now,
        { email, playerProfileId: entry.profile?.id ?? null },
      );
      plan.participants.push(participant);
      participantId = participant.id;
    }
    const hasFee = fee > 0;
    const paymentStatus: TournamentRegistration['paymentStatus'] = !hasFee
      ? 'not_required'
      : entry.status === 'approved'
        ? 'verified'
        : entry.receipt
          ? 'submitted'
          : 'pending_receipt';
    let receiptStoragePath: string | null = null;
    let receiptContentType: string | null = null;
    if (hasFee && entry.receipt) {
      receiptStoragePath = `${tournament.id}/${id}.png`;
      receiptContentType = 'image/png';
      files.push({
        kind: 'receipt',
        tournamentId: tournament.id,
        ownerId: id,
        contentType: 'image/png',
        bytes: sampleReceiptPng({
          reference: `DEMO-${String(index + 1).padStart(4, '0')}`,
          payer: entry.person.name,
          amountCents: fee,
          currency: tournament.currency ?? 'MYR',
          dateIso: createdAt,
        }),
      });
    }
    const decided = entry.status !== 'pending';
    const registration = {
      id,
      tournamentId: tournament.id,
      playerProfileId: entry.profile?.id ?? null,
      submittedByUserId: entry.submittedBy ?? null,
      selectedCategoryId: entry.category.id,
      playerSnapshot: {
        name: entry.person.name,
        age: input.now.getUTCFullYear() - entry.person.yearOfBirth,
        yearOfBirth: entry.person.yearOfBirth,
        gender: entry.person.gender,
        fideId: null,
        rating: entry.person.rating,
        school: entry.person.school,
        club: null,
        city: entry.person.city,
        state: entry.person.state,
        country: 'Malaysia',
        email,
        phone: '+60 12-000 0000',
      },
      customAnswers: {
        tshirt: ['S', 'M', 'L', 'XS'][index % 4]!,
        ...(index % 5 === 0 ? { dietary: 'Vegetarian' } : {}),
      },
      paymentStatus,
      receiptDataUrl: null,
      receiptStoragePath,
      receiptContentType,
      amountCents: fee,
      status: entry.status,
      reviewerNote: entry.note ?? null,
      reviewedAt: decided ? minutesAgo(input.now, 60) : null,
      participantId,
      guardianConsentAt: createdAt,
      guardianConsentNoticeVersion: PRIVACY_NOTICE_VERSION,
      guardianConsentByUserId: entry.submittedBy ?? null,
      // Only 034 has this column. Earlier databases drop it, and a re-run adds it.
      nricNumber: input.capabilities.formBuilder ? SAMPLE_NRIC : undefined,
      createdAt,
      updatedAt: createdAt,
    } as TournamentRegistration;
    plan.registrations.push(registration);
  });
}

export async function buildDemoPlan(input: DemoPlanInput): Promise<DemoPlan> {
  const { now, accounts, capabilities } = input;
  const env = input.env ?? process.env;
  const domain = demoEmailDomain(env);
  const nowIso = now.toISOString();
  const style: TournamentStyle = input.style ?? (bbpPairingsAvailable() ? 'dutch' : 'swiss');
  const files: DemoFile[] = [];
  const template = await buildDemoCertificateTemplate();

  const organization: DemoOrganization = {
    id: input.organizationId,
    name: DEMO_ORG_NAME,
    slug: DEMO_ORG_SLUG,
    logoUrl: null,
    description: 'A fictional academy for showing how Chess Alokas works. Nothing here is real.',
    website: null,
    contactEmail: accounts.owner.email,
    contactPhone: '+60 3-0000 0000',
    city: 'Petaling Jaya',
    state: 'Selangor',
    country: 'Malaysia',
    verificationStatus: 'verified',
    planTier: 'pro',
    trialEndsAt: null,
    maxTournamentsQuota: null,
    maxPlayersPerTournament: null,
    eventCreditsRemaining: 0,
    // The switch for public Discover: on for a first load. See setPubliclyListed.
    canPublishGlobal: true,
    canAcceptPaidRegistrations: true,
    paymentInstructions: DEMO_PAYMENT_NOTE,
    paymentQrStoragePath: null,
    createdBy: accounts.owner.userId,
    verifiedAt: nowIso,
    verifiedBy: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    isDemo: true,
  };

  const ainaProfile = profileFor(AINA, accounts.parent.userId, 'child', true, accounts.parent.email, nowIso);
  const haziqProfile = profileFor(HAZIQ, accounts.parent.userId, 'child', false, accounts.parent.email, nowIso);
  const priyaProfile = profileFor(PRIYA, accounts.teen.userId, 'self', true, accounts.teen.email, nowIso);
  const linked = (person: DemoPerson): Partial<Participant> => {
    if (person === AINA) return { playerProfileId: ainaProfile.id, email: accounts.parent.email };
    if (person === HAZIQ) return { playerProfileId: haziqProfile.id, email: accounts.parent.email };
    if (person === PRIYA) return { playerProfileId: priyaProfile.id, email: accounts.teen.email };
    return {};
  };

  // ---- In progress: Round 4 of 7, two sections ----
  const live = emptyPlan(
    baseTournament(input, style, {
      name: 'Piala Demo Rapid',
      date: dayOffset(now, 0),
      rounds: 7,
      status: 'in_progress',
      publicSlug: DEMO_LINKS.slugs.inProgress,
      publicToken: DEMO_LINKS.liveToken,
      publicEnabled: true,
      isPublishedGlobal: true,
      registrationOpen: false,
      venueName: 'Dewan Komuniti Contoh',
      venueAddress: 'Jalan Contoh 1, 46000 Petaling Jaya',
      city: 'Petaling Jaya',
      state: 'Selangor',
      latitude: 3.1073,
      longitude: 101.6067,
      timeControl: '15 min + 10 sec',
    }),
  );
  const liveId = live.tournament.id;
  const liveOpen = makeCategory(liveId, 'Open', OPEN_FILTER, 0, nowIso);
  const liveU12 = makeCategory(liveId, 'Under 12', U12_FILTER, 1, nowIso);
  live.categories.push(liveOpen, liveU12);
  for (const person of [...OPEN_PLAYERS, PRIYA]) {
    live.participants.push(
      makeParticipant(liveId, person, [liveOpen.id], domain, now, { ...linked(person), checkedIn: true } as Partial<Participant>),
    );
  }
  for (const person of [...JUNIOR_PLAYERS, AINA, HAZIQ]) {
    live.participants.push(
      makeParticipant(liveId, person, [liveU12.id], domain, now, { ...linked(person), checkedIn: true } as Partial<Participant>),
    );
  }
  // One player left after Round 2, so the desk shows what a withdrawal looks like.
  const withdrawn = live.participants.find((p) => p.name === 'Akif Rayyan bin Hisham');
  if (withdrawn) withdrawn.withdrawnFromRound = 3;
  withSeeds(live.participants, live.categories);

  const idOf = (profile: PlayerProfile) =>
    live.participants.find((p) => p.playerProfileId === profile.id)!.id;
  const played = await playRounds({
    tournament: live.tournament,
    categories: live.categories,
    participants: live.participants,
    throughRound: 4,
    finishedRounds: 3,
    seed: 20261,
    now,
    stillPlaying: new Set([idOf(ainaProfile), idOf(priyaProfile)]),
    alreadyFinished: new Set([idOf(haziqProfile)]),
    correction: {
      round: 2,
      note: 'Players reported the wrong winner. The arbiter checked both scoresheets.',
    },
  });
  live.games = played.games;
  live.resultEvents = played.events;
  const boards = highestBoard(live.games);
  live.tournament.currentRound = 4;
  live.tournament.confirmedRounds = 3;
  live.tournament.tableCount = boards;
  live.tournament.arbiterPinRound = 4;
  live.tournament.arbiterPinHash = hashArbiterPin(input.floorPin ?? DEFAULT_DEMO_FLOOR_PIN);
  live.tables = tablesFor(liveId, boards, nowIso);

  const ourIds = new Set([idOf(ainaProfile), idOf(haziqProfile), idOf(priyaProfile)]);
  const openRound4 = live.games.filter(
    (g) =>
      g.round === 4 &&
      g.result === 'pending' &&
      !g.isBye &&
      !ourIds.has(g.whiteId ?? '') &&
      !ourIds.has(g.blackId ?? ''),
  );
  const cardGame = openRound4[0];
  if (cardGame?.whiteId) {
    live.cards.push({
      id: randomUUID(),
      gameId: cardGame.id,
      tournamentId: liveId,
      playerId: cardGame.whiteId,
      cardType: 'illegal_move',
      note: 'Illegal move: touched the wrong piece, first warning',
      actorRole: 'floor',
      actorName: ARBITER_NAME,
      actorUserId: null,
      createdAt: minutesAgo(now, 9),
    });
  }
  const alertGame = openRound4[1] ?? openRound4[0];
  if (alertGame) {
    live.alerts.push({
      id: randomUUID(),
      tournamentId: liveId,
      round: 4,
      tableNumber: alertGame.board,
      gameId: alertGame.id,
      arbiterName: ARBITER_NAME,
      reason: 'Player is claiming a draw by repetition. Please come to this table.',
      createdAt: minutesAgo(now, 4),
      resolvedAt: null,
    });
  }

  // ---- Registration open: Kuala Lumpur, paid ----
  const qr = pngDataUrl(sampleQrPng());
  const kl = emptyPlan(
    baseTournament(input, style, {
      name: 'Terbuka Junior Kuala Lumpur',
      date: dayOffset(now, 17),
      rounds: 6,
      status: 'ready',
      publicSlug: DEMO_LINKS.slugs.kualaLumpur,
      isPublishedGlobal: true,
      registrationOpen: true,
      registrationDeadline: endOfDayOffset(now, 10),
      maxParticipants: 64,
      entryFeeCents: 4000,
      currency: 'MYR',
      paymentInstructions: DEMO_PAYMENT_NOTE,
      paymentQrUrl: qr,
      venueName: 'Dewan Contoh Kuala Lumpur',
      venueAddress: 'Jalan Contoh 8, 50450 Kuala Lumpur',
      city: 'Kuala Lumpur',
      state: 'Wilayah Persekutuan',
      latitude: 3.139,
      longitude: 101.6869,
      timeControl: '25 min + 5 sec',
      rulesMd: 'FIDE Rapid rules. Fictional event, so no rules will ever be enforced.',
      registrationFormSchema: registrationForm(capabilities),
    }),
  );
  const klOpen = makeCategory(kl.tournament.id, 'Open', OPEN_FILTER, 0, nowIso);
  const klU12 = makeCategory(kl.tournament.id, 'Under 12', U12_FILTER, 1, nowIso);
  kl.categories.push(klOpen, klU12);
  addEntries(
    kl,
    [
      ...OPEN_PLAYERS.slice(0, 10).map((person): EntrySpec => ({ person, status: 'approved', receipt: true, category: klOpen })),
      ...JUNIOR_PLAYERS.slice(0, 7).map((person): EntrySpec => ({ person, status: 'approved', receipt: true, category: klU12 })),
      { person: HAZIQ, status: 'approved', receipt: true, category: klU12, profile: haziqProfile, submittedBy: accounts.parent.userId },
      { person: AINA, status: 'pending', receipt: true, category: klU12, profile: ainaProfile, submittedBy: accounts.parent.userId },
      { person: OPEN_PLAYERS[12]!, status: 'pending', receipt: true, category: klOpen },
      { person: OPEN_PLAYERS[13]!, status: 'pending', receipt: true, category: klOpen },
      { person: JUNIOR_PLAYERS[8]!, status: 'pending', receipt: true, category: klU12 },
      { person: JUNIOR_PLAYERS[9]!, status: 'pending', receipt: false, category: klU12 },
      { person: OPEN_PLAYERS[14]!, status: 'waitlisted', receipt: true, category: klOpen, note: 'Waiting for a place in the Open section.' },
      { person: JUNIOR_PLAYERS[10]!, status: 'waitlisted', receipt: false, category: klU12, note: 'Asked to confirm the date of birth.' },
      { person: OPEN_PLAYERS[15]!, status: 'rejected', receipt: true, category: klOpen, note: 'The receipt was for a different event.' },
    ],
    input,
    files,
    domain,
  );
  withSeeds(kl.participants, kl.categories);

  // ---- Registration open: Penang, free ----
  const penang = emptyPlan(
    baseTournament(input, style, {
      name: 'Rapid Percuma Pulau Pinang',
      date: dayOffset(now, 24),
      rounds: 5,
      status: 'ready',
      publicSlug: DEMO_LINKS.slugs.penang,
      isPublishedGlobal: true,
      registrationOpen: true,
      registrationDeadline: endOfDayOffset(now, 20),
      maxParticipants: 32,
      venueName: 'Dewan Contoh George Town',
      venueAddress: 'Lebuh Contoh 3, 10200 George Town',
      city: 'George Town',
      state: 'Pulau Pinang',
      latitude: 5.4141,
      longitude: 100.3288,
      timeControl: '15 min + 5 sec',
    }),
  );
  const penangOpen = makeCategory(penang.tournament.id, 'Open', NO_FILTER, 0, nowIso);
  penang.categories.push(penangOpen);
  addEntries(
    penang,
    [
      { person: PRIYA, status: 'approved', receipt: false, category: penangOpen, profile: priyaProfile, submittedBy: accounts.teen.userId },
      ...OPEN_PLAYERS.slice(3, 10).map((person): EntrySpec => ({ person, status: 'approved', receipt: false, category: penangOpen })),
      { person: OPEN_PLAYERS[17]!, status: 'pending', receipt: false, category: penangOpen },
      { person: OPEN_PLAYERS[18]!, status: 'pending', receipt: false, category: penangOpen },
    ],
    input,
    files,
    domain,
  );
  withSeeds(penang.participants, penang.categories);

  // ---- Registration open: near Cheltenham, for showing Near me from the UK ----
  const cheltenham = emptyPlan(
    baseTournament(input, style, {
      name: 'Cheltenham Rapid Morning',
      date: dayOffset(now, 12),
      rounds: 5,
      status: 'ready',
      publicSlug: DEMO_LINKS.slugs.cheltenham,
      isPublishedGlobal: true,
      registrationOpen: true,
      registrationDeadline: endOfDayOffset(now, 9),
      maxParticipants: 24,
      country: 'United Kingdom',
      currency: 'GBP',
      venueName: 'Example Village Hall',
      venueAddress: 'Example Lane, Cheltenham',
      city: 'Cheltenham',
      state: 'Gloucestershire',
      latitude: 51.8994,
      longitude: -2.0783,
      timeControl: '15 min + 5 sec',
    }),
  );
  const cheltenhamOpen = makeCategory(cheltenham.tournament.id, 'Open', NO_FILTER, 0, nowIso);
  cheltenham.categories.push(cheltenhamOpen);
  addEntries(
    cheltenham,
    [
      ...OPEN_PLAYERS.slice(10, 14).map((person): EntrySpec => ({ person, status: 'approved', receipt: false, category: cheltenhamOpen })),
      { person: OPEN_PLAYERS[19]!, status: 'pending', receipt: false, category: cheltenhamOpen },
    ],
    input,
    files,
    domain,
  );
  withSeeds(cheltenham.participants, cheltenham.categories);

  // ---- Completed, so players have history and certificates ----
  const completedEvents: DemoTournamentPlan[] = [];
  for (const spec of [
    {
      name: 'Kejohanan Hujung Tahun',
      days: -21,
      rounds: 5,
      seed: 20262,
      token: DEMO_LINKS.completedToken,
      open: [...OPEN_PLAYERS.slice(0, 13), PRIYA],
      junior: [...JUNIOR_PLAYERS.slice(0, 8), AINA, HAZIQ],
    },
    {
      name: 'Piala Merdeka Akademi',
      days: -63,
      rounds: 4,
      seed: 20263,
      token: null,
      open: [...OPEN_PLAYERS.slice(6, 13), PRIYA],
      junior: [...JUNIOR_PLAYERS.slice(2, 9), AINA],
    },
  ]) {
    const event = emptyPlan({
      ...baseTournament(input, style, {
        name: spec.name,
        date: dayOffset(now, spec.days),
        rounds: spec.rounds,
        status: 'completed',
        publicToken: spec.token,
        publicEnabled: Boolean(spec.token),
        venueName: 'Dewan Komuniti Contoh',
        city: 'Petaling Jaya',
        state: 'Selangor',
        latitude: 3.1073,
        longitude: 101.6067,
        timeControl: '15 min + 10 sec',
      }),
      completedAt: `${dayOffset(now, spec.days)}T10:00:00.000Z`,
    });
    const id = event.tournament.id;
    const openSection = makeCategory(id, 'Open', OPEN_FILTER, 0, nowIso);
    const juniorSection = makeCategory(id, 'Under 12', U12_FILTER, 1, nowIso);
    event.categories.push(openSection, juniorSection);
    const past = new Date(`${dayOffset(now, spec.days)}T09:00:00.000Z`);
    for (const person of spec.open) {
      event.participants.push(makeParticipant(id, person, [openSection.id], domain, past, linked(person)));
    }
    for (const person of spec.junior) {
      event.participants.push(makeParticipant(id, person, [juniorSection.id], domain, past, linked(person)));
    }
    withSeeds(event.participants, event.categories);
    const result = await playRounds({
      tournament: event.tournament,
      categories: event.categories,
      participants: event.participants,
      throughRound: spec.rounds,
      finishedRounds: spec.rounds,
      seed: spec.seed,
      now: past,
    });
    event.games = result.games;
    event.resultEvents = result.events;
    event.tournament.currentRound = spec.rounds;
    event.tournament.confirmedRounds = spec.rounds;
    event.tournament.tableCount = highestBoard(event.games);
    event.tables = tablesFor(id, event.tournament.tableCount, nowIso);
    await buildCertificates(event, files, now, template);
    completedEvents.push(event);
  }

  const tournaments = [live, kl, penang, cheltenham, ...completedEvents];
  return {
    organization,
    members: [
      { userId: accounts.owner.userId, email: accounts.owner.email, role: 'owner' },
      { userId: accounts.director.userId, email: accounts.director.email, role: 'director' },
      { userId: accounts.arbiter.userId, email: accounts.arbiter.email, role: 'arbiter' },
    ],
    profiles: [ainaProfile, haziqProfile, priyaProfile],
    tournaments,
    files,
    summary: {
      engine: style,
      tournaments: tournaments.length,
      participants: tournaments.reduce((n, t) => n + t.participants.length, 0),
      games: tournaments.reduce((n, t) => n + t.games.length, 0),
      registrations: tournaments.reduce((n, t) => n + t.registrations.length, 0),
      certificates: tournaments.reduce((n, t) => n + t.certificates.length, 0),
      files: files.length,
    },
  };
}
