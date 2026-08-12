import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  pairRound,
  computeStandings,
  computeSectionStandings,
  computeEndRankMap,
  assignStartRanks,
  computeStartRankMap,
  sortRoster,
} from '@chess-alokas/pairing-engine';
import { displaySchool, displayYearOfBirth } from '../lib/importParse';
import type { FilterGroup, FilterOp, GameCardType, GameResult, TiebreakKey } from '@chess-alokas/shared';
import {
  ILLEGAL_MOVE_LIMIT,
  WARNING_LIMIT,
  countCardsForPlayer,
  emptyCardCounts,
  normalizeTiebreakOrder,
} from '@chess-alokas/shared';
import { db, nowIso } from '../db/local';
import ColorSide from '../components/ColorSide';
import {
  effectiveTournamentStatus,
  estimateFloorTableCount,
  estimateFloorTables,
  getNextPairingRound,
  getTournamentCapabilities,
  getTournamentInstructions,
  pendingResultsCountForCategory,
  highestPairedRound,
  isMixedTournament,
  isTournamentComplete,
  canEditRoundResults,
  resolvedConfirmedRounds,
} from '../lib/tournamentProgress';
import TournamentInstructions from '../components/TournamentInstructions';
import TableSearch from '../components/TableSearch';
import TiebreakRulesHelp from '../components/TiebreakRulesHelp';
import TiebreakOrderEditor from '../components/TiebreakOrderEditor';
import { matchesTextSearch } from '../lib/textSearch';
import { softDeleteTournament } from '../lib/deleteTournament';
import { ensurePoolCategoryId, repairTournamentLocalData } from '../lib/poolCategory';
import { DEFAULT_PRIZE_PLACES, resolvePrizePlaces } from '../lib/prizePlaces';
import {
  apiFloorPrepare,
  apiFloorRotatePin,
  apiFloorListTables,
  apiDirectorSetGameResult,
  apiDirectorIssueCard,
  apiDirectorRemoveCard,
  apiListGameCards,
  apiPublicLiveEnable,
  apiPublicLiveRotate,
  apiPublicLiveDisable,
} from '../api/client';
import { syncOnline } from '../sync/sync';
import { subscribeTournamentGames } from '../lib/gamesRealtime';
import { subscribeTournamentGameCards } from '../lib/gameCardsRealtime';
import {
  buildTableStickerPdf,
  downloadPdfBytes,
} from '../lib/tableStickers';
import { livePublicUrl } from '../lib/liveViewer';
import { useAuth } from '../auth/AuthContext';

type Tab = 'players' | 'pairings' | 'standings';

const FILTER_OP_LABELS: Record<FilterOp, string> = {
  eq: '=',
  neq: '≠',
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
  in: 'in',
};

async function persistMissingSeedsAndYob(
  players: Array<{
    id: string;
    name: string;
    rating?: number | null;
    seed?: number | null;
    categoryIds?: string[];
    yearOfBirth?: number | null;
    age?: number | null;
  }>,
  mixCategories: boolean,
) {
  const now = nowIso();
  const ranks = computeStartRankMap(players, { mixCategories });
  for (const p of players) {
    const seed = ranks.get(p.id);
    const yob = displayYearOfBirth(p);
    const patch: { seed?: number; yearOfBirth?: number } = {};
    if ((p.seed == null || p.seed <= 0) && seed != null && seed > 0) patch.seed = seed;
    if (p.yearOfBirth == null && yob != null) patch.yearOfBirth = yob;
    if (Object.keys(patch).length === 0) continue;
    await db.participants.update(p.id, {
      ...patch,
      updatedAt: now,
      dirty: 1,
    });
  }
}

function formatFilterSummary(filter: FilterGroup | null | undefined): string {
  if (!filter?.rules?.length) return 'No filter (matches everyone)';
  const parts = filter.rules.map((r) => {
    const op = FILTER_OP_LABELS[r.op as FilterOp] ?? r.op;
    const value = Array.isArray(r.value) ? r.value.join(', ') : String(r.value);
    return `${r.field} ${op} ${value}`;
  });
  return parts.join(` ${filter.logic.toUpperCase()} `);
}
function ResultSelector({
  value,
  onChange,
  isBye,
  readOnly,
  locked,
}: {
  value: string;
  onChange: (r: GameResult) => void;
  isBye: boolean;
  readOnly?: boolean;
  locked?: boolean;
}) {
  if (isBye) return <span className="result-bye">BYE (1pt)</span>;
  if (readOnly) {
    return (
      <span className="result-readonly">
        {value === 'pending' ? '—' : value}
        {locked ? ' · locked' : ''}
      </span>
    );
  }
  const options: { value: GameResult; label: string }[] = [
    { value: '1-0', label: '1-0' },
    { value: '0-1', label: '0-1' },
    { value: '1/2-1/2', label: '½' },
    { value: '1-0F', label: '1-0F' },
    { value: '0-1F', label: '0-1F' },
    { value: '0-0', label: '0-0' },
  ];
  return (
    <div className="result-selector">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`result-btn ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
          title={opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function StageStrip({ stage }: { stage: string }) {
  const steps = [
    { id: 'players', label: 'Players' },
    { id: 'ready', label: 'Ready' },
    { id: 'live', label: 'Pairings' },
    { id: 'done', label: 'Complete' },
  ] as const;

  let activeIndex = 0;
  if (stage === 'ready') activeIndex = 1;
  else if (stage === 'in_progress') activeIndex = 2;
  else if (stage === 'completed') activeIndex = 3;

  return (
    <ol className="stage-strip" aria-label="Tournament progress">
      {steps.map((step, i) => (
        <li
          key={step.id}
          className={[
            'stage-step',
            i < activeIndex ? 'done' : '',
            i === activeIndex ? 'active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className="stage-num">{i + 1}</span>
          <span className="stage-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export default function TournamentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('players');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedRound, setSelectedRound] = useState<number>(1);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [floorBusy, setFloorBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resultChange, setResultChange] = useState<{
    gameId: string;
    board: number;
    from: string;
    to: GameResult;
  } | null>(null);
  const [resultNote, setResultNote] = useState('');
  const [resultBusy, setResultBusy] = useState(false);
  const auth = useAuth();
  const [playerSearch, setPlayerSearch] = useState('');
  const [boardSearch, setBoardSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveMsg, setLiveMsg] = useState<string | null>(null);
  const [roundCards, setRoundCards] = useState<
    Array<{
      id: string;
      gameId: string;
      playerId: string;
      cardType: 'illegal_move' | 'warning';
      note?: string | null;
      createdAt: string;
    }>
  >([]);
  const [cardBusyId, setCardBusyId] = useState<string | null>(null);
  const [cardMsg, setCardMsg] = useState<string | null>(null);

  const tournament = useLiveQuery(() => (id ? db.tournaments.get(id) : undefined), [id]);
  const categories = useLiveQuery(
    () =>
      id
        ? db.categories
            .where('tournamentId')
            .equals(id)
            .filter((c) => !c.deletedAt)
            .sortBy('sortOrder')
        : [],
    [id],
  );
  const participants = useLiveQuery(
    () =>
      id
        ? db.participants
            .where('tournamentId')
            .equals(id)
            .filter((p) => !p.deletedAt)
            .toArray()
        : [],
    [id],
  );
  const games = useLiveQuery(
    () =>
      id
        ? db.games
            .where('tournamentId')
            .equals(id)
            .filter((g) => !g.deletedAt)
            .toArray()
        : [],
    [id],
  );
  const floorTables = useLiveQuery(
    () => (id ? db.tournamentTables.where('tournamentId').equals(id).sortBy('tableNumber') : []),
    [id],
  );

  const mix = tournament ? isMixedTournament(tournament) : false;
  const hasCategories = (categories?.length ?? 0) > 0;
  /** Category tab for standings (and separate-mode pairings). Always set when categories exist. */
  const activeCatId = hasCategories
    ? selectedCategoryId || categories?.[0]?.id || ''
    : '';

  const roundsInPlay = games
    ? [...new Set(games.map((g) => g.round))].sort((a, b) => a - b)
    : [];
  const displayRound = selectedRound || (tournament?.currentRound ?? 1);
  const maxRounds = tournament?.rounds ?? 0;
  const nextPairingRound =
    tournament && categories && participants && games
      ? getNextPairingRound(maxRounds, categories, participants, games, mix)
      : null;

  const caps =
    tournament && categories && participants && games
      ? getTournamentCapabilities(tournament, categories, participants, games)
      : null;
  const categoryNames = Object.fromEntries((categories ?? []).map((c) => [c.id, c.name]));
  const floorEstimate =
    tournament && categories && participants
      ? estimateFloorTables(tournament, categories, participants)
      : null;
  const estimatedTables =
    floorEstimate?.tableCount ??
    (tournament && categories && participants
      ? estimateFloorTableCount(tournament, categories, participants)
      : 1);
  const instructionSteps =
    tournament && categories && participants && games && caps && caps.stage !== 'completed'
      ? getTournamentInstructions(
          tournament,
          categories,
          participants,
          games,
          caps,
          categoryNames,
          floorTables?.length ?? 0,
        )
      : [];
  const displayStatus =
    tournament && categories && participants && games
      ? effectiveTournamentStatus(tournament, categories, participants, games)
      : (tournament?.status ?? 'draft');

  // Persist completed only when fully done; keep in_progress while results pending
  useEffect(() => {
    if (!id || !tournament || !categories || !participants || !games || !caps) return;

    if (caps.stage === 'completed' && tournament.status !== 'completed') {
      void db.tournaments.update(id, {
        status: 'completed',
        currentRound: Math.max(
          tournament.currentRound,
          highestPairedRound(games),
          tournament.rounds,
        ),
        updatedAt: nowIso(),
        dirty: 1,
      });
      return;
    }

    if (
      caps.stage === 'in_progress' &&
      tournament.status === 'completed'
    ) {
      void db.tournaments.update(id, {
        status: 'in_progress',
        updatedAt: nowIso(),
        dirty: 1,
      });
    }
  }, [id, tournament, categories, participants, games, caps]);

  // Repair legacy/orphan local data that can block Round 2 and empty standings.
  useEffect(() => {
    if (!id) return;
    void repairTournamentLocalData(id);
  }, [id]);

  // Live floor results: Realtime → Dexie; backup sync when Realtime fails or on focus.
  useEffect(() => {
    if (!id || !tournament || caps?.stage !== 'in_progress') return;
    let cancelled = false;
    let realtimeOk = false;
    let backupHandle: number | null = null;

    const tick = async () => {
      try {
        await syncOnline();
        if (cancelled) return;
        if ((floorTables?.length ?? 0) === 0) {
          const listed = await apiFloorListTables(id);
          if (listed.ok && !cancelled) {
            await db.tournamentTables.where('tournamentId').equals(id).delete();
            for (const t of listed.data.tables) {
              await db.tournamentTables.put({
                id: t.id,
                tournamentId: t.tournamentId,
                tableNumber: t.tableNumber,
                slug: t.slug,
                createdAt: t.createdAt,
                dirty: 0,
              });
            }
          }
        }
      } catch {
        /* offline */
      }
    };

    const unsub = subscribeTournamentGames(id, (ok) => {
      realtimeOk = ok;
      if (cancelled) return;
      if (!ok && backupHandle == null && tab === 'pairings') {
        backupHandle = window.setInterval(() => void tick(), 5_000);
      }
      if (ok && backupHandle != null) {
        window.clearInterval(backupHandle);
        backupHandle = null;
      }
    });

    void tick();
    const slowBackup = window.setInterval(() => void tick(), 30_000);
    const onFocus = () => void tick();
    window.addEventListener('focus', onFocus);

    if (tab === 'pairings' && !realtimeOk) {
      backupHandle = window.setInterval(() => void tick(), 5_000);
    }

    return () => {
      cancelled = true;
      unsub();
      window.clearInterval(slowBackup);
      if (backupHandle != null) window.clearInterval(backupHandle);
      window.removeEventListener('focus', onFocus);
    };
  }, [id, tournament?.id, caps?.stage, floorTables?.length, tab]);

  useEffect(() => {
    if (tournament?.deletedAt) {
      navigate('/app', { replace: true });
    }
  }, [tournament?.deletedAt, navigate]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen]);

  // Live floor/director cards: Realtime → refetch; poll backup when Realtime fails.
  useEffect(() => {
    if (!id || tab !== 'pairings') {
      setRoundCards([]);
      return;
    }
    let cancelled = false;
    let realtimeOk = false;
    let pollHandle: number | null = null;

    const refreshCards = async () => {
      const res = await apiListGameCards(id, displayRound);
      if (cancelled) return;
      if (res.ok && res.data?.cards) setRoundCards(res.data.cards);
      else setRoundCards([]);
    };

    void refreshCards();

    const unsub = subscribeTournamentGameCards(
      id,
      () => {
        void refreshCards();
      },
      (ok) => {
        realtimeOk = ok;
        if (cancelled) return;
        if (!ok && pollHandle == null) {
          pollHandle = window.setInterval(() => void refreshCards(), 4_000);
        }
        if (ok && pollHandle != null) {
          window.clearInterval(pollHandle);
          pollHandle = null;
        }
      },
    );

    if (!realtimeOk) {
      pollHandle = window.setInterval(() => void refreshCards(), 4_000);
    }

    const onFocus = () => void refreshCards();
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      unsub();
      if (pollHandle != null) window.clearInterval(pollHandle);
      window.removeEventListener('focus', onFocus);
    };
  }, [id, tab, displayRound]);

  const boardsForRound = (games ?? [])
    .filter((g) => {
      if (g.round !== displayRound) return false;
      if (mix) return true;
      return !activeCatId || g.categoryId === activeCatId;
    })
    .sort((a, b) => a.board - b.board);

  const playerById = new Map((participants ?? []).map((p) => [p.id, p]));

  const startRankById = useMemo(
    () =>
      computeStartRankMap(participants ?? [], {
        mixCategories: mix || !hasCategories,
      }),
    [participants, mix, hasCategories],
  );

  const backfillKey = useRef<string | null>(null);
  useEffect(() => {
    if (!id || !participants?.length || !caps) return;
    if (caps.stage === 'draft') return;
    const needs = participants.some(
      (p) =>
        p.seed == null ||
        p.seed <= 0 ||
        (p.yearOfBirth == null && displayYearOfBirth(p) != null),
    );
    if (!needs) return;
    const key = `${id}:${participants.length}`;
    if (backfillKey.current === key) return;
    backfillKey.current = key;
    void persistMissingSeedsAndYob(participants, mix || !hasCategories);
  }, [id, participants, caps, mix, hasCategories]);

  const filteredParticipants = sortRoster(
    (participants ?? []).filter((p) =>
      matchesTextSearch(
        playerSearch,
        p.name,
        p.club,
        p.school,
        p.city,
        p.state,
        p.rating,
        p.yearOfBirth,
      ),
    ),
  );

  const filteredBoards = boardsForRound.filter((game) => {
    const white = game.whiteId ? playerById.get(game.whiteId) : null;
    const black = game.blackId ? playerById.get(game.blackId) : null;
    return matchesTextSearch(boardSearch, game.board, white?.name, black?.name);
  });

  async function markReady() {
    if (!id || !caps?.canMarkReady) return;
    if (participants?.length) {
      await persistMissingSeedsAndYob(participants, mix || !hasCategories);
    }
    await db.tournaments.update(id, {
      status: 'ready',
      updatedAt: nowIso(),
      dirty: 1,
    });
    setTab('pairings');
  }

  async function handleDelete() {
    if (!id || !tournament) return;
    const ok = window.confirm(
      `Delete "${tournament.name}"?\n\nThis removes the tournament locally and from the cloud on the next sync.`,
    );
    if (!ok) return;
    setDeleting(true);
    try {
      const removed = await softDeleteTournament(id);
      if (removed) navigate('/app', { replace: true });
    } finally {
      setDeleting(false);
    }
  }

  async function applyPublicLiveResult(
    res: Awaited<ReturnType<typeof apiPublicLiveEnable>>,
    successMsg: string,
  ) {
    if (!id) return;
    if (!res.ok) {
      setLiveMsg(res.error);
      return;
    }
    await db.tournaments.update(id, {
      publicToken: res.data.publicToken,
      publicEnabled: res.data.publicEnabled,
      updatedAt: res.data.updatedAt,
      dirty: 0,
    });
    setLiveMsg(successMsg);
  }

  async function enablePublicLive() {
    if (!id || liveBusy) return;
    setLiveBusy(true);
    setLiveMsg(null);
    try {
      try {
        await syncOnline();
      } catch {
        /* enable still works if already synced */
      }
      const res = await apiPublicLiveEnable(id);
      await applyPublicLiveResult(res, 'Live page enabled — share the link with parents.');
    } finally {
      setLiveBusy(false);
    }
  }

  async function rotatePublicLive() {
    if (!id || liveBusy) return;
    const ok = window.confirm(
      'Rotate the live link? The old URL will stop working immediately.',
    );
    if (!ok) return;
    setLiveBusy(true);
    setLiveMsg(null);
    try {
      const res = await apiPublicLiveRotate(id);
      await applyPublicLiveResult(res, 'Live link rotated — copy the new URL.');
    } finally {
      setLiveBusy(false);
    }
  }

  async function disablePublicLive() {
    if (!id || liveBusy) return;
    setLiveBusy(true);
    setLiveMsg(null);
    try {
      const res = await apiPublicLiveDisable(id);
      await applyPublicLiveResult(res, 'Live page disabled.');
    } finally {
      setLiveBusy(false);
    }
  }

  async function copyLiveLink() {
    const token = tournament?.publicToken;
    if (!token) return;
    const url = livePublicUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setLiveMsg('Link copied.');
    } catch {
      setLiveMsg(url);
    }
  }

  async function persistFloorTables(
    tournamentId: string,
    tables: {
      id: string;
      tournamentId: string;
      tableNumber: number;
      slug: string;
      createdAt: string;
    }[],
    tableCount: number,
  ) {
    await db.tournamentTables.where('tournamentId').equals(tournamentId).delete();
    for (const t of tables) {
      await db.tournamentTables.put({
        id: t.id,
        tournamentId: t.tournamentId,
        tableNumber: t.tableNumber,
        slug: t.slug,
        createdAt: t.createdAt,
        dirty: 0,
      });
    }
    await db.tournaments.update(tournamentId, {
      tableCount,
      updatedAt: nowIso(),
      dirty: 1,
    });
  }

  /** Create/expand stable table QR stations (no PIN). Call after Mark Ready. */
  async function createFloorQrTables(tournamentId: string): Promise<boolean> {
    const tableCount = Math.max(
      1,
      estimatedTables,
      (games ?? [])
        .filter((g) => !g.deletedAt)
        .reduce((max, g) => Math.max(max, g.board), 0),
    );
    try {
      // Bump + dirty so sync can reclaim a soft-deleted cloud row and claim ownership.
      await db.tournaments.update(tournamentId, {
        updatedAt: nowIso(),
        dirty: 1,
      });
      await syncOnline();
      const floor = await apiFloorPrepare(tournamentId, {
        tableCount,
        pinRound: 1,
        rotatePin: false,
      });
      if (!floor.ok) {
        setPairError(floor.error || 'Could not create table QR codes');
        return false;
      }
      await persistFloorTables(tournamentId, floor.data.tables, floor.data.tableCount);
      return true;
    } catch (err) {
      setPairError(
        err instanceof Error
          ? `QR setup failed: ${err.message}`
          : 'QR setup failed (sign in and sync online required)',
      );
      return false;
    }
  }

  /** Issue or rotate the floor PIN for a paired round (QR tables must already exist or are created). */
  async function issueFloorPinForRound(
    tournamentId: string,
    pinRound: number,
  ): Promise<boolean> {
    const tableCount = Math.max(
      1,
      estimatedTables,
      floorTables?.length ?? 0,
      tournament?.tableCount ?? 0,
    );
    try {
      await db.tournaments.update(tournamentId, {
        updatedAt: nowIso(),
        dirty: 1,
      });
      await syncOnline();
      const needTables = (floorTables?.length ?? 0) === 0;
      if (needTables) {
        const floor = await apiFloorPrepare(tournamentId, {
          tableCount,
          pinRound,
          rotatePin: true,
        });
        if (!floor.ok) {
          setPairError(floor.error || 'Could not issue floor PIN');
          return false;
        }
        await persistFloorTables(tournamentId, floor.data.tables, floor.data.tableCount);
        if (floor.data.arbiterPin) {
          await db.tournaments.update(tournamentId, {
            arbiterPin: floor.data.arbiterPin,
            arbiterPinRound: floor.data.arbiterPinRound,
            updatedAt: nowIso(),
            dirty: 1,
          });
        }
        return true;
      }
      const res = await apiFloorRotatePin(tournamentId, pinRound);
      if (!res.ok) {
        setPairError(res.error || 'Could not issue floor PIN');
        return false;
      }
      await db.tournaments.update(tournamentId, {
        arbiterPin: res.data.arbiterPin,
        arbiterPinRound: res.data.arbiterPinRound,
        updatedAt: nowIso(),
        dirty: 1,
      });
      return true;
    } catch (err) {
      setPairError(
        err instanceof Error
          ? `Floor PIN failed: ${err.message}`
          : 'Floor PIN failed (sign in and sync online required)',
      );
      return false;
    }
  }

  async function generatePairings() {
    if (!id || !participants || !caps?.canPair) {
      if (caps?.pendingResultsRound != null) {
        setPairError(
          `Enter all results for Round ${caps.pendingResultsRound} before generating Round ${nextPairingRound ?? '—'}.`,
        );
      } else if (caps?.pendingConfirmRound != null) {
        setPairError(
          `Confirm Round ${caps.pendingConfirmRound} complete before generating Round ${nextPairingRound ?? '—'}.`,
        );
      } else {
        setPairError(
          !participants || participants.length < 2
            ? 'Need at least 2 participants to generate pairings.'
            : caps?.stage === 'draft'
              ? 'Mark Ready first to confirm the player list.'
              : caps?.stage === 'completed'
                ? 'This tournament is complete.'
                : `This tournament is set to ${maxRounds} round${maxRounds === 1 ? '' : 's'}.`,
        );
      }
      return;
    }
    if (nextPairingRound === null) {
      setPairError(`This tournament is set to ${maxRounds} round${maxRounds === 1 ? '' : 's'}.`);
      return;
    }
    setPairing(true);
    setPairError(null);

    try {
      const round = nextPairingRound;
      const now = nowIso();

      // Persist start ranks before Round 1 (rated first, then unrated A–Z).
      if (round === 1) {
        if (mix || !hasCategories) {
          const ranks = assignStartRanks(participants);
          for (const p of participants) {
            const seed = ranks.get(p.id);
            if (seed != null && p.seed !== seed) {
              await db.participants.update(p.id, {
                seed,
                updatedAt: now,
                dirty: 1,
              });
            }
          }
        } else {
          for (const cat of categories ?? []) {
            if (cat.deletedAt) continue;
            const pool = participants.filter((p) => p.categoryIds?.includes(cat.id));
            const ranks = assignStartRanks(pool);
            for (const p of pool) {
              const seed = ranks.get(p.id);
              if (seed != null && p.seed !== seed) {
                await db.participants.update(p.id, {
                  seed,
                  updatedAt: now,
                  dirty: 1,
                });
              }
            }
          }
        }
        await persistMissingSeedsAndYob(participants, mix || !hasCategories);
      }

      const seedById = new Map(
        (await db.participants.where('tournamentId').equals(id).toArray())
          .filter((p) => !p.deletedAt)
          .map((p) => [p.id, p.seed] as const),
      );

      if (mix || !hasCategories) {
        const already = (games ?? []).some((g) => !g.deletedAt && g.round === round);
        if (already) {
          setPairError('Pairings already exist for this round.');
          setPairing(false);
          return;
        }

        const enginePlayers = participants.map((p) => ({
          id: p.id,
          name: p.name,
          rating: p.rating ?? undefined,
          seed: seedById.get(p.id) ?? p.seed,
        }));
        const pastGames = (games ?? []).map((g) => ({
          round: g.round,
          whiteId: g.whiteId ?? null,
          blackId: g.blackId ?? null,
          result: g.result as GameResult,
          isBye: g.isBye,
        }));
        const { boards } = pairRound('swiss', { players: enginePlayers, pastGames, round });
        const poolId = await ensurePoolCategoryId(id, categories);

        for (const board of boards) {
          await db.games.put({
            id: crypto.randomUUID(),
            tournamentId: id,
            categoryId: poolId,
            round,
            board: board.board,
            whiteId: board.whiteId,
            blackId: board.blackId,
            result: board.isBye ? 'bye' : 'pending',
            isBye: board.isBye,
            resultLockedAt: null,
            updatedAt: now,
            dirty: 1,
          });
        }
      } else {
        const catsToPair = (categories ?? []).filter((cat) => {
          if (cat.deletedAt) return false;
          const count = participants.filter((p) => p.categoryIds?.includes(cat.id)).length;
          if (count < 2) return false;
          return !(games ?? []).some(
            (g) => !g.deletedAt && g.categoryId === cat.id && g.round === round,
          );
        });

        if (catsToPair.length === 0) {
          setPairError('All categories already have pairings for this round.');
          setPairing(false);
          return;
        }

        // Contiguous global table numbers across categories for floor QR stickers.
        let boardOffset = (games ?? [])
          .filter((g) => !g.deletedAt && g.round === round)
          .reduce((max, g) => Math.max(max, g.board), 0);

        for (const cat of catsToPair) {
          const catId = cat.id;
          const relevantParticipants = participants.filter((p) =>
            p.categoryIds?.includes(catId),
          );
          const pastGamesForCat = (games ?? []).filter((g) => g.categoryId === catId);
          const enginePlayers = relevantParticipants.map((p) => ({
            id: p.id,
            name: p.name,
            rating: p.rating ?? undefined,
            seed: seedById.get(p.id) ?? p.seed,
          }));
          const pastGames = pastGamesForCat.map((g) => ({
            round: g.round,
            whiteId: g.whiteId ?? null,
            blackId: g.blackId ?? null,
            result: g.result as GameResult,
            isBye: g.isBye,
          }));
          const { boards } = pairRound('swiss', { players: enginePlayers, pastGames, round });

          let catMax = 0;
          for (const board of boards) {
            const globalBoard = board.board + boardOffset;
            catMax = Math.max(catMax, board.board);
            await db.games.put({
              id: crypto.randomUUID(),
              tournamentId: id,
              categoryId: catId,
              round,
              board: globalBoard,
              whiteId: board.whiteId,
              blackId: board.blackId,
              result: board.isBye ? 'bye' : 'pending',
              isBye: board.isBye,
              resultLockedAt: null,
              updatedAt: now,
              dirty: 1,
            });
          }
          boardOffset += catMax;
        }
      }

      const updatedGames = await db.games
        .where('tournamentId')
        .equals(id)
        .filter((g) => !g.deletedAt)
        .toArray();
      const fullyDone = isTournamentComplete(
        { ...tournament!, rounds: maxRounds, currentRound: round, mixCategories: mix },
        categories ?? [],
        participants,
        updatedGames,
      );

      const tableCount = updatedGames
        .filter((g) => g.round === round)
        .reduce((max, g) => Math.max(max, g.board), 0);

      await db.tournaments.update(id, {
        currentRound: Math.max(tournament?.currentRound ?? 0, round),
        status: fullyDone ? 'completed' : 'in_progress',
        tableCount: Math.max(tournament?.tableCount ?? 0, tableCount),
        updatedAt: now,
        dirty: 1,
      });

      // Issue this round's floor PIN (QR stickers should already exist from pre-pair setup).
      const floorOk = await issueFloorPinForRound(id, round);
      if (!floorOk) {
        setPairError((prev) =>
          prev
            ? `Round paired, but floor PIN failed: ${prev}`
            : 'Round paired, but floor PIN failed. Use “Issue round PIN” on Pairings.',
        );
      }

      setSelectedRound(round);
      setTab('pairings');
    } catch (err) {
      setPairError(err instanceof Error ? err.message : 'Pairing failed');
    } finally {
      setPairing(false);
    }
  }

  const applyDirectorResult = useCallback(
    async (gameId: string, result: GameResult, confirm: boolean, note?: string) => {
      if (!id || !tournament) return;
      const game = (games ?? []).find((g) => g.id === gameId);
      if (!game || !canEditRoundResults(tournament, game.round)) return;
      setResultBusy(true);
      setPairError(null);
      try {
        const res = await apiDirectorSetGameResult(gameId, {
          result,
          confirm: confirm ? true : undefined,
          note: note?.trim() || undefined,
          actorName: auth.displayName || auth.user?.email?.split('@')[0] || 'Director',
        });
        const now = nowIso();
        if (res.ok && res.data) {
          await db.games.update(gameId, {
            result: res.data.result,
            resultEnteredByName: res.data.resultEnteredByName ?? 'Director',
            resultEnteredByRole: 'director',
            resultOverrideCount: res.data.resultOverrideCount ?? game.resultOverrideCount ?? 0,
            resultLockedAt: res.data.resultLockedAt ?? game.resultLockedAt ?? null,
            updatedAt: res.data.updatedAt || now,
            dirty: 0,
          });
        } else {
          const wasEntered = game.result !== 'pending' && game.result !== 'bye';
          await db.games.update(gameId, {
            result,
            resultEnteredByName:
              auth.displayName || auth.user?.email?.split('@')[0] || 'Director',
            resultEnteredByRole: 'director',
            resultOverrideCount:
              (game.resultOverrideCount ?? 0) + (wasEntered && game.result !== result ? 1 : 0),
            updatedAt: now,
            dirty: 1,
          });
          if (res.error && res.error !== 'Network error') {
            setPairError(res.error);
          }
        }
      } finally {
        setResultBusy(false);
        setResultChange(null);
        setResultNote('');
      }
    },
    [id, tournament, games, auth.displayName, auth.user?.email],
  );

  const requestGameResult = useCallback(
    (gameId: string, result: GameResult) => {
      if (!id || !tournament) return;
      const game = (games ?? []).find((g) => g.id === gameId);
      if (!game || !canEditRoundResults(tournament, game.round)) return;
      if (game.result === result) return;
      const entered = game.result !== 'pending' && game.result !== 'bye';
      if (entered || game.resultLockedAt) {
        setResultNote('');
        setResultChange({
          gameId,
          board: game.board,
          from: game.result,
          to: result,
        });
        return;
      }
      void applyDirectorResult(gameId, result, false);
    },
    [id, tournament, games, applyDirectorResult],
  );

  const issueDirectorCard = useCallback(
    async (gameId: string, side: 'white' | 'black', cardType: GameCardType) => {
      if (!id || !tournament) return;
      const game = (games ?? []).find((g) => g.id === gameId);
      if (!game || game.isBye || game.resultLockedAt) return;
      if (!canEditRoundResults(tournament, game.round)) return;
      const pid = side === 'white' ? game.whiteId : game.blackId;
      const playerName = (participants ?? []).find((p) => p.id === pid)?.name;
      const label = cardType === 'warning' ? 'yellow warning' : 'red illegal-move';
      if (!window.confirm(`Issue ${label} card to ${playerName ?? side}?`)) return;
      setCardBusyId(gameId);
      setCardMsg(null);
      setPairError(null);
      try {
        const res = await apiDirectorIssueCard(id, gameId, {
          playerSide: side,
          cardType,
          actorName: auth.displayName || auth.user?.email?.split('@')[0] || 'Director',
        });
        if (!res.ok || !res.data) {
          setPairError(res.error || 'Could not issue card');
          return;
        }
        const now = nowIso();
        await db.games.update(gameId, {
          result: res.data.game.result,
          resultEnteredByName: res.data.game.resultEnteredByName ?? undefined,
          resultEnteredByRole: res.data.game.resultEnteredByRole ?? undefined,
          resultOverrideCount: res.data.game.resultOverrideCount ?? undefined,
          resultLockedAt: res.data.game.resultLockedAt ?? null,
          updatedAt: res.data.game.updatedAt || now,
          dirty: 0,
        });
        const cardsRes = await apiListGameCards(id, displayRound);
        if (cardsRes.ok && cardsRes.data?.cards) setRoundCards(cardsRes.data.cards);
        if (res.data.forfeited) {
          setCardMsg(
            res.data.forfeitReason
              ? `Auto-forfeit: ${res.data.forfeitReason}`
              : 'Auto-forfeit applied',
          );
        }
      } finally {
        setCardBusyId(null);
      }
    },
    [id, tournament, games, participants, auth.displayName, auth.user?.email, displayRound],
  );

  const undoLastDirectorCard = useCallback(
    async (gameId: string, playerId: string) => {
      if (!id || !tournament) return;
      const game = (games ?? []).find((g) => g.id === gameId);
      if (!game) return;
      const cardForfeit =
        Boolean(game.resultLockedAt) &&
        (game.result === '1-0F' || game.result === '0-1F');
      if (!canEditRoundResults(tournament, game.round)) return;
      if (game.result !== 'pending' && !cardForfeit) return;
      const last = [...roundCards]
        .filter((c) => c.gameId === gameId && c.playerId === playerId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!last) return;
      if (!window.confirm('Remove the last card for this player?')) return;
      setCardBusyId(gameId);
      setPairError(null);
      setCardMsg(null);
      try {
        const res = await apiDirectorRemoveCard(id, gameId, last.id);
        if (!res.ok) {
          setPairError(res.error || 'Could not remove card');
          return;
        }
        if (res.data?.game) {
          await db.games.update(gameId, {
            result: res.data.game.result as GameResult,
            resultLockedAt: res.data.game.resultLockedAt ?? null,
            updatedAt: res.data.game.updatedAt || nowIso(),
            dirty: 0,
          });
        }
        const cardsRes = await apiListGameCards(id, displayRound);
        if (cardsRes.ok && cardsRes.data?.cards) setRoundCards(cardsRes.data.cards);
        if (res.data?.unlocked) {
          setCardMsg('Card removed — board unlocked (forfeit cleared).');
        }
      } finally {
        setCardBusyId(null);
      }
    },
    [id, tournament, games, roundCards, displayRound],
  );

  const confirmRoundComplete = useCallback(async () => {
    if (!id || !tournament || !categories || !participants || !games || !caps?.canConfirmRound) {
      return;
    }
    const round = caps.pendingConfirmRound;
    if (round == null) return;
    const now = nowIso();
    const nextConfirmed = round;
    const fullyDone = isTournamentComplete(
      { ...tournament, confirmedRounds: nextConfirmed },
      categories,
      participants,
      games,
    );
    await db.tournaments.update(id, {
      confirmedRounds: nextConfirmed,
      status: fullyDone ? 'completed' : 'in_progress',
      currentRound: Math.max(
        tournament.currentRound,
        highestPairedRound(games),
        fullyDone ? tournament.rounds : 0,
      ),
      updatedAt: now,
      dirty: 1,
    });
  }, [id, tournament, categories, participants, games, caps?.canConfirmRound, caps?.pendingConfirmRound]);

  const undoRoundConfirm = useCallback(async () => {
    if (!id || !tournament || !caps?.canUndoConfirm) return;
    const confirmed = resolvedConfirmedRounds(tournament);
    if (confirmed <= 0) return;
    const now = nowIso();
    await db.tournaments.update(id, {
      confirmedRounds: confirmed - 1,
      status: 'in_progress',
      updatedAt: now,
      dirty: 1,
    });
  }, [id, tournament, caps?.canUndoConfirm]);

  const standings = useMemo(() => {
    if (!participants || !games) return [];
    const toPast = (list: typeof games) =>
      list
        .filter((g) => g.result !== 'pending')
        .map((g) => ({
          round: g.round,
          whiteId: g.whiteId ?? null,
          blackId: g.blackId ?? null,
          result: g.result as GameResult,
          isBye: g.isBye,
        }));
    const toEngine = (list: typeof participants) =>
      list.map((p) => ({
        id: p.id,
        name: p.name,
        rating: p.rating ?? undefined,
        seed: p.seed,
      }));

    try {
      const standingsOpts = {
        tiebreakOrder: (tournament?.tiebreakOrder as TiebreakKey[] | null | undefined) ?? null,
        sharedPlaces: tournament?.sharedPlaces ?? true,
      };
      // Mixed pairing + categories: one field for scores, re-rank within the section.
      if (mix && activeCatId) {
        const sectionIds = new Set(
          participants.filter((p) => p.categoryIds?.includes(activeCatId)).map((p) => p.id),
        );
        if (sectionIds.size === 0) return [];
        return computeSectionStandings(
          toEngine(participants),
          toPast(games),
          sectionIds,
          standingsOpts,
        );
      }

      const catGames = activeCatId
        ? games.filter((g) => g.categoryId === activeCatId)
        : games;
      const catPlayers = activeCatId
        ? participants.filter((p) => p.categoryIds?.includes(activeCatId))
        : participants;
      if (catPlayers.length === 0) return [];
      return computeStandings(toEngine(catPlayers), toPast(catGames), standingsOpts);
    } catch {
      return [];
    }
  }, [participants, games, activeCatId, mix, tournament?.tiebreakOrder, tournament?.sharedPlaces]);

  const endRankById = useMemo(
    () =>
      computeEndRankMap(participants ?? [], games ?? [], {
        mixCategories: mix || !hasCategories,
        tiebreakOrder: (tournament?.tiebreakOrder as TiebreakKey[] | null | undefined) ?? null,
        sharedPlaces: tournament?.sharedPlaces ?? true,
      }),
    [participants, games, mix, hasCategories, tournament?.tiebreakOrder, tournament?.sharedPlaces],
  );

  const standingsEmptyReason = useMemo(() => {
    if (!participants || participants.length === 0) return 'no-players' as const;
    if (activeCatId) {
      const inCat = participants.filter((p) => p.categoryIds?.includes(activeCatId));
      if (inCat.length === 0) return 'no-category-players' as const;
    }
    if (!standings || standings.length === 0) return 'empty' as const;
    return null;
  }, [participants, activeCatId, standings]);

  const prizePlacesN = useMemo(() => {
    if (!tournament) return 3;
    const activeCat = activeCatId
      ? (categories ?? []).find((c) => c.id === activeCatId)
      : undefined;
    return resolvePrizePlaces(tournament, activeCat);
  }, [tournament, categories, activeCatId]);

  if (!tournament) {
    return (
      <div className="page-container">
        <p className="loading-row">Loading tournament…</p>
      </div>
    );
  }

  const importHref =
    caps?.importRequiresLateWarning
      ? `/tournaments/${id}/import?late=1`
      : `/tournaments/${id}/import`;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>{tournament.name}</h1>
          <div className="tournament-meta">
            <span>{tournament.style === 'swiss' ? 'FIDE Swiss' : tournament.style}</span>
            <span>{tournament.rounds} rounds</span>
            <span>{mix ? 'Mixed pairing' : 'Separate categories'}</span>
            {tournament.date && <span>{new Date(tournament.date).toLocaleDateString()}</span>}
            <span className={`status-badge status-${displayStatus}`}>
              {displayStatus.replace('_', ' ')}
            </span>
          </div>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setSettingsOpen(true)}
          >
            Settings
          </button>
          {caps?.canMarkReady && (
            <button type="button" className="btn btn-primary" onClick={markReady}>
              Mark Ready
            </button>
          )}
          {caps?.canImport && (
            <Link
              to={importHref}
              className={`btn ${caps.importRequiresLateWarning ? 'btn-ghost' : 'btn-outline'}`}
            >
              {caps.importRequiresLateWarning ? 'Late entry' : 'Import Players'}
            </Link>
          )}
          <Link to={`/certificates?tournament=${id}`} className="btn btn-outline">
            Certificates
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-danger"
            disabled={deleting}
            onClick={() => void handleDelete()}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div
          className="settings-modal-backdrop"
          role="presentation"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tournament-settings-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-modal-header">
              <h2 id="tournament-settings-title">Tournament settings</h2>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </button>
            </div>
            <dl className="settings-list">
              <div className="settings-row">
                <dt>Name</dt>
                <dd>{tournament.name}</dd>
              </div>
              <div className="settings-row">
                <dt>Date</dt>
                <dd>
                  {tournament.date
                    ? new Date(tournament.date).toLocaleDateString()
                    : '—'}
                </dd>
              </div>
              <div className="settings-row">
                <dt>Pairing style</dt>
                <dd>{tournament.style === 'swiss' ? 'FIDE Swiss' : tournament.style}</dd>
              </div>
              <div className="settings-row">
                <dt>Rounds</dt>
                <dd>{tournament.rounds}</dd>
              </div>
              <div className="settings-row">
                <dt>Category mode</dt>
                <dd>
                  {mix
                    ? 'Mixed pairing — one shared pool; standings stay per category'
                    : 'Separate — pair and rank within each category'}
                </dd>
              </div>
              <div className="settings-row">
                <dt>Prize places (top N)</dt>
                <dd>
                  {tournament.prizePlaces ?? DEFAULT_PRIZE_PLACES}
                  <span className="form-hint-sm">
                    {' '}
                    (default for all rankings)
                  </span>
                </dd>
              </div>
              <div className="settings-row settings-row-block">
                <dt>Tiebreaks</dt>
                <dd>
                  <TiebreakOrderEditor
                    compact
                    order={normalizeTiebreakOrder(
                      (tournament.tiebreakOrder as TiebreakKey[] | null) ?? null,
                    )}
                    sharedPlaces={tournament.sharedPlaces ?? true}
                    onOrderChange={(next) => {
                      void db.tournaments.update(tournament.id, {
                        tiebreakOrder: next,
                        updatedAt: nowIso(),
                        dirty: 1,
                      });
                    }}
                    onSharedPlacesChange={(value) => {
                      void db.tournaments.update(tournament.id, {
                        sharedPlaces: value,
                        updatedAt: nowIso(),
                        dirty: 1,
                      });
                    }}
                  />
                </dd>
              </div>
              <div className="settings-row">
                <dt>Status</dt>
                <dd className={`status-badge status-${displayStatus}`}>
                  {displayStatus.replace('_', ' ')}
                </dd>
              </div>
            </dl>

            <h3 className="settings-subtitle">Categories</h3>
            {(categories?.length ?? 0) === 0 ? (
              <p className="form-hint">No categories — open pool.</p>
            ) : (
              <ul className="settings-categories">
                {categories!.map((cat) => {
                  const effective = resolvePrizePlaces(tournament, cat);
                  const override =
                    cat.prizePlaces != null
                      ? `override ${cat.prizePlaces}`
                      : 'uses default';
                  return (
                    <li key={cat.id} className="settings-category-card">
                      <div className="settings-category-name">{cat.name}</div>
                      <div className="settings-category-meta">
                        Prize places: top {effective}
                        <span className="form-hint-sm"> ({override})</span>
                      </div>
                      <div className="settings-category-filter">
                        {formatFilterSummary(cat.filter)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {mix && (categories?.length ?? 0) > 0 && (
              <p className="form-hint">
                Mixed pairing uses one board pool. Rankings and prize places stay per category.
              </p>
            )}

            <h3 className="settings-subtitle">Public live page</h3>
            <p className="form-hint">
              Share with parents — seating and scores, no login. Search by name to find a table.
            </p>
            <div className="live-share-box">
              {tournament.publicEnabled && tournament.publicToken ? (
                <>
                  <code className="live-share-url">{livePublicUrl(tournament.publicToken)}</code>
                  <div className="live-share-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={liveBusy}
                      onClick={() => void copyLiveLink()}
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      disabled={liveBusy}
                      onClick={() => void rotatePublicLive()}
                    >
                      Rotate link
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={liveBusy}
                      onClick={() => void disablePublicLive()}
                    >
                      Disable
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={liveBusy}
                  onClick={() => void enablePublicLive()}
                >
                  {liveBusy ? 'Working…' : 'Enable live page'}
                </button>
              )}
              {liveMsg && <p className="form-hint">{liveMsg}</p>}
            </div>
          </div>
        </div>
      )}

      {caps && <StageStrip stage={caps.stage} />}

      {caps?.stage === 'completed' && (
        <p className="stage-banner stage-banner-done">
          Tournament complete — pairings and results are locked. View standings below.
        </p>
      )}
      {caps?.importRequiresLateWarning && caps.canImport && (
        <p className="stage-banner stage-banner-warn">
          Event is live. New players can still be added as late entries, but they won’t appear
          in past rounds.
        </p>
      )}
      {instructionSteps.length > 0 && (
        <TournamentInstructions steps={instructionSteps} />
      )}
      {caps?.canMarkReady && (
        <div className="ready-cta">
          <div>
            <h2>Confirm player list</h2>
            <p className="form-hint">
              Mark Ready when registration is final — then create table QR codes before Round 1.
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={markReady}>
            Mark Ready
          </button>
        </div>
      )}

      {hasCategories && (
        <div className="category-tabs">
          {categories!.map((cat) => {
            const pending = !mix ? pendingResultsCountForCategory(games ?? [], cat.id) : 0;
            return (
              <button
                key={cat.id}
                className={`cat-tab ${activeCatId === cat.id ? 'active' : ''}`}
                onClick={() => setSelectedCategoryId(cat.id)}
              >
                {cat.name}
                {pending > 0 && <span className="cat-tab-badge">{pending}</span>}
              </button>
            );
          })}
        </div>
      )}
      {hasCategories && mix && (
        <p className="form-hint category-mode-hint">
          Mixed pairing: everyone shares one board list. Use the tabs for per-category standings
          and prizes.
        </p>
      )}

      <div className="tabs">
        {(['players', 'pairings', 'standings'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'players' && (
        <div className="tab-panel">
          <div className="tab-actions">
            <span className="count-label">{participants?.length ?? 0} participants</span>
            {caps?.canImport && (
              <Link to={importHref} className="btn btn-sm btn-outline">
                {caps.importRequiresLateWarning ? 'Late entry CSV' : 'Import CSV'}
              </Link>
            )}
          </div>
          {(participants?.length ?? 0) > 0 && (
            <TableSearch
              id="player-search"
              value={playerSearch}
              onChange={setPlayerSearch}
              placeholder="Search name, school, city, or rating…"
              resultCount={filteredParticipants.length}
              totalCount={participants?.length}
            />
          )}
          {(!participants || participants.length === 0) ? (
            <div className="empty-state">
              <span className="empty-icon">♟</span>
              <p>No players yet. Import a CSV to continue setup.</p>
              {caps?.canImport && (
                <Link to={importHref} className="btn btn-primary">
                  Import Players
                </Link>
              )}
            </div>
          ) : filteredParticipants.length === 0 ? (
            <div className="empty-state">
              <p>No players match &ldquo;{playerSearch.trim()}&rdquo;.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th title="Start rank">Start</th>
                  <th title="Current / end rank">End</th>
                  <th>Name</th>
                  <th>FIDE</th>
                  <th>YOB</th>
                  <th>School</th>
                  <th>City</th>
                  <th>State</th>
                  <th>Country</th>
                </tr>
              </thead>
              <tbody>
                {filteredParticipants.map((p) => {
                  const startRank = startRankById.get(p.id) ?? p.seed ?? '—';
                  const endRank = endRankById.get(p.id) ?? '—';
                  const yob = displayYearOfBirth(p);
                  return (
                  <tr key={p.id}>
                    <td>{startRank}</td>
                    <td>{endRank}</td>
                    <td>{p.name}</td>
                    <td>{p.rating && p.rating > 0 ? p.rating : '—'}</td>
                    <td>{yob ?? '—'}</td>
                    <td>{displaySchool(p) ?? '—'}</td>
                    <td>{p.city ?? '—'}</td>
                    <td>{p.state ?? '—'}</td>
                    <td>{p.country ?? 'Malaysia'}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'pairings' && (
        <div className="tab-panel">
          {tournament &&
            (caps?.stage === 'ready' ||
              caps?.stage === 'in_progress' ||
              caps?.stage === 'completed') && (
              <div
                className={`floor-panel ${
                  (floorTables?.length ?? 0) > 0 && (tournament.currentRound ?? 0) > 0
                    ? 'floor-panel-live'
                    : 'floor-panel-setup'
                }`}
              >
                {(floorTables?.length ?? 0) === 0 || caps?.stage === 'ready' ? (
                  <>
                    <div className="floor-panel-main">
                      <div className="floor-panel-title-row">
                        <h3>One-time: table QR stickers</h3>
                        <span className="floor-chip floor-chip-warn">Do this before Round 1</span>
                      </div>
                      <p className="form-hint">
                        Print stickers once and leave them on the tables for the whole event. Each
                        round only changes the PIN — you do not recreate QR codes every round.
                      </p>
                      {floorEstimate && !mix && (
                        <p className="form-hint">
                          {floorEstimate.byCategory.map((row) => {
                            const name = categoryNames[row.categoryId] ?? 'Category';
                            return (
                              <span key={row.categoryId} className="floor-estimate-line">
                                {name}: {row.players} player{row.players === 1 ? '' : 's'} →{' '}
                                {row.tables} board{row.tables === 1 ? '' : 's'}.{' '}
                              </span>
                            );
                          })}
                          {floorEstimate.unassignedPlayers > 0 && (
                            <span className="stage-banner-warn">
                              {floorEstimate.unassignedPlayers} player
                              {floorEstimate.unassignedPlayers === 1 ? '' : 's'} match no category —
                              they will not get a table.
                            </span>
                          )}
                        </p>
                      )}
                      {floorEstimate && mix && (
                        <p className="form-hint">
                          Mixed pool: {floorEstimate.totalPlayers} players → {estimatedTables}{' '}
                          boards.
                        </p>
                      )}
                    </div>
                    <div className="floor-panel-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={floorBusy}
                        onClick={() => {
                          void (async () => {
                            if (!id) return;
                            setFloorBusy(true);
                            setPairError(null);
                            try {
                              await createFloorQrTables(id);
                            } finally {
                              setFloorBusy(false);
                            }
                          })();
                        }}
                      >
                        {floorBusy
                          ? 'Working…'
                          : (floorTables?.length ?? 0) > 0
                            ? `QR ready (${floorTables!.length}) — recreate if needed`
                            : `Create table QR codes (${estimatedTables})`}
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={(floorTables?.length ?? 0) === 0}
                        onClick={() => {
                          void (async () => {
                            if (!tournament || !floorTables?.length) return;
                            const bytes = await buildTableStickerPdf(
                              tournament.name,
                              floorTables.map((t) => ({
                                tableNumber: t.tableNumber,
                                slug: t.slug,
                              })),
                            );
                            downloadPdfBytes(
                              `${tournament.name.replace(/\s+/g, '-').toLowerCase()}-table-qr.pdf`,
                              bytes,
                            );
                          })();
                        }}
                      >
                        Download QR stickers
                        {(floorTables?.length ?? 0) > 0 ? ` (${floorTables!.length})` : ''}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="floor-panel-main">
                      <div className="floor-panel-title-row">
                        <h3>This round’s floor PIN</h3>
                        <span className="floor-chip floor-chip-ok">
                          Stickers already set · {floorTables!.length} tables
                        </span>
                      </div>
                      <p className="form-hint">
                        Share this PIN with floor arbiters for Round{' '}
                        {tournament.currentRound}. Stickers on the tables stay the same.
                      </p>
                      {tournament.arbiterPin &&
                      tournament.arbiterPinRound === tournament.currentRound ? (
                        <p className="floor-pin">
                          <span className="floor-pin-label">
                            Round {tournament.arbiterPinRound} PIN
                          </span>
                          <strong>{tournament.arbiterPin}</strong>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              void navigator.clipboard?.writeText(tournament.arbiterPin ?? '');
                            }}
                          >
                            Copy
                          </button>
                        </p>
                      ) : (
                        <p className="form-hint stage-banner-warn">
                          No PIN for Round {tournament.currentRound} yet.
                        </p>
                      )}
                    </div>
                    <div className="floor-panel-actions">
                      {!(
                        tournament.arbiterPin &&
                        tournament.arbiterPinRound === tournament.currentRound
                      ) ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={floorBusy}
                          onClick={() => {
                            void (async () => {
                              if (!id) return;
                              setFloorBusy(true);
                              setPairError(null);
                              try {
                                await issueFloorPinForRound(
                                  id,
                                  tournament.currentRound || displayRound,
                                );
                              } finally {
                                setFloorBusy(false);
                              }
                            })();
                          }}
                        >
                          {floorBusy ? 'Working…' : 'Issue round PIN'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          disabled={floorBusy}
                          onClick={() => {
                            void (async () => {
                              if (!id) return;
                              setFloorBusy(true);
                              setPairError(null);
                              try {
                                const round = tournament.currentRound || displayRound;
                                const res = await apiFloorRotatePin(id, round);
                                if (!res.ok) {
                                  setPairError(res.error);
                                  return;
                                }
                                await db.tournaments.update(id, {
                                  arbiterPin: res.data.arbiterPin,
                                  arbiterPinRound: res.data.arbiterPinRound,
                                  updatedAt: nowIso(),
                                  dirty: 1,
                                });
                              } finally {
                                setFloorBusy(false);
                              }
                            })();
                          }}
                        >
                          Regenerate PIN
                        </button>
                      )}
                      <details className="floor-more">
                        <summary>Need stickers again?</summary>
                        <div className="floor-more-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={(floorTables?.length ?? 0) === 0}
                            onClick={() => {
                              void (async () => {
                                if (!tournament || !floorTables?.length) return;
                                const bytes = await buildTableStickerPdf(
                                  tournament.name,
                                  floorTables.map((t) => ({
                                    tableNumber: t.tableNumber,
                                    slug: t.slug,
                                  })),
                                );
                                downloadPdfBytes(
                                  `${tournament.name.replace(/\s+/g, '-').toLowerCase()}-table-qr.pdf`,
                                  bytes,
                                );
                              })();
                            }}
                          >
                            Download QR stickers ({floorTables!.length})
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={floorBusy}
                            onClick={() => {
                              void (async () => {
                                if (!id) return;
                                setFloorBusy(true);
                                setPairError(null);
                                try {
                                  await createFloorQrTables(id);
                                } finally {
                                  setFloorBusy(false);
                                }
                              })();
                            }}
                          >
                            Add more tables (late entries)
                          </button>
                        </div>
                      </details>
                    </div>
                  </>
                )}
              </div>
            )}

          <div className="pairings-toolbar">
            <div className="round-selector">
              {roundsInPlay.length > 0 && (
                <>
                  <span>Round:</span>
                  {roundsInPlay.map((r) => (
                    <button
                      key={r}
                      className={`round-btn ${displayRound === r ? 'active' : ''}`}
                      onClick={() => setSelectedRound(r)}
                    >
                      {r}
                    </button>
                  ))}
                </>
              )}
            </div>
            <div className="pairings-actions">
              <button
                className="btn btn-primary"
                onClick={generatePairings}
                disabled={
                  pairing ||
                  !caps?.canPair ||
                  (caps?.stage === 'ready' && (floorTables?.length ?? 0) === 0)
                }
                title={
                  caps?.stage === 'ready' && (floorTables?.length ?? 0) === 0
                    ? 'Create table QR codes first'
                    : undefined
                }
              >
                {pairing
                  ? 'Pairing…'
                  : caps?.stage === 'completed'
                    ? 'Tournament complete'
                    : caps?.allRoundsPaired
                      ? 'All rounds paired'
                      : caps?.stage === 'ready' && (floorTables?.length ?? 0) === 0
                        ? 'Create QR codes first'
                        : `Generate Round ${nextPairingRound ?? '—'}`}
              </button>
              {caps?.canConfirmRound && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void confirmRoundComplete()}
                >
                  Confirm Round {caps.pendingConfirmRound} complete
                </button>
              )}
              {caps?.canUndoConfirm && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void undoRoundConfirm()}
                >
                  Undo Round {resolvedConfirmedRounds(tournament!)} confirm
                </button>
              )}
            </div>
          </div>

          {caps?.pendingResultsRound != null && !caps.allRoundsPaired && (
            <p className="form-hint stage-banner-warn">
              Enter all Round {caps.pendingResultsRound} results before confirming the round.
            </p>
          )}
          {caps?.pendingConfirmRound != null && (
            <p className="form-hint stage-banner-warn">
              Round {caps.pendingConfirmRound} results are in. Confirm when scores are final
              {caps.pendingConfirmRound < maxRounds
                ? ` — then you can generate Round ${caps.pendingConfirmRound + 1}`
                : ' to complete the tournament'}
              .
            </p>
          )}

          {caps?.allRoundsPaired && !caps.allResultsDone && (
            <p className="form-hint">
              All {maxRounds} rounds are paired. Enter remaining results, then confirm the final
              round.
            </p>
          )}
          {caps?.stage === 'completed' && (
            <p className="form-hint">Results are locked for this completed tournament.</p>
          )}
          {tournament &&
            caps?.stage !== 'completed' &&
            displayRound <= resolvedConfirmedRounds(tournament) &&
            boardsForRound.length > 0 && (
              <p className="form-hint">
                Round {displayRound} is confirmed — results are locked. Undo confirm if you need
                to change a score (only before the next round is paired).
              </p>
            )}

          {pairError && <div className="form-error">{pairError}</div>}

          {boardsForRound.length > 0 && (
            <TableSearch
              id="board-search"
              value={boardSearch}
              onChange={setBoardSearch}
              placeholder="Search board number or player name…"
              resultCount={filteredBoards.length}
              totalCount={boardsForRound.length}
            />
          )}

          {boardsForRound.length === 0 ? (
            <div className="empty-state">
              <p>
                {caps?.showStartHint
                  ? 'No pairings yet. Generate Round 1 when you are ready to start.'
                  : 'No pairings for this round.'}
              </p>
            </div>
          ) : filteredBoards.length === 0 ? (
            <div className="empty-state">
              <p>No boards match &ldquo;{boardSearch.trim()}&rdquo;.</p>
            </div>
          ) : (
            <>
            {cardMsg && (
              <p className="form-hint stage-banner-warn" role="status">
                {cardMsg}
              </p>
            )}
            <div className="boards-list">
              {filteredBoards.map((game) => {
                const white = game.whiteId ? playerById.get(game.whiteId) : null;
                const black = game.blackId ? playerById.get(game.blackId) : null;
                const gameCards = roundCards.filter((c) => c.gameId === game.id);
                const whiteCounts = game.whiteId
                  ? countCardsForPlayer(gameCards, game.whiteId)
                  : emptyCardCounts();
                const blackCounts = game.blackId
                  ? countCardsForPlayer(gameCards, game.blackId)
                  : emptyCardCounts();
                const cardForfeitLocked =
                  Boolean(game.resultLockedAt) &&
                  (game.result === '1-0F' || game.result === '0-1F');
                const canCard =
                  Boolean(tournament) &&
                  !game.isBye &&
                  !game.resultLockedAt &&
                  game.result === 'pending' &&
                  canEditRoundResults(tournament!, game.round);
                const canUndoCard =
                  Boolean(tournament) &&
                  !game.isBye &&
                  canEditRoundResults(tournament!, game.round) &&
                  (canCard || cardForfeitLocked);
                return (
                  <div key={game.id} className={`board-card ${game.isBye ? 'board-bye' : ''}`}>
                    <div className="board-card-head">
                      <span className="board-num">Table {game.board}</span>
                      <div className="board-badges">
                        {game.resultLockedAt ? (
                          <span className="board-locked-tag">Locked</span>
                        ) : null}
                        {game.resultEnteredByRole === 'floor' && game.resultEnteredByName ? (
                          <span className="board-attr-tag" title="Entered by floor arbiter">
                            Floor · {game.resultEnteredByName}
                          </span>
                        ) : null}
                        {(game.resultOverrideCount ?? 0) > 0 ||
                        game.resultEnteredByRole === 'director' ? (
                          <span className="board-attr-tag board-attr-director">
                            {(game.resultOverrideCount ?? 0) > 0
                              ? `Edited by director ×${game.resultOverrideCount}`
                              : 'Director'}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="board-matchup">
                      <div className="player-row player-row-white">
                        <ColorSide color="white" size="md" />
                        <span className="player-name">{white?.name ?? '—'}</span>
                        {white?.rating != null && (
                          <span className="rating-tag">{white.rating}</span>
                        )}
                        {!game.isBye && (
                          <div className="desk-card-row">
                            <span className="floor-card-chip floor-card-yellow">
                              🟡 {whiteCounts.warning}/{WARNING_LIMIT}
                            </span>
                            <span className="floor-card-chip floor-card-red">
                              🔴 {whiteCounts.illegalMove}/{ILLEGAL_MOVE_LIMIT}
                            </span>
                            {canCard && (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-sm floor-btn-yellow"
                                  disabled={cardBusyId === game.id}
                                  onClick={() =>
                                    void issueDirectorCard(game.id, 'white', 'warning')
                                  }
                                >
                                  Warning
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm floor-btn-red"
                                  disabled={cardBusyId === game.id}
                                  onClick={() =>
                                    void issueDirectorCard(game.id, 'white', 'illegal_move')
                                  }
                                >
                                  Illegal
                                </button>
                              </>
                            )}
                            {canUndoCard &&
                              (whiteCounts.warning > 0 || whiteCounts.illegalMove > 0) &&
                              game.whiteId && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-ghost"
                                  disabled={cardBusyId === game.id}
                                  onClick={() =>
                                    void undoLastDirectorCard(game.id, game.whiteId!)
                                  }
                                >
                                  Undo last
                                </button>
                              )}
                          </div>
                        )}
                      </div>
                      {!game.isBye && (
                        <div className="player-row player-row-black">
                          <ColorSide color="black" onDark size="md" />
                          <span className="player-name">{black?.name ?? '—'}</span>
                          {black?.rating != null && (
                            <span className="rating-tag">{black.rating}</span>
                          )}
                          <div className="desk-card-row">
                            <span className="floor-card-chip floor-card-yellow">
                              🟡 {blackCounts.warning}/{WARNING_LIMIT}
                            </span>
                            <span className="floor-card-chip floor-card-red">
                              🔴 {blackCounts.illegalMove}/{ILLEGAL_MOVE_LIMIT}
                            </span>
                            {canCard && (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-sm floor-btn-yellow"
                                  disabled={cardBusyId === game.id}
                                  onClick={() =>
                                    void issueDirectorCard(game.id, 'black', 'warning')
                                  }
                                >
                                  Warning
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm floor-btn-red"
                                  disabled={cardBusyId === game.id}
                                  onClick={() =>
                                    void issueDirectorCard(game.id, 'black', 'illegal_move')
                                  }
                                >
                                  Illegal
                                </button>
                              </>
                            )}
                            {canUndoCard &&
                              (blackCounts.warning > 0 || blackCounts.illegalMove > 0) &&
                              game.blackId && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-ghost"
                                  disabled={cardBusyId === game.id}
                                  onClick={() =>
                                    void undoLastDirectorCard(game.id, game.blackId!)
                                  }
                                >
                                  Undo last
                                </button>
                              )}
                          </div>
                        </div>
                      )}
                    </div>
                    <ResultSelector
                      value={game.result}
                      onChange={(r) => requestGameResult(game.id, r)}
                      isBye={game.isBye}
                      locked={Boolean(game.resultLockedAt)}
                      readOnly={
                        !tournament || !canEditRoundResults(tournament, game.round)
                      }
                    />
                  </div>
                );
              })}
            </div>
            </>
          )}
        </div>
      )}

      {resultChange && (
        <div className="modal-backdrop" role="presentation" onClick={() => !resultBusy && setResultChange(null)}>
          <div
            className="modal-card result-change-modal"
            role="dialog"
            aria-modal
            aria-labelledby="result-change-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="result-change-title">Change Table {resultChange.board} result?</h2>
            <p className="form-hint">
              From <strong>{resultChange.from}</strong> to <strong>{resultChange.to}</strong>.
              This is recorded as a director edit.
            </p>
            <label>
              Note (optional)
              <input
                className="input"
                value={resultNote}
                onChange={(e) => setResultNote(e.target.value)}
                maxLength={200}
                placeholder="e.g. Floor arbiter mistype"
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={resultBusy}
                onClick={() => setResultChange(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={resultBusy}
                onClick={() =>
                  void applyDirectorResult(
                    resultChange.gameId,
                    resultChange.to,
                    true,
                    resultNote,
                  )
                }
              >
                {resultBusy ? 'Saving…' : 'Confirm change'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'standings' && (
        <div className="tab-panel">
          {standingsEmptyReason ? (
            <div className="empty-state">
              <p>
                {standingsEmptyReason === 'no-players'
                  ? 'No players yet — import a roster to build standings.'
                  : standingsEmptyReason === 'no-category-players'
                    ? `No players are assigned to ${categoryNames[activeCatId] ?? 'this category'}. Switch tabs or re-import so ages/categories match your filters.`
                    : caps?.stage === 'completed'
                      ? 'No standings available.'
                      : 'No results recorded yet.'}
              </p>
            </div>
          ) : (
            <>
              <div className="standings-heading-row">
                <p className="form-hint standings-prize-hint">
                  Prize places: top {prizePlacesN}
                  {activeCatId && categoryNames[activeCatId]
                    ? ` · ${categoryNames[activeCatId]}`
                    : ''}
                </p>
                <TiebreakRulesHelp
                  order={(tournament?.tiebreakOrder as TiebreakKey[] | null) ?? null}
                  sharedPlaces={tournament?.sharedPlaces ?? true}
                />
              </div>
              <table className="data-table standings-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Name</th>
                    <th>Score</th>
                    <th title="Buchholz">BH</th>
                    <th title="Buchholz Cut-1">BH-C1</th>
                    <th title="Sonneborn-Berger">SB</th>
                    <th title="Progressive">Prog</th>
                    <th title="Wins">Wins</th>
                    <th>Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((s) => {
                    const isPrize = s.rank <= prizePlacesN;
                    const rowClass = [
                      isPrize ? 'rank-prize' : '',
                      s.rank === 1 ? 'rank-1' : '',
                      s.rank === 2 ? 'rank-2' : '',
                      s.rank === 3 ? 'rank-3' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <tr key={s.id} className={rowClass}>
                        <td className="rank-cell">
                          {s.rank === 1
                            ? '🥇'
                            : s.rank === 2
                              ? '🥈'
                              : s.rank === 3
                                ? '🥉'
                                : s.rank}
                          {isPrize && s.rank > 3 && (
                            <span className="prize-tag">Prize</span>
                          )}
                        </td>
                        <td>{s.name}</td>
                        <td className="score-cell">{s.score}</td>
                        <td>{s.buchholz.toFixed(1)}</td>
                        <td>{s.buchholzCut1.toFixed(1)}</td>
                        <td>{s.sonnebornBerger.toFixed(1)}</td>
                        <td>{s.progressive.toFixed(1)}</td>
                        <td>{s.wins}</td>
                        <td>{s.rating || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
