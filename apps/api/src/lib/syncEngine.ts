import {
  GameCorrectionSchema,
  isAbsenceResult,
  isCorrectableResult,
  type Game,
  type GameCorrection,
  type GameResult,
  type Organization,
  type SyncPushItem,
  type SyncRejection,
  type SyncRejectionCode,
  type Tournament,
} from '@chess-alokas/shared';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STYLES = new Set(['swiss', 'dutch', 'round_robin']);
const STATUSES = new Set(['draft', 'ready', 'in_progress', 'completed']);
const AWARD_SCOPES = new Set(['overall', 'per_category']);
const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', 'bye', 'pending', '1-0F', '0-1F', '0-0']);
/** More than this on one game can't come from a director at a desk. */
const MAX_QUEUED_CORRECTIONS = 20;

/**
 * Codes that fail the whole batch for clients that don't read `rejected`. Those clients
 * mark everything they sent as synced, so a 200 would lose the work without a word.
 */
const HARD_REJECTION_STATUS: Partial<Record<SyncRejectionCode, number>> = {
  forbidden: 403,
  forbidden_organization: 403,
  quota: 403,
  invalid: 400,
};

export interface SyncPushResult {
  accepted: number;
  rejected: SyncRejection[];
}

export interface SyncPushOptions {
  /** Throw on the first permission, quota or validation rejection (older clients). */
  strict?: boolean;
}

export interface SyncResultEvent {
  gameId: string;
  tournamentId: string;
  result: GameResult;
  previousResult: GameResult | null;
  actorName: string | null;
  actorUserId: string | null;
  note: string;
  createdAt: string;
}

export type GameWriteDecision =
  | { kind: 'noop' }
  | { kind: 'reject'; code: SyncRejectionCode; reason: string }
  | GameWriteApply;

export interface GameWriteApply {
  kind: 'apply';
  resultLockedAt: string | null;
  resultOverrideCount: number;
  /** Set when the result changes: every such change goes in the audit trail. */
  auditPreviousResult: GameResult | null | undefined;
  /** Set for a late correction: one audit row per change, in place of the one above. */
  corrections?: GameCorrection[];
  /** A result on this device that the server never saw, which the corrections start from. */
  unsyncedBase?: { from: GameResult | null; to: GameResult };
}

/** Where the rules touch storage. Each store implements this once, inside one transaction. */
export interface SyncBackend {
  /** Loads and, in Postgres, locks these tournaments for the rest of the batch. */
  loadTournaments(ids: string[]): Promise<Map<string, Tournament>>;
  /** Organizations whose tournaments this user may manage (owner, admin, director). */
  manageableOrganizationIds(userId: string): Promise<Set<string>>;
  /** Throws a statusCode error when the plan forbids another active tournament. */
  checkTournamentQuota(t: Tournament): Promise<Organization | null>;
  playerLimit(t: Tournament): Promise<number | null>;
  activeParticipantIds(tournamentId: string): Promise<Set<string>>;
  /** Includes soft-deleted rows: old games may refer to them. */
  categoryIds(tournamentId: string): Promise<Set<string>>;
  participantIds(tournamentId: string): Promise<Set<string>>;
  childMeta(
    entity: 'category' | 'participant',
    id: string,
  ): Promise<{ tournamentId: string; updatedAt: string } | null>;
  /** In Postgres, also locks the row, so a floor result can't land between the check and the write. */
  getGame(id: string): Promise<Game | null>;
  /** Live cards on this game. A game with cards was played, so it can't become an absence. */
  countGameCards(gameId: string): Promise<number>;
  /** The organizer confirmed they hold consent for an import. Recorded once per confirmation. */
  recordRosterConsent(input: {
    tournamentId: string;
    userId: string | null;
    confirmedAt: string;
  }): Promise<void>;
  writeTournament(input: {
    item: SyncPushItem;
    existing: Tournament | null;
    ownerId: string | null;
    organizationId: string | null;
  }): Promise<Tournament>;
  writeChild(entity: 'category' | 'participant', item: SyncPushItem): Promise<void>;
  writeGame(item: SyncPushItem, decision: GameWriteApply): Promise<void>;
  insertResultEvent(event: SyncResultEvent): Promise<void>;
}

/** A clock ahead of the server must not win every later edit, so it stops at server time. */
export function clampSyncTimestamp(iso: string, now: Date = new Date()): string {
  return Date.parse(iso) > now.getTime() ? now.toISOString() : iso;
}

function isPositiveInt(v: unknown): boolean {
  const n = Number(v);
  return Number.isInteger(n) && n > 0;
}

/** Mirrors the database constraints, so one bad row can't abort a whole batch's transaction. */
export function validateSyncPayload(item: SyncPushItem): string | null {
  const p = item.payload;
  if (item.entity === 'tournament') {
    if (p['style'] != null && !STYLES.has(String(p['style']))) return 'Unknown tournament style.';
    if (p['status'] != null && !STATUSES.has(String(p['status']))) {
      return 'Unknown tournament status.';
    }
    if (p['awardScope'] != null && !AWARD_SCOPES.has(String(p['awardScope']))) {
      return 'Unknown award scope.';
    }
    if (p['rounds'] != null && !isPositiveInt(p['rounds'])) {
      return 'Rounds must be a positive whole number.';
    }
    if (p['organizationId'] != null && !UUID_RE.test(String(p['organizationId']))) {
      return 'organizationId is not a valid id.';
    }
    return null;
  }
  if (!UUID_RE.test(String(p['tournamentId'] ?? ''))) return 'tournamentId is not a valid id.';
  if (item.entity === 'participant') {
    if (p['age'] != null && !Number.isFinite(Number(p['age']))) return 'Age must be a number.';
    if (p['categoryIds'] != null && !Array.isArray(p['categoryIds'])) {
      return 'categoryIds must be a list.';
    }
    return null;
  }
  if (item.entity === 'game') {
    const categoryId = String(p['categoryId'] ?? '');
    if (!UUID_RE.test(categoryId)) {
      return `Game ${item.id} has invalid categoryId "${categoryId}". Re-pair or repair local data before syncing.`;
    }
    if (p['round'] != null && !isPositiveInt(p['round'])) {
      return 'Round must be a positive whole number.';
    }
    if (p['board'] != null && !isPositiveInt(p['board'])) {
      return 'Board must be a positive whole number.';
    }
    if (p['result'] != null && !RESULTS.has(String(p['result']))) return 'Unknown game result.';
    for (const key of ['whiteId', 'blackId']) {
      if (p[key] != null && !UUID_RE.test(String(p[key]))) return `${key} is not a valid id.`;
    }
    if (p['corrections'] != null && !correctionsOf(p)) return 'This correction is not valid.';
  }
  return null;
}

/**
 * The queued corrections on a pushed game row, or null if they don't form one unbroken chain ending
 * at the row's result. A correction needs a reason and can't set "no result".
 */
function correctionsOf(payload: Record<string, unknown>): GameCorrection[] | null {
  const parsed = GameCorrectionSchema.array()
    .min(1)
    .max(MAX_QUEUED_CORRECTIONS)
    .safeParse(payload['corrections']);
  if (!parsed.success) return null;
  const chain = parsed.data;
  const unbroken = chain.every(
    (c, i) =>
      isCorrectableResult(c.result) && (i === 0 || c.previousResult === chain[i - 1]!.result),
  );
  if (!unbroken || chain.at(-1)!.result !== payload['result']) return null;
  return chain;
}

function correctionConflict(reason: string): GameWriteDecision {
  return { kind: 'reject', code: 'correction_conflict', reason };
}

/**
 * A director's late correction. Allowed in a confirmed round, on a completed tournament and with
 * later rounds paired, because it changes one result and nothing else.
 *
 * The stored result, not the clock, decides: a correction applies only to the result the director
 * was looking at. The one exception is a result on this device that never reached the server: in a
 * round that isn't frozen, it would have been accepted as an ordinary edit, so it still is.
 */
function decideCorrection(
  existing: Game | null,
  item: SyncPushItem,
  updatedAt: string,
  confirmedRounds: number,
  corrections: GameCorrection[],
): GameWriteDecision {
  const first = corrections[0]!;
  const last = corrections.at(-1)!;
  const p = item.payload;

  if (!existing) {
    return {
      kind: 'apply',
      resultLockedAt: (p['resultLockedAt'] as string | null | undefined) ?? null,
      resultOverrideCount: corrections.length,
      auditPreviousResult: undefined,
      corrections,
      unsyncedBase: isCorrectableResult(first.previousResult)
        ? { from: null, to: first.previousResult }
        : undefined,
    };
  }

  if (existing.deletedAt) {
    return correctionConflict(`Round ${existing.round} was undone, so this game is gone.`);
  }
  if (existing.isBye || existing.result === 'bye') {
    return correctionConflict('A bye has no result to correct.');
  }
  // Already there, most likely a retry after the answer to the first attempt was lost.
  if (existing.result === last.result) return { kind: 'noop' };

  const pairingDiffers =
    existing.round !== Number(p['round'] ?? existing.round) ||
    existing.board !== Number(p['board'] ?? existing.board) ||
    (existing.whiteId ?? null) !== ((p['whiteId'] as string | null | undefined) ?? null) ||
    (existing.blackId ?? null) !== ((p['blackId'] as string | null | undefined) ?? null) ||
    existing.categoryId !== String(p['categoryId'] ?? existing.categoryId) ||
    Boolean(item.deletedAt);
  if (pairingDiffers) {
    return correctionConflict(
      `Round ${existing.round}, table ${existing.board} was paired differently on the server.`,
    );
  }

  let unsyncedBase: GameWriteApply['unsyncedBase'];
  if (existing.result !== first.previousResult) {
    const frozen = existing.round <= confirmedRounds;
    const older = Date.parse(updatedAt) < Date.parse(existing.updatedAt);
    if (existing.result !== 'pending' && (frozen || older)) {
      return correctionConflict(
        `Round ${existing.round}, table ${existing.board} is now ${existing.result}: someone else changed it. Yours was not saved.`,
      );
    }
    unsyncedBase = { from: existing.result, to: first.previousResult };
  }

  return {
    kind: 'apply',
    resultLockedAt: existing.resultLockedAt ?? null,
    resultOverrideCount: (existing.resultOverrideCount ?? 0) + corrections.length,
    auditPreviousResult: undefined,
    corrections,
    unsyncedBase,
  };
}

/**
 * What a pushed game row may do to the stored one.
 *
 * `confirmedRounds` is the lower of the value before and after this batch's tournament
 * rows. An offline director who enters results and then confirms the round sends both
 * together, and one who undoes a confirmation and corrects a result does too. Both are
 * legitimate; only a round that stays confirmed is frozen.
 */
export function decideGameWrite(
  existing: Game | null,
  item: SyncPushItem,
  updatedAt: string,
  confirmedRounds: number,
): GameWriteDecision {
  const p = item.payload;
  if (p['corrections'] != null) {
    return decideCorrection(existing, item, updatedAt, confirmedRounds, correctionsOf(p) ?? []);
  }

  const incomingResult = String(p['result'] ?? 'pending') as GameResult;
  const incomingLock = (p['resultLockedAt'] as string | null | undefined) ?? null;
  const incomingOverrides = Number(p['resultOverrideCount'] ?? 0) || 0;

  if (!existing) {
    return {
      kind: 'apply',
      resultLockedAt: incomingLock,
      resultOverrideCount: incomingOverrides,
      auditPreviousResult:
        incomingResult === 'pending' || incomingResult === 'bye' ? undefined : null,
    };
  }

  const incomingTime = Date.parse(updatedAt);
  const existingTime = Date.parse(existing.updatedAt);
  if (incomingTime === existingTime) return { kind: 'noop' };
  if (incomingTime < existingTime) {
    return {
      kind: 'reject',
      code: 'stale',
      reason: 'A newer version of this game is on the server.',
    };
  }

  // A device that was offline when a round was undone must not bring its games back.
  if (existing.deletedAt && !item.deletedAt) {
    return {
      kind: 'reject',
      code: 'game_removed',
      reason: `Round ${existing.round} was undone, so this game is gone.`,
    };
  }

  const incomingRound = Number(p['round'] ?? existing.round);
  const resultChanged = existing.result !== incomingResult;
  const pairingChanged =
    existing.round !== incomingRound ||
    existing.board !== Number(p['board'] ?? existing.board) ||
    (existing.whiteId ?? null) !== ((p['whiteId'] as string | null | undefined) ?? null) ||
    (existing.blackId ?? null) !== ((p['blackId'] as string | null | undefined) ?? null) ||
    existing.categoryId !== String(p['categoryId'] ?? existing.categoryId) ||
    Boolean(existing.isBye) !== Boolean(p['isBye'] ?? false) ||
    Boolean(existing.deletedAt) !== Boolean(item.deletedAt);

  if (
    (resultChanged || pairingChanged) &&
    Math.min(existing.round, incomingRound) <= confirmedRounds
  ) {
    return {
      kind: 'reject',
      code: 'round_confirmed',
      reason: `Round ${existing.round} is confirmed. Undo the confirmation to change this game.`,
    };
  }

  const locked = Boolean(existing.resultLockedAt);
  const directorOverride =
    p['resultEnteredByRole'] === 'director' &&
    incomingResult !== 'pending' &&
    incomingResult !== 'bye';
  if (locked && (pairingChanged || (resultChanged && !directorOverride))) {
    return {
      kind: 'reject',
      code: 'result_locked',
      reason: `Board ${existing.board} has a locked result (${existing.result}). Enter a corrected result as director to replace it.`,
    };
  }

  const wasEntered = existing.result !== 'pending' && existing.result !== 'bye';
  const stored = existing.resultOverrideCount ?? 0;
  const bump = resultChanged && wasEntered && incomingOverrides <= stored ? 1 : 0;
  return {
    kind: 'apply',
    resultLockedAt: existing.resultLockedAt ?? incomingLock,
    resultOverrideCount: Math.max(incomingOverrides, stored + bump),
    auditPreviousResult: resultChanged ? existing.result : undefined,
  };
}

function organizationIdOf(item: SyncPushItem): string | null {
  const raw = item.payload['organizationId'];
  return typeof raw === 'string' && raw ? raw : null;
}

function quotaProbe(
  id: string,
  ownerId: string | null,
  organizationId: string | null,
  item: SyncPushItem,
): Tournament {
  return {
    id,
    name: String(item.payload['name'] ?? ''),
    style: 'swiss',
    rounds: 1,
    status: 'draft',
    currentRound: 0,
    confirmedRounds: 0,
    mixCategories: false,
    prizePlaces: 3,
    awardScope: 'per_category',
    sharedPlaces: true,
    tableCount: 0,
    publicEnabled: false,
    ownerId,
    organizationId,
    updatedAt: item.updatedAt,
  };
}

function rosterConsentTime(item: SyncPushItem, now: Date): string | null {
  const raw = item.payload['rosterConsentConfirmedAt'];
  if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) return null;
  return clampSyncTimestamp(new Date(raw).toISOString(), now);
}

/** The sync rules, in one place so MemoryStore and PostgresStore can't drift apart. */
export async function runSyncPush(
  backend: SyncBackend,
  items: SyncPushItem[],
  callerId: string | null,
  options: SyncPushOptions = {},
): Promise<SyncPushResult> {
  const order = { tournament: 0, category: 1, participant: 2, game: 3 } as const;
  const sorted = [...items].sort((a, b) => order[a.entity] - order[b.entity]);
  const rejected: SyncRejection[] = [];
  let accepted = 0;
  const now = new Date();

  const reject = (item: SyncPushItem, code: SyncRejectionCode, reason: string): void => {
    const status = HARD_REJECTION_STATUS[code];
    if (options.strict && status) {
      throw Object.assign(new Error(reason), { statusCode: status });
    }
    rejected.push({ entity: item.entity, id: item.id, code, reason });
  };

  const tournamentIdOf = (item: SyncPushItem): string =>
    item.entity === 'tournament' ? item.id : String(item.payload['tournamentId'] ?? '');

  const lockIds = [...new Set(sorted.map(tournamentIdOf).filter((id) => UUID_RE.test(id)))].sort();
  const tournaments = await backend.loadTournaments(lockIds);
  // Taken before this batch's tournament rows apply: see decideGameWrite.
  const confirmedBefore = new Map(
    [...tournaments].map(([id, t]) => [id, t.confirmedRounds ?? 0] as const),
  );
  const manageable = callerId ? await backend.manageableOrganizationIds(callerId) : null;

  // A soft-deleted row still belongs to whoever owned it. Ownerless rows belong to nobody.
  const canWrite = (t: Tournament): boolean => {
    if (!callerId) return true;
    if (t.ownerId === callerId) return true;
    return Boolean(t.organizationId && manageable?.has(t.organizationId));
  };

  const categorySets = new Map<string, Set<string>>();
  const participantSets = new Map<string, Set<string>>();
  const activeSets = new Map<string, Set<string>>();
  const cached = async (
    map: Map<string, Set<string>>,
    id: string,
    load: (id: string) => Promise<Set<string>>,
  ): Promise<Set<string>> => {
    let set = map.get(id);
    if (!set) {
      set = await load(id);
      map.set(id, set);
    }
    return set;
  };
  const activeIds = (id: string) =>
    cached(activeSets, id, (tid) => backend.activeParticipantIds(tid));

  for (const original of sorted) {
    const updatedAt = clampSyncTimestamp(original.updatedAt, now);
    const item: SyncPushItem = { ...original, updatedAt };

    const invalid = validateSyncPayload(item);
    if (invalid) {
      reject(item, 'invalid', invalid);
      continue;
    }

    if (item.entity === 'tournament') {
      const existing = tournaments.get(item.id) ?? null;
      if (existing && !canWrite(existing)) {
        reject(item, 'forbidden', 'This account does not own that tournament.');
        continue;
      }

      const consentAt = rosterConsentTime(item, now);
      // Before the checks below: a confirmation still happened if this edit lost to a newer one.
      if (existing && consentAt) {
        await backend.recordRosterConsent({
          tournamentId: item.id,
          userId: callerId,
          confirmedAt: consentAt,
        });
      }

      if (existing) {
        const incomingTime = Date.parse(updatedAt);
        const existingTime = Date.parse(existing.updatedAt);
        if (incomingTime === existingTime) {
          accepted++;
          continue;
        }
        if (incomingTime < existingTime) {
          reject(item, 'stale', 'A newer version of this tournament is on the server.');
          continue;
        }
      }

      // The owner and organization of an existing row never change through sync.
      let organizationId = existing?.organizationId ?? null;
      const ownerId = existing ? (existing.ownerId ?? null) : callerId;

      if (!existing) {
        const requested = organizationIdOf(item);
        if (requested && manageable && !manageable.has(requested)) {
          reject(
            item,
            'forbidden_organization',
            'This account cannot create tournaments for that organization.',
          );
          continue;
        }
        organizationId = requested;
      }

      const creating = !existing && !item.deletedAt;
      const reviving = Boolean(existing?.deletedAt) && !item.deletedAt;
      if (creating || reviving) {
        try {
          const org = await backend.checkTournamentQuota(
            quotaProbe(item.id, ownerId, organizationId, item),
          );
          if (creating && !organizationId && org) organizationId = org.id;
          if (reviving && existing) {
            const limit = await backend.playerLimit({ ...existing, organizationId });
            const active = await activeIds(item.id);
            if (limit != null && active.size > limit) {
              reject(
                item,
                'quota',
                `Sandbox Trial quota reached: this tournament has ${active.size} players and the plan allows ${limit}.`,
              );
              continue;
            }
          }
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status && status < 500) {
            reject(item, 'quota', err instanceof Error ? err.message : 'Plan limit reached.');
            continue;
          }
          throw err;
        }
      }

      const written = await backend.writeTournament({ item, existing, ownerId, organizationId });
      tournaments.set(item.id, written);
      if (!existing && consentAt) {
        await backend.recordRosterConsent({
          tournamentId: item.id,
          userId: callerId,
          confirmedAt: consentAt,
        });
      }
      accepted++;
      continue;
    }

    const tid = String(item.payload['tournamentId']);
    const parent = tournaments.get(tid);
    if (!parent) {
      reject(item, 'tournament_not_found', 'The tournament for this row is not on the server.');
      continue;
    }
    if (!canWrite(parent)) {
      reject(item, 'forbidden', 'This account does not own that tournament.');
      continue;
    }

    if (item.entity === 'game') {
      const existing = await backend.getGame(item.id);
      if (existing && existing.tournamentId !== tid) {
        reject(item, 'forbidden', 'This game id belongs to another tournament.');
        continue;
      }
      const categories = await cached(categorySets, tid, (id) => backend.categoryIds(id));
      if (!categories.has(String(item.payload['categoryId']))) {
        reject(item, 'invalid', 'This game refers to a category outside its tournament.');
        continue;
      }
      const players = await cached(participantSets, tid, (id) => backend.participantIds(id));
      const white = item.payload['whiteId'] as string | null | undefined;
      const black = item.payload['blackId'] as string | null | undefined;
      if ((white && !players.has(white)) || (black && !players.has(black))) {
        reject(item, 'invalid', 'This game refers to a player outside its tournament.');
        continue;
      }

      const confirmed = Math.min(
        confirmedBefore.get(tid) ?? parent.confirmedRounds ?? 0,
        parent.confirmedRounds ?? 0,
      );
      const decision = decideGameWrite(existing, item, updatedAt, confirmed);
      if (decision.kind === 'noop') {
        accepted++;
        continue;
      }
      if (decision.kind === 'reject') {
        reject(item, decision.code, decision.reason);
        continue;
      }
      if (decision.corrections) {
        const chain = decision.corrections;
        if (
          existing &&
          chain.some((c) => isAbsenceResult(c.result)) &&
          (await backend.countGameCards(item.id)) > 0
        ) {
          reject(
            item,
            'correction_conflict',
            'This board has cards, so the game started. Use a played result, not an absence.',
          );
          continue;
        }
        const last = chain.at(-1)!;
        // Server time, so the corrected row reaches every device whatever the desk's clock said.
        const writtenAt = new Date(
          Math.max(now.getTime(), existing ? Date.parse(existing.updatedAt) + 1 : 0),
        ).toISOString();
        await backend.writeGame(
          {
            ...item,
            updatedAt: writtenAt,
            payload: {
              ...item.payload,
              resultEnteredByRole: 'director',
              resultEnteredByName: last.actorName || 'Director',
            },
          },
          decision,
        );
        const stamp = (at: string) => clampSyncTimestamp(at, now);
        if (decision.unsyncedBase) {
          await backend.insertResultEvent({
            gameId: item.id,
            tournamentId: tid,
            result: decision.unsyncedBase.to,
            previousResult: decision.unsyncedBase.from,
            actorName: chain[0]!.actorName ?? null,
            actorUserId: callerId,
            note: 'Applied by offline sync',
            createdAt: new Date(Date.parse(stamp(chain[0]!.at)) - 1).toISOString(),
          });
        }
        for (const correction of chain) {
          await backend.insertResultEvent({
            gameId: item.id,
            tournamentId: tid,
            result: correction.result,
            previousResult: correction.previousResult,
            actorName: correction.actorName ?? null,
            actorUserId: callerId,
            note: correction.reason,
            createdAt: stamp(correction.at),
          });
        }
        accepted++;
        continue;
      }
      await backend.writeGame(item, decision);
      if (decision.auditPreviousResult !== undefined) {
        await backend.insertResultEvent({
          gameId: item.id,
          tournamentId: tid,
          result: String(item.payload['result'] ?? 'pending') as GameResult,
          previousResult: decision.auditPreviousResult,
          actorName: (item.payload['resultEnteredByName'] as string | null | undefined) ?? null,
          actorUserId: callerId,
          note: 'Applied by offline sync',
          createdAt: updatedAt,
        });
      }
      accepted++;
      continue;
    }

    const meta = await backend.childMeta(item.entity, item.id);
    if (meta && meta.tournamentId !== tid) {
      reject(item, 'forbidden', 'This row id belongs to another tournament.');
      continue;
    }
    if (meta) {
      const incomingTime = Date.parse(updatedAt);
      const existingTime = Date.parse(meta.updatedAt);
      if (incomingTime === existingTime) {
        accepted++;
        continue;
      }
      if (incomingTime < existingTime) {
        reject(item, 'stale', 'A newer version of this row is on the server.');
        continue;
      }
    }

    if (item.entity === 'participant') {
      let toWrite = item;
      const refs = item.payload['categoryIds'];
      if (Array.isArray(refs) && refs.length > 0) {
        // Another tournament's category id must not stick. Old local ids such as
        // "__mixed__" can't refer to anything, so they pass through unchanged.
        const categories = await cached(categorySets, tid, (id) => backend.categoryIds(id));
        const kept = refs.filter((c) => !UUID_RE.test(String(c)) || categories.has(String(c)));
        if (kept.length !== refs.length) {
          toWrite = { ...item, payload: { ...item.payload, categoryIds: kept } };
        }
      }
      const active = await activeIds(tid);
      if (!item.deletedAt && !active.has(item.id)) {
        const limit = await backend.playerLimit(parent);
        if (limit != null && active.size + 1 > limit) {
          reject(
            item,
            'quota',
            `Sandbox Trial quota reached: maximum ${limit} players per tournament allowed on this plan.`,
          );
          continue;
        }
      }
      await backend.writeChild('participant', toWrite);
      if (item.deletedAt) active.delete(item.id);
      else active.add(item.id);
      participantSets.get(tid)?.add(item.id);
    } else {
      await backend.writeChild('category', item);
      categorySets.get(tid)?.add(item.id);
    }
    accepted++;
  }

  return { accepted, rejected };
}
