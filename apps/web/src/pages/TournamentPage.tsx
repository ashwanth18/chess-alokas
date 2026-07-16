import { useState, useCallback, useEffect, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { pairRound, computeStandings } from '@chess-alokas/pairing-engine';
import type { FilterGroup, FilterOp, GameResult } from '@chess-alokas/shared';
import { db, nowIso } from '../db/local';
import ColorSide from '../components/ColorSide';
import {
  effectiveTournamentStatus,
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
import { matchesTextSearch } from '../lib/textSearch';
import { softDeleteTournament } from '../lib/deleteTournament';
import { ensurePoolCategoryId, repairTournamentLocalData } from '../lib/poolCategory';
import { DEFAULT_PRIZE_PLACES, resolvePrizePlaces } from '../lib/prizePlaces';
import { apiFloorPrepare, apiFloorRotatePin, apiFloorListTables } from '../api/client';
import { syncOnline } from '../sync/sync';
import {
  buildTableStickerPdf,
  downloadPdfBytes,
} from '../lib/tableStickers';

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
  const [playerSearch, setPlayerSearch] = useState('');
  const [boardSearch, setBoardSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

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
  const activeCatId = mix ? '' : selectedCategoryId || categories?.[0]?.id || '';

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
  const instructionSteps =
    tournament && categories && participants && games && caps && caps.stage !== 'completed'
      ? getTournamentInstructions(
          tournament,
          categories,
          participants,
          games,
          caps,
          categoryNames,
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

  // Pull floor arbiter results while the tournament is live.
  useEffect(() => {
    if (!id || !tournament || caps?.stage !== 'in_progress') return;
    let cancelled = false;
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
    void tick();
    const handle = window.setInterval(() => void tick(), 20_000);
    const onFocus = () => void tick();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
      window.removeEventListener('focus', onFocus);
    };
  }, [id, tournament?.id, caps?.stage, floorTables?.length]);

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

  const boardsForRound = (games ?? [])
    .filter((g) => {
      if (g.round !== displayRound) return false;
      if (mix) return true;
      return !activeCatId || g.categoryId === activeCatId;
    })
    .sort((a, b) => a.board - b.board);

  const playerById = new Map((participants ?? []).map((p) => [p.id, p]));

  const filteredParticipants = (participants ?? []).filter((p) =>
    matchesTextSearch(playerSearch, p.name, p.club, p.rating),
  );

  const filteredBoards = boardsForRound.filter((game) => {
    const white = game.whiteId ? playerById.get(game.whiteId) : null;
    const black = game.blackId ? playerById.get(game.blackId) : null;
    return matchesTextSearch(boardSearch, game.board, white?.name, black?.name);
  });

  async function markReady() {
    if (!id || !caps?.canMarkReady) return;
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

  async function prepareFloorScoring(
    tournamentId: string,
    tableCount: number,
    pinRound: number,
  ): Promise<boolean> {
    try {
      await syncOnline();
      const floor = await apiFloorPrepare(tournamentId, {
        tableCount: Math.max(1, tableCount),
        pinRound,
        rotatePin: true,
      });
      if (!floor.ok) {
        setPairError(floor.error || 'Floor PIN/QR setup failed');
        return false;
      }
      await db.tournamentTables.where('tournamentId').equals(tournamentId).delete();
      for (const t of floor.data.tables) {
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
        arbiterPin: floor.data.arbiterPin,
        arbiterPinRound: floor.data.arbiterPinRound,
        tableCount: floor.data.tableCount,
        updatedAt: nowIso(),
        dirty: 1,
      });
      return true;
    } catch (err) {
      setPairError(
        err instanceof Error
          ? `Floor setup failed: ${err.message}`
          : 'Floor PIN/QR setup failed (sync/online required)',
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
          seed: p.seed,
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
            seed: p.seed,
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

      // Push pairings, then rotate floor PIN + ensure QR table stations on the server.
      const floorOk = await prepareFloorScoring(id, Math.max(1, tableCount), round);
      if (!floorOk) {
        setPairError((prev) =>
          prev
            ? `Round paired, but floor setup failed: ${prev}`
            : 'Round paired, but floor PIN/QR setup failed. Open Pairings and click “Setup floor PIN & QR”.',
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

  const updateGameResult = useCallback(
    async (gameId: string, result: GameResult) => {
      if (!id || !tournament) return;
      const game = (games ?? []).find((g) => g.id === gameId);
      if (!game || !canEditRoundResults(tournament, game.round)) return;
      const now = nowIso();
      await db.games.update(gameId, { result, updatedAt: now, dirty: 1 });
    },
    [id, tournament, games],
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
    const catGames = mix
      ? games
      : activeCatId
        ? games.filter((g) => g.categoryId === activeCatId)
        : games;
    const catPlayers = mix
      ? participants
      : activeCatId
        ? participants.filter((p) => p.categoryIds?.includes(activeCatId))
        : participants;
    if (catPlayers.length === 0) return [];
    const enginePlayers = catPlayers.map((p) => ({
      id: p.id,
      name: p.name,
      rating: p.rating ?? undefined,
      seed: p.seed,
    }));
    const pastGames = catGames
      .filter((g) => g.result !== 'pending')
      .map((g) => ({
        round: g.round,
        whiteId: g.whiteId ?? null,
        blackId: g.blackId ?? null,
        result: g.result as GameResult,
        isBye: g.isBye,
      }));
    try {
      return computeStandings(enginePlayers, pastGames);
    } catch {
      return [];
    }
  }, [participants, games, activeCatId, mix]);

  const standingsEmptyReason = useMemo(() => {
    if (!participants || participants.length === 0) return 'no-players' as const;
    if (!mix && activeCatId) {
      const inCat = participants.filter((p) => p.categoryIds?.includes(activeCatId));
      if (inCat.length === 0) return 'no-category-players' as const;
    }
    if (!standings || standings.length === 0) return 'empty' as const;
    return null;
  }, [participants, mix, activeCatId, standings]);

  const prizePlacesN = useMemo(() => {
    if (!tournament) return 3;
    const activeCat =
      !mix && activeCatId
        ? (categories ?? []).find((c) => c.id === activeCatId)
        : undefined;
    return resolvePrizePlaces(tournament, activeCat, { mix });
  }, [tournament, categories, activeCatId, mix]);

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
            <span>{mix ? 'Mixed categories' : 'Separate categories'}</span>
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
                    ? 'Mixed — one shared pairing pool and ranking'
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
                  const effective = resolvePrizePlaces(tournament, cat, { mix });
                  const override =
                    !mix && cat.prizePlaces != null
                      ? `override ${cat.prizePlaces}`
                      : 'uses default';
                  return (
                    <li key={cat.id} className="settings-category-card">
                      <div className="settings-category-name">{cat.name}</div>
                      <div className="settings-category-meta">
                        Prize places: top {effective}
                        {!mix && (
                          <span className="form-hint-sm"> ({override})</span>
                        )}
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
                Mixed mode ignores per-category prize overrides — one ranking uses the
                tournament top N.
              </p>
            )}
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

      {hasCategories && !mix && (
        <div className="category-tabs">
          {categories!.map((cat) => {
            const pending = pendingResultsCountForCategory(games ?? [], cat.id);
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
          Mixed mode: all categories share one pairing pool and one ranking.
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
              placeholder="Search name, club, or rating…"
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
                  <th>#</th>
                  <th>Name</th>
                  <th>Rating</th>
                  <th>Age</th>
                  <th>Gender</th>
                  <th>Club</th>
                </tr>
              </thead>
              <tbody>
                {filteredParticipants.map((p) => {
                  const rosterNum =
                    (participants ?? []).findIndex((x) => x.id === p.id) + 1;
                  return (
                  <tr key={p.id}>
                    <td>{rosterNum}</td>
                    <td>{p.name}</td>
                    <td>{p.rating ?? '—'}</td>
                    <td>{p.age}</td>
                    <td>{p.gender ?? '—'}</td>
                    <td>{p.club ?? '—'}</td>
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
                disabled={pairing || !caps?.canPair}
              >
                {pairing
                  ? 'Pairing…'
                  : caps?.stage === 'completed'
                    ? 'Tournament complete'
                    : caps?.allRoundsPaired
                      ? 'All rounds paired'
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

          {tournament &&
            (tournament.currentRound ?? 0) > 0 &&
            (caps?.stage === 'in_progress' || caps?.stage === 'completed') && (
              <div className="floor-panel">
                <div className="floor-panel-main">
                  <h3>Floor arbiter</h3>
                  <p className="form-hint">
                    Stick QR codes on tables. Arbiters scan, enter this round&apos;s PIN, then
                    confirm results. PIN changes every new round. Requires online sync.
                  </p>
                  {tournament.arbiterPin &&
                  tournament.arbiterPinRound === tournament.currentRound ? (
                    <p className="floor-pin">
                      Round {tournament.arbiterPinRound} PIN:{' '}
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
                      No PIN yet for this round. Click <strong>Setup floor PIN &amp; QR</strong>{' '}
                      (must be signed in and online).
                    </p>
                  )}
                  {(floorTables?.length ?? 0) === 0 && (
                    <p className="form-hint">
                      No QR table stations yet — setup creates one QR per board.
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
                        if (!id || !tournament) return;
                        setFloorBusy(true);
                        setPairError(null);
                        try {
                          const round = tournament.currentRound || displayRound;
                          const tableCount = Math.max(
                            1,
                            tournament.tableCount ?? 0,
                            (games ?? [])
                              .filter((g) => g.round === round && !g.deletedAt)
                              .reduce((max, g) => Math.max(max, g.board), 0),
                          );
                          const ok = await prepareFloorScoring(id, tableCount, round);
                          if (!ok) return;
                        } finally {
                          setFloorBusy(false);
                        }
                      })();
                    }}
                  >
                    {floorBusy ? 'Setting up…' : 'Setup floor PIN & QR'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={floorBusy || !tournament.arbiterPin}
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
                    {(floorTables?.length ?? 0) > 0
                      ? ` (${floorTables!.length})`
                      : ''}
                  </button>
                </div>
              </div>
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
            <div className="boards-list">
              {filteredBoards.map((game) => {
                const white = game.whiteId ? playerById.get(game.whiteId) : null;
                const black = game.blackId ? playerById.get(game.blackId) : null;
                return (
                  <div key={game.id} className={`board-card ${game.isBye ? 'board-bye' : ''}`}>
                    <span className="board-num">
                      Table {game.board}
                      {game.resultLockedAt ? (
                        <span className="board-locked-tag" title="Confirmed by floor arbiter">
                          {' '}
                          locked
                        </span>
                      ) : null}
                    </span>
                    <div className="board-matchup">
                      <div className="player-row player-row-white">
                        <ColorSide color="white" />
                        <span className="player-name">{white?.name ?? '—'}</span>
                        {white?.rating != null && (
                          <span className="rating-tag">{white.rating}</span>
                        )}
                      </div>
                      {!game.isBye && (
                        <div className="player-row player-row-black">
                          <ColorSide color="black" onDark />
                          <span className="player-name">{black?.name ?? '—'}</span>
                          {black?.rating != null && (
                            <span className="rating-tag">{black.rating}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <ResultSelector
                      value={game.result}
                      onChange={(r) => updateGameResult(game.id, r)}
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
          )}
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
              <p className="form-hint standings-prize-hint">
                Prize places: top {prizePlacesN}
                {!mix && activeCatId && categoryNames[activeCatId]
                  ? ` · ${categoryNames[activeCatId]}`
                  : ''}
              </p>
              <table className="data-table standings-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Name</th>
                    <th>Score</th>
                    <th>Buchholz</th>
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
