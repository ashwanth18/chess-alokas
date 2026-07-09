import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { pairRound, computeStandings } from '@chess-alokas/pairing-engine';
import type { GameResult } from '@chess-alokas/shared';
import { db, nowIso } from '../db/local';
import type { LocalParticipant, LocalGame } from '../db/local';

type Tab = 'players' | 'pairings' | 'standings';

function ResultSelector({
  value,
  onChange,
  isBye,
}: {
  value: string;
  onChange: (r: GameResult) => void;
  isBye: boolean;
}) {
  if (isBye) return <span className="result-bye">BYE (1pt)</span>;
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

  const activeCatId = selectedCategoryId || categories?.[0]?.id || '';

  const roundsInPlay = games
    ? [...new Set(games.map((g) => g.round))].sort((a, b) => a - b)
    : [];
  const displayRound = selectedRound || (tournament?.currentRound ?? 1);

  const boardsForRound = (games ?? [])
    .filter((g) => g.round === displayRound && (!activeCatId || g.categoryId === activeCatId))
    .sort((a, b) => a.board - b.board);

  const playerById = new Map((participants ?? []).map((p) => [p.id, p]));

  async function generatePairings() {
    if (!id || !participants || participants.length < 2) {
      setPairError('Need at least 2 participants to generate pairings.');
      return;
    }
    setPairing(true);
    setPairError(null);

    try {
      const round = (tournament?.currentRound ?? 0) + 1;
      const catId = activeCatId;

      const relevantParticipants = catId
        ? participants.filter((p) => p.categoryIds?.includes(catId))
        : participants;

      if (relevantParticipants.length < 2) {
        setPairError('Not enough participants in this category.');
        setPairing(false);
        return;
      }

      const pastGamesForCat = (games ?? []).filter(
        (g) => !catId || g.categoryId === catId,
      );

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

      const now = nowIso();
      for (const board of boards) {
        await db.games.put({
          id: crypto.randomUUID(),
          tournamentId: id,
          categoryId: catId || id,
          round,
          board: board.board,
          whiteId: board.whiteId,
          blackId: board.blackId,
          result: 'pending',
          isBye: board.isBye,
          updatedAt: now,
          dirty: 1,
        });
      }

      await db.tournaments.update(id, {
        currentRound: round,
        status: 'in_progress',
        updatedAt: now,
        dirty: 1,
      });

      setSelectedRound(round);
    } catch (err) {
      setPairError(err instanceof Error ? err.message : 'Pairing failed');
    } finally {
      setPairing(false);
    }
  }

  const updateGameResult = useCallback(
    async (gameId: string, result: GameResult) => {
      await db.games.update(gameId, { result, updatedAt: nowIso(), dirty: 1 });
    },
    [],
  );

  const standings = useLiveQuery(() => {
    if (!participants || !games) return [];
    const catGames = activeCatId
      ? games.filter((g) => g.categoryId === activeCatId)
      : games;
    const catPlayers = activeCatId
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
  }, [participants, games, activeCatId]);

  if (!tournament) {
    return (
      <div className="page-container">
        <p className="loading-row">Loading tournament…</p>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>{tournament.name}</h1>
          <div className="tournament-meta">
            <span>{tournament.style === 'swiss' ? 'FIDE Swiss' : tournament.style}</span>
            <span>{tournament.rounds} rounds</span>
            {tournament.date && <span>{new Date(tournament.date).toLocaleDateString()}</span>}
            <span className={`status-badge status-${tournament.status}`}>
              {tournament.status.replace('_', ' ')}
            </span>
          </div>
        </div>
        <Link to={`/tournaments/${id}/import`} className="btn btn-outline">
          Import Players
        </Link>
      </div>

      {categories && categories.length > 0 && (
        <div className="category-tabs">
          <button
            className={`cat-tab ${activeCatId === '' ? 'active' : ''}`}
            onClick={() => setSelectedCategoryId('')}
          >
            All
          </button>
          {categories.map((cat) => (
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
            <Link to={`/tournaments/${id}/import`} className="btn btn-sm btn-outline">
              Import CSV
            </Link>
          </div>
          {(!participants || participants.length === 0) ? (
            <div className="empty-state">
              <span className="empty-icon">♟</span>
              <p>No players yet. Import a CSV to add participants.</p>
              <Link to={`/tournaments/${id}/import`} className="btn btn-primary">
                Import Players
              </Link>
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
              disabled={pairing || !participants || participants.length < 2}
            >
              {pairing ? 'Pairing…' : `Generate Round ${(tournament.currentRound ?? 0) + 1}`}
            </button>
          </div>

          {pairError && <div className="form-error">{pairError}</div>}

          {boardsForRound.length === 0 ? (
            <div className="empty-state">
              <p>No pairings for this round. Generate them above.</p>
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
                        <span className="color-dot white" />
                        {white?.name ?? '—'}
                        {white?.rating && <span className="rating-tag">{white.rating}</span>}
                      </span>
                      <span className="vs-sep">vs</span>
                      <span className="player-black">
                        <span className="color-dot black" />
                        {black?.name ?? (game.isBye ? 'BYE' : '—')}
                        {black?.rating && <span className="rating-tag">{black.rating}</span>}
                      </span>
                    </div>
                    <ResultSelector
                      value={game.result}
                      onChange={(r) => updateGameResult(game.id, r)}
                      isBye={game.isBye}
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
              <p>No results recorded yet.</p>
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
