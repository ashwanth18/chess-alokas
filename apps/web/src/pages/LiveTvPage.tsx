import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  apiPublicLiveGet,
  checkOnline,
  type PublicLivePayload,
} from '../api/client';
import {
  computeLiveStandings,
  formatResultLabel,
  resultPointsLabel,
  runningScore,
} from '../lib/liveViewer';
import { resolvePrizePlaces } from '../lib/prizePlaces';
import { trackPageView } from '../lib/pageAnalytics';

type TvViewMode = 'auto' | 'pairings' | 'standings';

const BOARDS_PER_PAGE = 12;
const AUTO_PAGE_INTERVAL_MS = 10_000;
const CLOCK_PRESETS_MIN = [15, 25, 30, 60] as const;

function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function LiveTvPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicLivePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  // View mode & auto-paging state
  const [viewMode, setViewMode] = useState<TvViewMode>('auto');
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [pageIndex, setPageIndex] = useState(0);

  // Round Countdown Clock state
  const [clockDurationMin, setClockDurationMin] = useState<number>(25);
  const [clockRemainingSec, setClockRemainingSec] = useState<number>(25 * 60);
  const [clockRunning, setClockRunning] = useState<boolean>(false);

  useEffect(() => {
    if (!token) return;
    trackPageView({
      routeKey: 'live',
      path: `/live/${token}/tv`,
      liveToken: token,
    });
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    const res = await apiPublicLiveGet(token);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      if (/abort|timeout|timed out|failed to fetch|network|load failed|offline/i.test(res.error)) {
        setOnline(false);
      }
      return;
    }
    setOnline(true);
    setError(null);
    setData(res.data);
    setSelectedRound((prev) => {
      if (prev != null) return prev;
      const cur = res.data.tournament.currentRound || 1;
      const rounds = [...new Set(res.data.games.map((g) => g.round))];
      if (rounds.includes(cur)) return cur;
      return rounds.length ? Math.max(...rounds) : cur;
    });
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
    }, 12_000);

    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
      window.clearInterval(poll);
    };
  }, [refresh]);

  // Countdown timer tick
  useEffect(() => {
    if (!clockRunning) return;
    const timer = window.setInterval(() => {
      setClockRemainingSec((prev) => {
        if (prev <= 1) {
          setClockRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [clockRunning]);

  function selectClockMinutes(mins: number) {
    setClockRunning(false);
    setClockDurationMin(mins);
    setClockRemainingSec(mins * 60);
  }

  function resetClock() {
    setClockRunning(false);
    setClockRemainingSec(clockDurationMin * 60);
  }

  const playerById = useMemo(
    () => new Map((data?.players ?? []).map((p) => [p.id, p])),
    [data],
  );

  const categoryById = useMemo(
    () => new Map((data?.categories ?? []).map((c) => [c.id, c.name])),
    [data],
  );

  const rounds = useMemo(() => {
    if (!data) return [1];
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

  const boardPagesCount = Math.max(1, Math.ceil(boardsForRound.length / BOARDS_PER_PAGE));

  // Build standings sections (one per category, or 1 overall if no categories)
  const standingsSections = useMemo(() => {
    if (!data) return [];
    if (data.categories.length === 0) {
      return [
        {
          id: '__overall__',
          name: 'Overall Standings',
          prizePlaces: resolvePrizePlaces({ prizePlaces: data.tournament.prizePlaces }),
          rows: computeLiveStandings(data, null),
        },
      ];
    }
    return data.categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      prizePlaces: resolvePrizePlaces(
        { prizePlaces: data.tournament.prizePlaces },
        { prizePlaces: cat.prizePlaces },
      ),
      rows: computeLiveStandings(data, cat.id),
    }));
  }, [data]);

  const standingsPagesCount = Math.max(1, standingsSections.length);

  const totalSlides = useMemo(() => {
    if (viewMode === 'pairings') return boardPagesCount;
    if (viewMode === 'standings') return standingsPagesCount;
    return boardPagesCount + standingsPagesCount;
  }, [viewMode, boardPagesCount, standingsPagesCount]);

  // Reset slide index if out of bounds
  useEffect(() => {
    setPageIndex((prev) => (prev >= totalSlides ? 0 : prev));
  }, [totalSlides]);

  // Auto-advance page every 10 seconds when there are multiple slides
  useEffect(() => {
    if (totalSlides <= 1) return;
    const handle = window.setInterval(() => {
      setPageIndex((prev) => (prev + 1) % totalSlides);
    }, AUTO_PAGE_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [totalSlides]);

  const showingStandings =
    viewMode === 'standings' || (viewMode === 'auto' && pageIndex >= boardPagesCount);

  const activeBoardPage =
    viewMode === 'pairings'
      ? pageIndex % boardPagesCount
      : Math.min(pageIndex, boardPagesCount - 1);

  const activeStandingsPage =
    viewMode === 'standings'
      ? pageIndex % standingsPagesCount
      : Math.max(0, pageIndex - boardPagesCount) % standingsPagesCount;

  const visibleBoards = useMemo(() => {
    const start = activeBoardPage * BOARDS_PER_PAGE;
    return boardsForRound.slice(start, start + BOARDS_PER_PAGE);
  }, [boardsForRound, activeBoardPage]);

  const activeStandingsSection = standingsSections[activeStandingsPage] ?? standingsSections[0];

  const completedBoardsCount = useMemo(
    () => boardsForRound.filter((g) => g.isBye || g.result !== 'pending').length,
    [boardsForRound],
  );

  if (!token) {
    return (
      <div className="live-page">
        <p className="form-error">Invalid live TV link.</p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="live-page" style={{ minHeight: '100vh', padding: '2rem' }}>
        <p className="form-hint">Loading TV / Projector display…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="live-page" style={{ minHeight: '100vh', padding: '2rem' }}>
        <h1>Live TV page unavailable</h1>
        {error && <div className="form-error">{error}</div>}
        <p className="form-hint">Ask the tournament director for the current live link.</p>
      </div>
    );
  }

  const clockUrgent = clockRemainingSec > 0 && clockRemainingSec <= 300;
  const clockExpired = clockRemainingSec === 0;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0b0f19',
        color: '#f8fafc',
        padding: '1.25rem 1.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Top Venue Header Bar */}
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          background: '#111827',
          border: '1px solid #1f2937',
          borderRadius: '14px',
          padding: '1rem 1.35rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.2rem' }}>
            <span
              style={{
                background: '#d97706',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.78rem',
                padding: '0.18rem 0.55rem',
                borderRadius: '999px',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              📺 Venue TV Mode
            </span>
            <span style={{ fontSize: '0.88rem', color: online ? '#34d399' : '#f87171' }}>
              ● {online ? 'Live Sync' : 'Offline'}
            </span>
            <span style={{ fontSize: '0.88rem', color: '#94a3b8' }}>
              · {completedBoardsCount}/{boardsForRound.length} boards finished
            </span>
          </div>
          <h1 style={{ margin: 0, fontSize: '1.65rem', fontWeight: 800, color: '#ffffff' }}>
            {data.tournament.name} — Round {displayRound} of {data.tournament.rounds}
          </h1>
        </div>

        {/* Round Countdown Clock */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            background: clockExpired
              ? 'rgba(239, 68, 68, 0.22)'
              : clockUrgent
                ? 'rgba(245, 158, 11, 0.2)'
                : '#1e293b',
            border: `2px solid ${
              clockExpired ? '#ef4444' : clockUrgent ? '#f59e0b' : '#334155'
            }`,
            borderRadius: '12px',
            padding: '0.5rem 0.9rem',
          }}
        >
          <div style={{ textAlign: 'center', minWidth: '6.5rem' }}>
            <div
              style={{
                fontSize: '0.7rem',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: '#94a3b8',
              }}
            >
              Round Clock
            </div>
            <div
              style={{
                fontSize: '2rem',
                fontWeight: 800,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1.1,
                color: clockExpired ? '#f87171' : clockUrgent ? '#fbbf24' : '#f8fafc',
              }}
            >
              {formatClock(clockRemainingSec)}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => setClockRunning((r) => !r)}
              >
                {clockRunning ? 'Pause' : 'Start'}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={resetClock}
              >
                Reset
              </button>
            </div>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              {CLOCK_PRESETS_MIN.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => selectClockMinutes(m)}
                  style={{
                    background: clockDurationMin === m ? '#3b82f6' : '#0f172a',
                    color: '#e2e8f0',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '0.12rem 0.45rem',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* View Mode Selector & Controls */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
          <select
            aria-label="TV view mode"
            value={viewMode}
            onChange={(e) => {
              setViewMode(e.target.value as TvViewMode);
              setPageIndex(0);
            }}
            style={{
              background: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: '8px',
              padding: '0.45rem 0.7rem',
              fontSize: '0.9rem',
              fontWeight: 600,
            }}
          >
            <option value="auto">Auto-Rotate Pairings &amp; Standings</option>
            <option value="pairings">Pairings Only</option>
            <option value="standings">Standings Only</option>
          </select>

          {rounds.length > 1 && (
            <select
              aria-label="Round selector"
              value={displayRound}
              onChange={(e) => {
                setSelectedRound(Number(e.target.value));
                setPageIndex(0);
              }}
              style={{
                background: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '0.45rem 0.7rem',
                fontSize: '0.9rem',
              }}
            >
              {rounds.map((r) => (
                <option key={r} value={r}>
                  Round {r}
                </option>
              ))}
            </select>
          )}

          {totalSlides > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => setPageIndex((prev) => (prev - 1 + totalSlides) % totalSlides)}
              >
                ◀
              </button>
              <span style={{ fontSize: '0.85rem', color: '#cbd5e1', minWidth: '4.5rem', textAlign: 'center' }}>
                Slide {pageIndex + 1}/{totalSlides}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => setPageIndex((prev) => (prev + 1) % totalSlides)}
              >
                ▶
              </button>
            </div>
          )}

          <Link to={`/live/${token}`} className="btn btn-sm btn-ghost" style={{ color: '#cbd5e1' }}>
            Standard View
          </Link>
        </div>
      </header>

      {/* Main High-Contrast Projector Stage */}
      {!showingStandings ? (
        <section style={{ flex: 1 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.75rem',
            }}
          >
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#e2e8f0' }}>
              Round {displayRound} Pairings — Page {activeBoardPage + 1} of {boardPagesCount}
            </h2>
            <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
              Auto-rotates every 10 seconds
            </span>
          </div>

          {visibleBoards.length === 0 ? (
            <div
              style={{
                background: '#111827',
                border: '1px solid #1f2937',
                borderRadius: '12px',
                padding: '3rem',
                textAlign: 'center',
                color: '#94a3b8',
                fontSize: '1.2rem',
              }}
            >
              No pairings published for Round {displayRound} yet.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                gap: '0.9rem',
              }}
            >
              {visibleBoards.map((g) => {
                const white = g.whiteId ? playerById.get(g.whiteId) : null;
                const black = g.blackId ? playerById.get(g.blackId) : null;
                const whitePts = g.whiteId ? runningScore(data.games, g.whiteId, displayRound) : 0;
                const blackPts = g.blackId ? runningScore(data.games, g.blackId, displayRound) : 0;
                const catName = categoryById.get(g.categoryId);
                const isBye = Boolean(g.isBye || g.result === 'bye');
                const isPending = !isBye && g.result === 'pending';

                return (
                  <div
                    key={`${g.round}-${g.board}`}
                    style={{
                      background: '#111827',
                      border: `2px solid ${isPending ? '#334155' : '#059669'}`,
                      borderRadius: '12px',
                      padding: '0.9rem 1.1rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.55rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span
                          style={{
                            background: '#2563eb',
                            color: '#ffffff',
                            fontWeight: 800,
                            fontSize: '1rem',
                            padding: '0.2rem 0.65rem',
                            borderRadius: '8px',
                          }}
                        >
                          Table {g.board}
                        </span>
                        {catName && (
                          <span
                            style={{
                              background: '#1e293b',
                              color: '#94a3b8',
                              fontSize: '0.8rem',
                              padding: '0.15rem 0.5rem',
                              borderRadius: '6px',
                            }}
                          >
                            {catName}
                          </span>
                        )}
                      </div>
                      <span
                        style={{
                          background: isPending ? '#334155' : '#065f46',
                          color: '#ffffff',
                          fontWeight: 700,
                          fontSize: '0.92rem',
                          padding: '0.2rem 0.65rem',
                          borderRadius: '999px',
                        }}
                      >
                        {formatResultLabel(g.result, isBye)}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: '#1e293b',
                        padding: '0.45rem 0.7rem',
                        borderRadius: '8px',
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: '1.05rem', color: '#f8fafc' }}>
                        ⚪ {white?.name ?? '—'}
                      </span>
                      <span style={{ fontWeight: 700, color: '#93c5fd', fontSize: '0.95rem' }}>
                        {resultPointsLabel(whitePts)} pts
                      </span>
                    </div>

                    {!isBye && (
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          background: '#0f172a',
                          padding: '0.45rem 0.7rem',
                          borderRadius: '8px',
                          border: '1px solid #1e293b',
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: '1.05rem', color: '#e2e8f0' }}>
                          ⚫ {black?.name ?? '—'}
                        </span>
                        <span style={{ fontWeight: 700, color: '#93c5fd', fontSize: '0.95rem' }}>
                          {resultPointsLabel(blackPts)} pts
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section style={{ flex: 1 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.75rem',
            }}
          >
            <h2 style={{ margin: 0, fontSize: '1.35rem', color: '#fbbf24' }}>
              🏆 {activeStandingsSection?.name ?? 'Standings'} (Top{' '}
              {activeStandingsSection?.prizePlaces ?? 3} Prize Places)
            </h2>
            <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
              Category {activeStandingsPage + 1} of {standingsPagesCount}
            </span>
          </div>

          {!activeStandingsSection || activeStandingsSection.rows.length === 0 ? (
            <div
              style={{
                background: '#111827',
                border: '1px solid #1f2937',
                borderRadius: '12px',
                padding: '3rem',
                textAlign: 'center',
                color: '#94a3b8',
                fontSize: '1.2rem',
              }}
            >
              No standings recorded yet.
            </div>
          ) : (
            <div
              style={{
                background: '#111827',
                border: '1px solid #1f2937',
                borderRadius: '12px',
                overflow: 'hidden',
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '1.08rem',
                }}
              >
                <thead>
                  <tr style={{ background: '#1e293b', color: '#cbd5e1', textAlign: 'left' }}>
                    <th style={{ padding: '0.75rem 1rem' }}>Rank</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Player</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Rating</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Score</th>
                    <th style={{ padding: '0.75rem 1rem' }}>BH</th>
                    <th style={{ padding: '0.75rem 1rem' }}>BH-C1</th>
                    <th style={{ padding: '0.75rem 1rem' }}>SB</th>
                  </tr>
                </thead>
                <tbody>
                  {activeStandingsSection.rows.slice(0, 16).map((row) => {
                    const isPrize = row.rank <= activeStandingsSection.prizePlaces;
                    return (
                      <tr
                        key={row.id}
                        style={{
                          borderTop: '1px solid #1f2937',
                          background: isPrize ? 'rgba(245, 158, 11, 0.1)' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '0.65rem 1rem', fontWeight: 800 }}>
                          {row.rank === 1
                            ? '🥇 1'
                            : row.rank === 2
                              ? '🥈 2'
                              : row.rank === 3
                                ? '🥉 3'
                                : row.rank}
                        </td>
                        <td style={{ padding: '0.65rem 1rem', fontWeight: 700, color: '#ffffff' }}>
                          {row.name}
                        </td>
                        <td style={{ padding: '0.65rem 1rem', color: '#94a3b8' }}>
                          {row.rating && row.rating > 0 ? row.rating : 'Unr.'}
                        </td>
                        <td
                          style={{
                            padding: '0.65rem 1rem',
                            fontWeight: 800,
                            color: '#fbbf24',
                          }}
                        >
                          {resultPointsLabel(row.score)}
                        </td>
                        <td style={{ padding: '0.65rem 1rem', color: '#cbd5e1' }}>
                          {resultPointsLabel(row.buchholz)}
                        </td>
                        <td style={{ padding: '0.65rem 1rem', color: '#cbd5e1' }}>
                          {resultPointsLabel(row.buchholzCut1)}
                        </td>
                        <td style={{ padding: '0.65rem 1rem', color: '#cbd5e1' }}>
                          {resultPointsLabel(row.sonnebornBerger)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
