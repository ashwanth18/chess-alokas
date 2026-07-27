import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  apiPublicLiveGet,
  checkOnline,
  type PublicLivePayload,
} from '../api/client';
import ColorSide from '../components/ColorSide';
import TableSearch from '../components/TableSearch';
import { matchesTextSearch } from '../lib/textSearch';
import {
  buildPlayerHistory,
  computeLiveStandings,
  formatResultLabel,
  gameForPlayerRound,
  resultPointsLabel,
  runningScore,
} from '../lib/liveViewer';
import { resolvePrizePlaces } from '../lib/prizePlaces';

type LiveTab = 'boards' | 'standings';

function networkErrorMessage(raw: string): string {
  if (/abort|timeout|timed out|failed to fetch|network|load failed|offline/i.test(raw)) {
    return 'No connection — reconnect to refresh pairings and scores.';
  }
  return raw;
}

export default function LivePage() {
  const { token = '', playerId } = useParams<{ token: string; playerId?: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PublicLivePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<LiveTab>('boards');
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [standingsCatId, setStandingsCatId] = useState('');

  const refresh = useCallback(async () => {
    if (!token) return;
    const res = await apiPublicLiveGet(token);
    if (!res.ok) {
      setError(networkErrorMessage(res.error));
      if (/abort|timeout|timed out|failed to fetch|network|load failed|offline/i.test(res.error)) {
        setOnline(false);
      }
      if (/not found/i.test(res.error) || res.error.includes('404')) {
        setData(null);
      }
      setLoading(false);
      return;
    }
    setOnline(true);
    setError(null);
    setData(res.data);
    setLoading(false);
    setSelectedRound((prev) => {
      if (prev != null) return prev;
      const cur = res.data.tournament.currentRound || 1;
      const rounds = [...new Set(res.data.games.map((g) => g.round))];
      if (rounds.includes(cur)) return cur;
      return rounds.length ? Math.max(...rounds) : cur;
    });
    setStandingsCatId((prev) => prev || res.data.categories[0]?.id || '');
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const markOnline = () => {
      setOnline(true);
      void checkOnline().then(setOnline);
    };
    const markOffline = () => setOnline(false);
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
    void checkOnline().then(setOnline);

    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 20_000);

    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
      window.clearInterval(poll);
    };
  }, [refresh]);

  const playerById = useMemo(
    () => new Map((data?.players ?? []).map((p) => [p.id, p])),
    [data],
  );

  const rounds = useMemo(() => {
    if (!data) return [];
    const fromGames = [...new Set(data.games.map((g) => g.round))].sort((a, b) => a - b);
    if (fromGames.length) return fromGames;
    const max = Math.max(1, data.tournament.currentRound || 1);
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [data]);

  const displayRound = selectedRound ?? rounds[rounds.length - 1] ?? 1;

  const boardsForRound = useMemo(() => {
    if (!data) return [];
    return data.games
      .filter((g) => g.round === displayRound)
      .sort((a, b) => a.board - b.board);
  }, [data, displayRound]);

  const filteredPlayers = useMemo(() => {
    if (!data) return [];
    return data.players.filter((p) =>
      matchesTextSearch(search, p.name, p.club, p.rating),
    );
  }, [data, search]);

  const filteredBoards = useMemo(() => {
    if (!search.trim()) return boardsForRound;
    return boardsForRound.filter((g) => {
      const white = g.whiteId ? playerById.get(g.whiteId) : null;
      const black = g.blackId ? playerById.get(g.blackId) : null;
      return (
        matchesTextSearch(search, white?.name, white?.club, white?.rating) ||
        matchesTextSearch(search, black?.name, black?.club, black?.rating)
      );
    });
  }, [boardsForRound, search, playerById]);

  const standings = useMemo(() => {
    if (!data) return [];
    const hasCats = data.categories.length > 0;
    return computeLiveStandings(data, hasCats ? standingsCatId || null : null);
  }, [data, standingsCatId]);

  const prizePlacesN = useMemo(() => {
    if (!data) return 3;
    const cat = data.categories.find((c) => c.id === standingsCatId);
    return resolvePrizePlaces(
      { prizePlaces: data.tournament.prizePlaces },
      cat ? { prizePlaces: cat.prizePlaces } : undefined,
    );
  }, [data, standingsCatId]);

  if (!token) {
    return (
      <div className="live-page">
        <p className="form-error">Invalid live link.</p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="live-page">
        <p className="form-hint">Loading tournament…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="live-page">
        <header className="live-header">
          <p className="live-brand">Chess Alokas</p>
          <h1>Live page unavailable</h1>
        </header>
        {error && <div className="form-error">{error}</div>}
        <p className="form-hint">
          This link may be disabled, rotated, or incorrect. Ask the tournament director for the
          current live link.
        </p>
      </div>
    );
  }

  if (playerId) {
    return (
      <LivePlayerView
        token={token}
        playerId={playerId}
        data={data}
        online={online}
        error={error}
        displayRound={displayRound}
        rounds={rounds}
        onRoundChange={setSelectedRound}
        onBack={() => navigate(`/live/${token}`)}
      />
    );
  }

  const q = search.trim();

  return (
    <div className="live-page">
      <header className="live-header">
        <div className="live-header-row">
          <p className="live-brand">Chess Alokas Live</p>
          <span className="table-score-conn" title={online ? 'Online' : 'Offline'}>
            <span className={`status-dot ${online ? 'online' : 'offline'}`} />
            <span className="status-label">{online ? 'Online' : 'Offline'}</span>
          </span>
        </div>
        <h1>{data.tournament.name}</h1>
        <p className="live-meta">
          {data.tournament.date
            ? new Date(data.tournament.date).toLocaleDateString()
            : 'Tournament'}
          {' · '}
          Round {displayRound}
          {data.tournament.currentRound
            ? ` of ${data.tournament.rounds}`
            : ''}
        </p>
      </header>

      {!online && (
        <div className="live-offline" role="status">
          <strong>No internet</strong>
          <span>Scores may be out of date until this device reconnects.</span>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}

      <div className="live-search-sticky">
        <TableSearch
          id="live-player-search"
          value={search}
          onChange={setSearch}
          placeholder="Find your name…"
          resultCount={filteredPlayers.length}
          totalCount={data.players.length}
        />
        {q && (
          <ul className="live-search-hits">
            {filteredPlayers.length === 0 ? (
              <li className="live-search-empty">No players match “{q}”.</li>
            ) : (
              filteredPlayers.slice(0, 12).map((p) => {
                const game = gameForPlayerRound(data.games, p.id, displayRound);
                let seat = 'Not paired yet';
                if (game) {
                  if (game.isBye || game.result === 'bye') seat = 'Bye';
                  else {
                    const color = game.whiteId === p.id ? 'White' : 'Black';
                    seat = `Table ${game.board} · ${color}`;
                  }
                }
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="live-search-hit"
                      onClick={() => navigate(`/live/${token}/p/${p.id}`)}
                    >
                      <strong>{p.name}</strong>
                      <span>{seat}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>

      <div className="tabs live-tabs">
        <button
          type="button"
          className={`tab ${tab === 'boards' ? 'active' : ''}`}
          onClick={() => setTab('boards')}
        >
          Tables
        </button>
        <button
          type="button"
          className={`tab ${tab === 'standings' ? 'active' : ''}`}
          onClick={() => setTab('standings')}
        >
          Standings
        </button>
      </div>

      {tab === 'boards' && (
        <section className="live-section">
          <div className="live-round-pills">
            {rounds.map((r) => (
              <button
                key={r}
                type="button"
                className={`live-round-pill ${displayRound === r ? 'active' : ''}`}
                onClick={() => setSelectedRound(r)}
              >
                Round {r}
              </button>
            ))}
          </div>
          {filteredBoards.length === 0 ? (
            <p className="form-hint">
              {q
                ? `No tables match “${q}” in Round ${displayRound}.`
                : `No pairings for Round ${displayRound} yet.`}
            </p>
          ) : (
            <ul className="live-board-list">
              {filteredBoards.map((g) => {
                const white = g.whiteId ? playerById.get(g.whiteId) : null;
                const black = g.blackId ? playerById.get(g.blackId) : null;
                return (
                  <li key={`${g.round}-${g.board}-${g.whiteId}-${g.blackId}`} className="live-board-card">
                    <div className="live-board-num">
                      {g.isBye ? 'Bye' : `Table ${g.board}`}
                    </div>
                    <div className="live-board-players">
                      {g.isBye ? (
                        <p>
                          <Link to={`/live/${token}/p/${g.whiteId ?? g.blackId}`}>
                            {white?.name ?? black?.name ?? 'Player'}
                          </Link>
                        </p>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="live-board-player"
                            onClick={() =>
                              g.whiteId && navigate(`/live/${token}/p/${g.whiteId}`)
                            }
                            disabled={!g.whiteId}
                          >
                            <ColorSide color="white" />
                            <span>{white?.name ?? '—'}</span>
                          </button>
                          <button
                            type="button"
                            className="live-board-player"
                            onClick={() =>
                              g.blackId && navigate(`/live/${token}/p/${g.blackId}`)
                            }
                            disabled={!g.blackId}
                          >
                            <ColorSide color="black" onDark />
                            <span>{black?.name ?? '—'}</span>
                          </button>
                        </>
                      )}
                    </div>
                    <div className="live-board-result">
                      {formatResultLabel(g.result, g.isBye)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === 'standings' && (
        <section className="live-section">
          {data.categories.length > 0 && (
            <div className="category-tabs">
              {data.categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`cat-tab ${standingsCatId === cat.id ? 'active' : ''}`}
                  onClick={() => setStandingsCatId(cat.id)}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
          <p className="form-hint standings-prize-hint">
            Prize places: top {prizePlacesN}
            {standingsCatId
              ? ` · ${data.categories.find((c) => c.id === standingsCatId)?.name ?? ''}`
              : ''}
          </p>
          {standings.length === 0 ? (
            <p className="form-hint">No standings yet — results will appear here.</p>
          ) : (
            <table className="data-table standings-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Name</th>
                  <th>Score</th>
                  <th>Buchholz</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s) => {
                  const isPrize = s.rank <= prizePlacesN;
                  return (
                    <tr key={s.id} className={isPrize ? 'rank-prize' : ''}>
                      <td>{s.rank}</td>
                      <td>
                        <Link to={`/live/${token}/p/${s.id}`}>{s.name}</Link>
                      </td>
                      <td>{resultPointsLabel(s.score)}</td>
                      <td>{resultPointsLabel(s.buchholz)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}

function LivePlayerView({
  token,
  playerId,
  data,
  online,
  error,
  displayRound,
  rounds,
  onRoundChange,
  onBack,
}: {
  token: string;
  playerId: string;
  data: PublicLivePayload;
  online: boolean;
  error: string | null;
  displayRound: number;
  rounds: number[];
  onRoundChange: (r: number) => void;
  onBack: () => void;
}) {
  const player = data.players.find((p) => p.id === playerId);
  const history = useMemo(
    () => buildPlayerHistory(data.games, data.players, playerId),
    [data, playerId],
  );
  const game = gameForPlayerRound(data.games, playerId, displayRound);
  const myScore = runningScore(data.games, playerId, displayRound);
  const opponentId =
    game && !game.isBye
      ? game.whiteId === playerId
        ? game.blackId
        : game.whiteId
      : null;
  const opponent = opponentId
    ? data.players.find((p) => p.id === opponentId)
    : null;
  const oppScore = opponentId
    ? runningScore(data.games, opponentId, displayRound)
    : null;

  if (!player) {
    return (
      <div className="live-page">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          ← All tables
        </button>
        <p className="form-error">Player not found in this tournament.</p>
      </div>
    );
  }

  const isWhite = game?.whiteId === playerId;
  const color = game && !game.isBye ? (isWhite ? 'white' : 'black') : null;

  return (
    <div className="live-page">
      <header className="live-header">
        <div className="live-header-row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
            ← All tables
          </button>
          <span className="table-score-conn" title={online ? 'Online' : 'Offline'}>
            <span className={`status-dot ${online ? 'online' : 'offline'}`} />
            <span className="status-label">{online ? 'Online' : 'Offline'}</span>
          </span>
        </div>
        <p className="live-brand">{data.tournament.name}</p>
        <h1>{player.name}</h1>
      </header>

      {!online && (
        <div className="live-offline" role="status">
          <strong>No internet</strong>
          <span>Scores may be out of date until this device reconnects.</span>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}

      <div className="live-round-pills">
        {rounds.map((r) => (
          <button
            key={r}
            type="button"
            className={`live-round-pill ${displayRound === r ? 'active' : ''}`}
            onClick={() => onRoundChange(r)}
          >
            Round {r}
          </button>
        ))}
      </div>

      <div className="live-player-card">
        <h2>Round {displayRound}</h2>
        {!game ? (
          <p className="form-hint">Not paired in this round yet.</p>
        ) : game.isBye || game.result === 'bye' ? (
          <p className="form-hint">Bye this round (1 point).</p>
        ) : (
          <>
            <p className="live-seat">
              Table <strong>{game.board}</strong>
              {color && (
                <>
                  {' · '}
                  <ColorSide color={color} onDark={color === 'black'} />
                  <span>{color === 'white' ? 'White' : 'Black'}</span>
                </>
              )}
            </p>
            <p className="live-vs">
              vs{' '}
              {opponent ? (
                <Link to={`/live/${token}/p/${opponent.id}`}>{opponent.name}</Link>
              ) : (
                '—'
              )}
            </p>
            <p className="live-board-result">
              {formatResultLabel(game.result, false)}
            </p>
          </>
        )}

        <div className="live-scores">
          <div>
            <span className="live-score-label">Your points</span>
            <strong>{resultPointsLabel(myScore)}</strong>
          </div>
          {oppScore != null && opponent && (
            <div>
              <span className="live-score-label">{opponent.name}</span>
              <strong>{resultPointsLabel(oppScore)}</strong>
            </div>
          )}
        </div>
      </div>

      <section className="live-section">
        <h2 className="live-section-title">Round history</h2>
        {history.length === 0 ? (
          <p className="form-hint">No games yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Rd</th>
                <th>Table</th>
                <th>Color</th>
                <th>Opponent</th>
                <th>Result</th>
                <th>Pts</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.round}>
                  <td>{row.round}</td>
                  <td>{row.board ?? '—'}</td>
                  <td>
                    {row.color === 'white'
                      ? 'W'
                      : row.color === 'black'
                        ? 'B'
                        : '—'}
                  </td>
                  <td>
                    {row.opponentId ? (
                      <Link to={`/live/${token}/p/${row.opponentId}`}>
                        {row.opponentName}
                      </Link>
                    ) : (
                      row.opponentName
                    )}
                  </td>
                  <td>{formatResultLabel(row.result, row.isBye)}</td>
                  <td>{resultPointsLabel(row.scoreAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
