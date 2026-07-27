import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  apiPublicLiveGet,
  checkOnline,
  type PublicLivePayload,
} from '../api/client';
import TableSearch from '../components/TableSearch';
import { matchesTextSearch } from '../lib/textSearch';
import {
  buildPlayerHistory,
  computeLiveStandings,
  formatResultLabel,
  gameForPlayerRound,
  resultPointsLabel,
  runningScore,
  type LiveGame,
  type LivePlayer,
} from '../lib/liveViewer';
import { resolvePrizePlaces } from '../lib/prizePlaces';

type LiveTab = 'boards' | 'standings';

function networkErrorMessage(raw: string): string {
  if (/abort|timeout|timed out|failed to fetch|network|load failed|offline/i.test(raw)) {
    return 'No connection — reconnect to refresh pairings and scores.';
  }
  return raw;
}

function ColorPill({ color }: { color: 'white' | 'black' }) {
  return (
    <span className={`live-color-pill live-color-${color}`} aria-label={color}>
      <span className="live-color-dot" aria-hidden />
      {color === 'white' ? 'White' : 'Black'}
    </span>
  );
}

function SideRow({
  color,
  name,
  points,
  onOpen,
}: {
  color: 'white' | 'black';
  name: string;
  points: number;
  onOpen?: () => void;
}) {
  const inner = (
    <>
      <ColorPill color={color} />
      <span className="live-side-name">{name}</span>
      <span className="live-side-pts" title="Tournament points so far">
        {resultPointsLabel(points)}
        <small>pts</small>
      </span>
    </>
  );

  if (onOpen) {
    return (
      <button type="button" className={`live-side live-side-${color}`} onClick={onOpen}>
        {inner}
      </button>
    );
  }
  return <div className={`live-side live-side-${color}`}>{inner}</div>;
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
          {data.tournament.rounds ? ` of ${data.tournament.rounds}` : ''}
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
              filteredPlayers.slice(0, 12).map((p) => (
                <li key={p.id}>
                  <SearchHit
                    player={p}
                    game={gameForPlayerRound(data.games, p.id, displayRound)}
                    score={runningScore(data.games, p.id, displayRound)}
                    onOpen={() => navigate(`/live/${token}/p/${p.id}`)}
                  />
                </li>
              ))
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
          <p className="live-hint-inline">Tap a player for full history. Points shown are totals so far.</p>
          {filteredBoards.length === 0 ? (
            <p className="form-hint">
              {q
                ? `No tables match “${q}” in Round ${displayRound}.`
                : `No pairings for Round ${displayRound} yet.`}
            </p>
          ) : (
            <ul className="live-board-list">
              {filteredBoards.map((g) => (
                <BoardCard
                  key={`${g.round}-${g.board}-${g.whiteId}-${g.blackId}`}
                  game={g}
                  white={g.whiteId ? playerById.get(g.whiteId) : null}
                  black={g.blackId ? playerById.get(g.blackId) : null}
                  whitePts={
                    g.whiteId ? runningScore(data.games, g.whiteId, displayRound) : 0
                  }
                  blackPts={
                    g.blackId ? runningScore(data.games, g.blackId, displayRound) : 0
                  }
                  onOpen={(id) => navigate(`/live/${token}/p/${id}`)}
                />
              ))}
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

function SearchHit({
  player,
  game,
  score,
  onOpen,
}: {
  player: LivePlayer;
  game: LiveGame | null;
  score: number;
  onOpen: () => void;
}) {
  const isBye = Boolean(game && (game.isBye || game.result === 'bye'));
  const color =
    game && !isBye
      ? game.whiteId === player.id
        ? 'white'
        : 'black'
      : null;

  return (
    <button type="button" className="live-search-hit" onClick={onOpen}>
      <div className="live-search-hit-main">
        <strong>{player.name}</strong>
        <span className="live-search-hit-pts">
          {resultPointsLabel(score)} pts
        </span>
      </div>
      <div className="live-search-hit-meta">
        {!game ? (
          <span className="live-chip live-chip-muted">Not paired yet</span>
        ) : isBye ? (
          <span className="live-chip">Bye</span>
        ) : (
          <>
            <span className="live-chip live-chip-table">Table {game.board}</span>
            {color && <ColorPill color={color} />}
          </>
        )}
        <span className="live-search-hit-cta">Details →</span>
      </div>
    </button>
  );
}

function BoardCard({
  game,
  white,
  black,
  whitePts,
  blackPts,
  onOpen,
}: {
  game: LiveGame;
  white: LivePlayer | null | undefined;
  black: LivePlayer | null | undefined;
  whitePts: number;
  blackPts: number;
  onOpen: (id: string) => void;
}) {
  if (game.isBye || game.result === 'bye') {
    const byeId = game.whiteId ?? game.blackId;
    const byeName = white?.name ?? black?.name ?? 'Player';
    return (
      <li className="live-board-card live-board-bye">
        <div className="live-board-top">
          <span className="live-board-badge">Bye</span>
          <span className="live-result-pill">1 pt</span>
        </div>
        {byeId ? (
          <button type="button" className="live-bye-player" onClick={() => onOpen(byeId)}>
            <span>{byeName}</span>
            <span className="live-side-pts">
              {resultPointsLabel(whitePts || blackPts)}
              <small>pts</small>
            </span>
          </button>
        ) : (
          <p>{byeName}</p>
        )}
      </li>
    );
  }

  return (
    <li className="live-board-card">
      <div className="live-board-top">
        <span className="live-board-badge">Table {game.board}</span>
        <span
          className={`live-result-pill ${
            game.result === 'pending' ? 'is-pending' : 'is-done'
          }`}
        >
          {formatResultLabel(game.result, false)}
        </span>
      </div>
      <div className="live-matchup">
        <SideRow
          color="white"
          name={white?.name ?? '—'}
          points={whitePts}
          onOpen={game.whiteId ? () => onOpen(game.whiteId!) : undefined}
        />
        <div className="live-matchup-vs" aria-hidden>
          vs
        </div>
        <SideRow
          color="black"
          name={black?.name ?? '—'}
          points={blackPts}
          onOpen={game.blackId ? () => onOpen(game.blackId!) : undefined}
        />
      </div>
    </li>
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
  const navigate = useNavigate();
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
  const myColor = game && !game.isBye ? (isWhite ? 'white' : 'black') : null;
  const oppColor = myColor === 'white' ? 'black' : myColor === 'black' ? 'white' : null;

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

      <div className="live-player-hero">
        {!game ? (
          <p className="form-hint">Not paired in this round yet.</p>
        ) : game.isBye || game.result === 'bye' ? (
          <>
            <div className="live-board-top">
              <span className="live-board-badge">Bye</span>
              <span className="live-result-pill">1 pt this round</span>
            </div>
            <div className="live-scores-duo">
              <div className="live-score-tile is-you">
                <span className="live-score-label">Your total</span>
                <strong>{resultPointsLabel(myScore)}</strong>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="live-board-top">
              <span className="live-board-badge live-board-badge-lg">
                Table {game.board}
              </span>
              <span
                className={`live-result-pill ${
                  game.result === 'pending' ? 'is-pending' : 'is-done'
                }`}
              >
                {formatResultLabel(game.result, false)}
              </span>
            </div>

            <div className="live-duel">
              <div className={`live-duel-side live-side-${myColor ?? 'white'} is-you`}>
                <span className="live-duel-you">You</span>
                {myColor && <ColorPill color={myColor} />}
                <strong className="live-duel-name">{player.name}</strong>
                <span className="live-duel-pts">
                  {resultPointsLabel(myScore)}
                  <small>pts total</small>
                </span>
              </div>
              <div className="live-duel-mid" aria-hidden>
                vs
              </div>
              <button
                type="button"
                className={`live-duel-side live-side-${oppColor ?? 'black'}`}
                disabled={!opponent}
                onClick={() => opponent && navigate(`/live/${token}/p/${opponent.id}`)}
              >
                {oppColor && <ColorPill color={oppColor} />}
                <strong className="live-duel-name">{opponent?.name ?? '—'}</strong>
                <span className="live-duel-pts">
                  {oppScore != null ? resultPointsLabel(oppScore) : '—'}
                  <small>pts total</small>
                </span>
              </button>
            </div>
          </>
        )}
      </div>

      <section className="live-section">
        <h2 className="live-section-title">Round history</h2>
        {history.length === 0 ? (
          <p className="form-hint">No games yet.</p>
        ) : (
          <ul className="live-history-list">
            {history.map((row) => (
              <li
                key={row.round}
                className={`live-history-card ${
                  row.round === displayRound ? 'is-current' : ''
                }`}
              >
                <div className="live-history-top">
                  <span className="live-chip">Round {row.round}</span>
                  {row.board != null && (
                    <span className="live-chip live-chip-table">Table {row.board}</span>
                  )}
                  {row.color && <ColorPill color={row.color} />}
                  <span className="live-history-result">
                    {formatResultLabel(row.result, row.isBye)}
                  </span>
                </div>
                <div className="live-history-body">
                  <span>
                    {row.isBye ? (
                      'Bye'
                    ) : row.opponentId ? (
                      <Link to={`/live/${token}/p/${row.opponentId}`}>
                        vs {row.opponentName}
                      </Link>
                    ) : (
                      `vs ${row.opponentName}`
                    )}
                  </span>
                  <span className="live-history-pts">
                    {resultPointsLabel(row.scoreAfter)}
                    <small> after</small>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
