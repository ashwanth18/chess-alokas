import { useState, useCallback, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { pairRound, computeStandings } from '@chess-alokas/pairing-engine';
import type { GameResult } from '@chess-alokas/shared';
import { db, nowIso } from '../db/local';
import ColorHorse from '../components/ColorHorse';
import {
  effectiveTournamentStatus,
  getNextPairingRound,
  getTournamentCapabilities,
  highestPairedRound,
  isMixedTournament,
  isTournamentComplete,
  MIXED_POOL_ID,
} from '../lib/tournamentProgress';

type Tab = 'players' | 'pairings' | 'standings';

function ResultSelector({
  value,
  onChange,
  isBye,
  readOnly,
}: {
  value: string;
  onChange: (r: GameResult) => void;
  isBye: boolean;
  readOnly?: boolean;
}) {
  if (isBye) return <span className="result-bye">BYE (1pt)</span>;
  if (readOnly) {
    return <span className="result-readonly">{value === 'pending' ? '—' : value}</span>;
  }
  const options: GameResult[] = ['1-0', '0-1', '1/2-1/2'];
  return (
    <div className="result-selector">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`result-btn ${value === opt ? 'active' : ''}`}
          onClick={() => onChange(opt)}
        >
          {opt}
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
  const [tab, setTab] = useState<Tab>('players');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedRound, setSelectedRound] = useState<number>(1);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);

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
      tournament.status === 'completed' &&
      !caps.allResultsDone
    ) {
      void db.tournaments.update(id, {
        status: 'in_progress',
        updatedAt: nowIso(),
        dirty: 1,
      });
    }
  }, [id, tournament, categories, participants, games, caps]);

  const boardsForRound = (games ?? [])
    .filter((g) => {
      if (g.round !== displayRound) return false;
      if (mix) return true;
      return !activeCatId || g.categoryId === activeCatId;
    })
    .sort((a, b) => a.board - b.board);

  const playerById = new Map((participants ?? []).map((p) => [p.id, p]));

  async function markReady() {
    if (!id || !caps?.canMarkReady) return;
    await db.tournaments.update(id, {
      status: 'ready',
      updatedAt: nowIso(),
      dirty: 1,
    });
    setTab('pairings');
  }

  async function generatePairings() {
    if (!id || !participants || !caps?.canPair) {
      setPairError(
        !participants || participants.length < 2
          ? 'Need at least 2 participants to generate pairings.'
          : caps?.stage === 'completed'
            ? 'This tournament is complete.'
            : `This tournament is set to ${maxRounds} round${maxRounds === 1 ? '' : 's'}.`,
      );
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
        const poolId = categories?.[0]?.id ?? MIXED_POOL_ID;

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

          for (const board of boards) {
            await db.games.put({
              id: crypto.randomUUID(),
              tournamentId: id,
              categoryId: catId,
              round,
              board: board.board,
              whiteId: board.whiteId,
              blackId: board.blackId,
              result: board.isBye ? 'bye' : 'pending',
              isBye: board.isBye,
              updatedAt: now,
              dirty: 1,
            });
          }
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

      await db.tournaments.update(id, {
        currentRound: Math.max(tournament?.currentRound ?? 0, round),
        status: fullyDone ? 'completed' : 'in_progress',
        updatedAt: now,
        dirty: 1,
      });

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
      if (!id || !caps?.canEditResults) return;
      const now = nowIso();
      await db.games.update(gameId, { result, updatedAt: now, dirty: 1 });

      if (!tournament || !categories || !participants) return;
      const updatedGames = await db.games
        .where('tournamentId')
        .equals(id)
        .filter((g) => !g.deletedAt)
        .toArray();
      if (isTournamentComplete(tournament, categories, participants, updatedGames)) {
        await db.tournaments.update(id, {
          status: 'completed',
          currentRound: Math.max(
            tournament.currentRound,
            highestPairedRound(updatedGames),
            tournament.rounds,
          ),
          updatedAt: now,
          dirty: 1,
        });
      }
    },
    [id, caps?.canEditResults, tournament, categories, participants],
  );

  const standings = useLiveQuery(() => {
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
        </div>
      </div>

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
      {caps?.showStartHint && caps.stage === 'ready' && (
        <p className="stage-banner">
          Ready to play — open Pairings and generate Round 1 when the hall is set.
        </p>
      )}

      {hasCategories && !mix && (
        <div className="category-tabs">
          {categories!.map((cat) => (
            <button
              key={cat.id}
              className={`cat-tab ${activeCatId === cat.id ? 'active' : ''}`}
              onClick={() => setSelectedCategoryId(cat.id)}
            >
              {cat.name}
            </button>
          ))}
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
                {participants.map((p, i) => (
                  <tr key={p.id}>
                    <td>{i + 1}</td>
                    <td>{p.name}</td>
                    <td>{p.rating ?? '—'}</td>
                    <td>{p.age}</td>
                    <td>{p.gender ?? '—'}</td>
                    <td>{p.club ?? '—'}</td>
                  </tr>
                ))}
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
          </div>

          {caps?.allRoundsPaired && !caps.allResultsDone && (
            <p className="form-hint">
              All {maxRounds} rounds are paired. Enter remaining results to complete the
              tournament.
            </p>
          )}
          {caps?.stage === 'completed' && (
            <p className="form-hint">Results are locked for this completed tournament.</p>
          )}

          {pairError && <div className="form-error">{pairError}</div>}

          {boardsForRound.length === 0 ? (
            <div className="empty-state">
              <p>
                {caps?.showStartHint
                  ? 'No pairings yet. Generate Round 1 when you are ready to start.'
                  : 'No pairings for this round.'}
              </p>
            </div>
          ) : (
            <div className="boards-list">
              {boardsForRound.map((game) => {
                const white = game.whiteId ? playerById.get(game.whiteId) : null;
                const black = game.blackId ? playerById.get(game.blackId) : null;
                return (
                  <div key={game.id} className={`board-card ${game.isBye ? 'board-bye' : ''}`}>
                    <span className="board-num">Board {game.board}</span>
                    <div className="board-players">
                      <span className="player-white">
                        <ColorHorse color="white" />
                        {white?.name ?? '—'}
                        {white?.rating && <span className="rating-tag">{white.rating}</span>}
                      </span>
                      <span className="vs-sep">vs</span>
                      <span className="player-black">
                        <ColorHorse color="black" />
                        {black?.name ?? (game.isBye ? 'BYE' : '—')}
                        {black?.rating && <span className="rating-tag">{black.rating}</span>}
                      </span>
                    </div>
                    <ResultSelector
                      value={game.result}
                      onChange={(r) => updateGameResult(game.id, r)}
                      isBye={game.isBye}
                      readOnly={!caps?.canEditResults}
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
          {(!standings || standings.length === 0) ? (
            <div className="empty-state">
              <p>
                {caps?.stage === 'completed'
                  ? 'No standings available.'
                  : 'No results recorded yet.'}
              </p>
            </div>
          ) : (
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
                {standings.map((s) => (
                  <tr key={s.id} className={s.rank <= 3 ? `rank-${s.rank}` : ''}>
                    <td className="rank-cell">
                      {s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : s.rank === 3 ? '🥉' : s.rank}
                    </td>
                    <td>{s.name}</td>
                    <td className="score-cell">{s.score}</td>
                    <td>{s.buchholz.toFixed(1)}</td>
                    <td>{s.rating || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
