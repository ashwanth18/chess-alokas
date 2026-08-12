import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { sortRoster } from '@chess-alokas/pairing-engine';
import { ILLEGAL_MOVE_LIMIT, WARNING_LIMIT } from '@chess-alokas/shared';
import {
  apiPublicLiveGet,
  checkOnline,
  type PlayerCardCounts,
  type PublicLivePayload,
} from '../api/client';
import TableSearch from '../components/TableSearch';
import TiebreakRulesHelp from '../components/TiebreakRulesHelp';
import { displaySchool } from '../lib/importParse';
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

type LiveTab = 'boards' | 'standings' | 'players';

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

function LiveCardChips({ counts }: { counts?: PlayerCardCounts | null }) {
  if (!counts) return null;
  const showY = counts.warning > 0;
  const showR = counts.illegalMove > 0;
  if (!showY && !showR) return null;
  return (
    <span className="live-card-chips" aria-label="Discipline cards">
      {showY ? (
        <span className="floor-card-chip floor-card-yellow" title="Warnings">
          🟡 {counts.warning}/{WARNING_LIMIT}
        </span>
      ) : null}
      {showR ? (
        <span className="floor-card-chip floor-card-red" title="Illegal moves">
          🔴 {counts.illegalMove}/{ILLEGAL_MOVE_LIMIT}
        </span>
      ) : null}
    </span>
  );
}

function SideRow({
  color,
  name,
  points,
  cards,
  onOpen,
}: {
  color: 'white' | 'black';
  name: string;
  points: number;
  cards?: PlayerCardCounts | null;
  onOpen?: () => void;
}) {
  const inner = (
    <>
      <ColorPill color={color} />
      <span className="live-side-main">
        <span className="live-side-name">{name}</span>
        <LiveCardChips counts={cards} />
      </span>
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
        <button
          type="button"
          className={`tab ${tab === 'players' ? 'active' : ''}`}
          onClick={() => setTab('players')}
        >
          Players
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
          <div className="standings-heading-row">
            <p className="form-hint standings-prize-hint">
              Prize places: top {prizePlacesN}
              {standingsCatId
                ? ` · ${data.categories.find((c) => c.id === standingsCatId)?.name ?? ''}`
                : ''}
            </p>
            <TiebreakRulesHelp />
          </div>
          {standings.length === 0 ? (
            <p className="form-hint">No standings yet — results will appear here.</p>
          ) : (
            <table className="data-table standings-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th title="Start rank">Start</th>
                  <th>Name</th>
                  <th>Score</th>
                  <th title="Buchholz">BH</th>
                  <th title="Buchholz Cut-1">BH-C1</th>
                  <th title="Sonneborn-Berger">SB</th>
                  <th title="Progressive">Prog</th>
                  <th title="Wins">Wins</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s) => {
                  const isPrize = s.rank <= prizePlacesN;
                  const start = data.players.find((p) => p.id === s.id)?.seed;
                  return (
                    <tr key={s.id} className={isPrize ? 'rank-prize' : ''}>
                      <td>{s.rank}</td>
                      <td>{start ?? '—'}</td>
                      <td>
                        <Link to={`/live/${token}/p/${s.id}`}>{s.name}</Link>
                      </td>
                      <td>{resultPointsLabel(s.score)}</td>
                      <td>{resultPointsLabel(s.buchholz)}</td>
                      <td>{resultPointsLabel(s.buchholzCut1)}</td>
                      <td>{resultPointsLabel(s.sonnebornBerger)}</td>
                      <td>{resultPointsLabel(s.progressive)}</td>
                      <td>{s.wins}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === 'players' && (
        <section className="live-section">
          <p className="form-hint">
            Rated players first, then unrated A–Z. Tap a name for full profile.
          </p>
          <table className="data-table standings-table">
            <thead>
              <tr>
                <th>Start</th>
                <th>End</th>
                <th>Name</th>
                <th>FIDE</th>
                <th>YOB</th>
                <th>School</th>
                <th>City</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {sortRoster(
                data.players.filter((p) =>
                  matchesTextSearch(
                    search,
                    p.name,
                    p.school,
                    p.club,
                    p.city,
                    p.state,
                    p.rating,
                    p.yearOfBirth,
                  ),
                ),
              ).map((p) => {
                const end =
                  standings.find((s) => s.id === p.id)?.rank ??
                  null;
                return (
                  <tr key={p.id}>
                    <td>{p.seed ?? '—'}</td>
                    <td>{end ?? '—'}</td>
                    <td>
                      <Link to={`/live/${token}/p/${p.id}`}>{p.name}</Link>
                    </td>
                    <td>{p.rating && p.rating > 0 ? p.rating : '—'}</td>
                    <td>{p.yearOfBirth ?? '—'}</td>
                    <td>{displaySchool(p) ?? '—'}</td>
                    <td>{p.city ?? '—'}</td>
                    <td>{p.state ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
          cards={game.whiteCards}
          onOpen={game.whiteId ? () => onOpen(game.whiteId!) : undefined}
        />
        <div className="live-matchup-vs" aria-hidden>
          vs
        </div>
        <SideRow
          color="black"
          name={black?.name ?? '—'}
          points={blackPts}
          cards={game.blackCards}
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
        <dl className="live-player-profile">
          <div>
            <dt>Year of birth</dt>
            <dd>{player.yearOfBirth ?? '—'}</dd>
          </div>
          <div>
            <dt>Start rank</dt>
            <dd>{player.seed ?? '—'}</dd>
          </div>
          <div>
            <dt>End rank</dt>
            <dd>
              {computeLiveStandings(data, null).find((s) => s.id === playerId)?.rank ??
                '—'}
            </dd>
          </div>
          <div>
            <dt>FIDE rating</dt>
            <dd>{player.rating && player.rating > 0 ? player.rating : 'Unrated'}</dd>
          </div>
          <div>
            <dt>School</dt>
            <dd>{displaySchool(player) ?? '—'}</dd>
          </div>
          <div>
            <dt>City</dt>
            <dd>{player.city ?? '—'}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{player.state ?? '—'}</dd>
          </div>
          <div>
            <dt>Country</dt>
            <dd>{player.country ?? 'Malaysia'}</dd>
          </div>
        </dl>
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
