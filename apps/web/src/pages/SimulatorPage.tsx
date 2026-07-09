import { useState, useCallback } from 'react';
import {
  createSimulation,
  pairNextRound,
  applyPendingResults,
  runAllRounds,
  getSimulationStandings,
  getSimulationDiagnostics,
} from '@chess-alokas/pairing-engine';
import type {
  SimulationState,
  ResultMode,
  SimPlayer,
} from '@chess-alokas/pairing-engine';
import type { GameResult } from '@chess-alokas/shared';
import ColorHorse from '../components/ColorHorse';

const DEFAULT_CONFIG = {
  playerCount: 12,
  rounds: 5,
  seed: 42,
  splitCategories: true,
  mixCategories: false,
  resultMode: 'rating_biased' as ResultMode,
};

function CategoryBadge({ cat }: { cat: SimPlayer['category'] }) {
  return <span className={`cat-badge cat-${cat}`}>{cat}</span>;
}

function BoardCard({
  board,
  whitePlayer,
  blackPlayer,
  resultMode,
  pendingResult,
  onSetResult,
}: {
  board: {
    board: number;
    whiteId: string | null;
    blackId: string | null;
    isBye: boolean;
    category?: string;
  };
  whitePlayer: SimPlayer | undefined;
  blackPlayer: SimPlayer | undefined;
  resultMode: ResultMode;
  pendingResult?: GameResult;
  onSetResult?: (board: number, result: GameResult) => void;
}) {
  const isManual = resultMode === 'manual';
  const results: GameResult[] = ['1-0', '1/2-1/2', '0-1'];

  if (board.isBye) {
    return (
      <div className="sim-board-card sim-board-bye">
        <span className="sim-board-num">Board {board.board}</span>
        {board.category && board.category !== 'open' && (
          <CategoryBadge cat={board.category as SimPlayer['category']} />
        )}
        <div className="sim-board-players">
          <span className="sim-player">{whitePlayer?.name ?? '—'}</span>
          <span className="sim-bye-tag">BYE (+1 pt)</span>
        </div>
      </div>
    );
  }

  return (
    <div className="sim-board-card">
      <span className="sim-board-num">Board {board.board}</span>
      {board.category && board.category !== 'open' && (
        <CategoryBadge cat={board.category as SimPlayer['category']} />
      )}
      <div className="sim-board-players">
        <div className="sim-player sim-white">
          <ColorHorse color="white" />
          <span className="sim-name">{whitePlayer?.name ?? '—'}</span>
          <span className="sim-rating">{whitePlayer?.rating}</span>
          {whitePlayer && <CategoryBadge cat={whitePlayer.category} />}
        </div>
        <span className="sim-vs">vs</span>
        <div className="sim-player sim-black">
          <ColorHorse color="black" />
          <span className="sim-name">{blackPlayer?.name ?? '—'}</span>
          <span className="sim-rating">{blackPlayer?.rating}</span>
          {blackPlayer && <CategoryBadge cat={blackPlayer.category} />}
        </div>
      </div>
      {isManual && onSetResult && (
        <div className="sim-manual-result">
          {results.map((r) => (
            <button
              key={r}
              className={`result-btn ${pendingResult === r ? 'active' : ''}`}
              onClick={() => onSetResult(board.board, r)}
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DiagnosticsPanel({
  state,
}: {
  state: SimulationState;
}) {
  if (state.pastGames.length === 0) return null;
  const diag = getSimulationDiagnostics(state);
  const imbalanced = diag.colorImbalances.filter((c) => Math.abs(c.imbalance) > 1);
  const byeEntries = Object.entries(diag.byeCounts);

  return (
    <div className="diag-panel">
      <h3 className="diag-title">Diagnostics</h3>
      <div className="diag-grid">
        <div className="diag-card">
          <span className="diag-val">{diag.rematchCount}</span>
          <span className="diag-label">Rematches</span>
        </div>
        <div className="diag-card">
          <span className="diag-val">{byeEntries.length}</span>
          <span className="diag-label">Players w/ Bye</span>
        </div>
        <div className="diag-card">
          <span className="diag-val">{imbalanced.length}</span>
          <span className="diag-label">Color Imbalances</span>
        </div>
        <div className="diag-card">
          <span className="diag-val">{state.roundsPlayed.length}</span>
          <span className="diag-label">Rounds Done</span>
        </div>
      </div>

      {byeEntries.length > 0 && (
        <div className="diag-section">
          <h4>Bye Distribution</h4>
          <ul className="diag-list">
            {byeEntries.map(([id, cnt]) => {
              const p = state.players.find((pl) => pl.id === id);
              return (
                <li key={id}>
                  {p?.name ?? id}: <strong>{cnt}×</strong>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {imbalanced.length > 0 && (
        <div className="diag-section">
          <h4>Color Imbalances (&gt;±1)</h4>
          <ul className="diag-list">
            {imbalanced.map((ci) => (
              <li key={ci.id}>
                {ci.name}:{' '}
                <strong className={ci.imbalance > 0 ? 'clr-white-heavy' : 'clr-black-heavy'}>
                  {ci.imbalance > 0 ? `+${ci.imbalance} White` : `${ci.imbalance} Black`}
                </strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function SimulatorPage() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [state, setState] = useState<SimulationState | null>(null);
  const [manualOverrides, setManualOverrides] = useState<
    Array<{ board: number; result: GameResult }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const [standingsTab, setStandingsTab] = useState<'under12' | 'under18' | 'all'>('all');

  const cfg = (patch: Partial<typeof config>) =>
    setConfig((c) => ({ ...c, ...patch }));

  const bump = () => setAnimKey((k) => k + 1);
  const clearError = () => setError(null);

  const handleGenerate = useCallback(() => {
    clearError();
    try {
      const sim = createSimulation(config);
      setState(sim);
      setManualOverrides([]);
      setStandingsTab('all');
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate');
    }
  }, [config]);

  const handlePairNext = useCallback(() => {
    if (!state) return;
    clearError();
    try {
      setState(pairNextRound(state));
      setManualOverrides([]);
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [state]);

  const handleApplyResults = useCallback(() => {
    if (!state) return;
    clearError();
    try {
      setState(applyPendingResults(state, manualOverrides.length ? manualOverrides : undefined));
      setManualOverrides([]);
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [state, manualOverrides]);

  const handleRunAll = useCallback(() => {
    if (!state) return;
    clearError();
    try {
      setState(runAllRounds(state));
      setManualOverrides([]);
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [state]);

  const handleReset = () => {
    setState(null);
    setManualOverrides([]);
    clearError();
  };

  const setManualResult = useCallback((board: number, result: GameResult) => {
    setManualOverrides((prev) => {
      const next = prev.filter((o) => o.board !== board);
      return [...next, { board, result }];
    });
  }, []);

  const playerById = new Map((state?.players ?? []).map((p) => [p.id, p]));
  const separatePools =
    Boolean(state?.config.splitCategories) && !state?.config.mixCategories;
  const standings = state
    ? getSimulationStandings(
        state,
        separatePools && standingsTab !== 'all' ? standingsTab : undefined,
      )
    : [];

  const canPair = state !== null && !state.pendingBoards && state.currentRound < state.config.rounds;
  const canApply = state !== null && state.pendingBoards !== null;
  const canRunAll = state !== null && !state.pendingBoards && state.currentRound < state.config.rounds;
  const isDone = state !== null && state.currentRound >= state.config.rounds && !state.pendingBoards;

  const pendingByCategory = (() => {
    if (!state?.pendingBoards) return null;
    if (!separatePools) return { open: state.pendingBoards };
    const groups: Record<string, typeof state.pendingBoards> = {
      under12: [],
      under18: [],
    };
    for (const b of state.pendingBoards) {
      const key = b.category === 'under18' ? 'under18' : 'under12';
      groups[key]!.push(b);
    }
    return groups;
  })();

  return (
    <div className="page-container simulator-page">
      <div className="page-header">
        <h1>
          <span className="sim-chess-icon">♟</span> Pairing Simulator
        </h1>
        <p className="page-subtitle">
          Test and visualize the Swiss pairing engine with generated players.
        </p>
      </div>

      {/* Controls */}
      <section className="sim-controls">
        <div className="sim-controls-grid">
          <div className="form-group">
            <label>Players</label>
            <input
              type="number"
              className="input input-sm"
              min={2}
              max={64}
              value={config.playerCount}
              onChange={(e) => cfg({ playerCount: Math.max(2, parseInt(e.target.value) || 8) })}
            />
          </div>
          <div className="form-group">
            <label>Rounds</label>
            <input
              type="number"
              className="input input-sm"
              min={1}
              max={15}
              value={config.rounds}
              onChange={(e) => cfg({ rounds: Math.max(1, parseInt(e.target.value) || 5) })}
            />
          </div>
          <div className="form-group">
            <label>Seed</label>
            <input
              type="number"
              className="input input-sm"
              value={config.seed}
              onChange={(e) => cfg({ seed: parseInt(e.target.value) || 42 })}
            />
          </div>
          <div className="form-group">
            <label>Result Mode</label>
            <select
              className="input input-sm"
              value={config.resultMode}
              onChange={(e) => cfg({ resultMode: e.target.value as ResultMode })}
            >
              <option value="rating_biased">Rating-biased</option>
              <option value="random">Random</option>
              <option value="manual">Manual</option>
            </select>
          </div>
          <div className="form-group form-group-check">
            <label className="check-label">
              <input
                type="checkbox"
                checked={config.splitCategories}
                onChange={(e) =>
                  cfg({
                    splitCategories: e.target.checked,
                    mixCategories: e.target.checked ? config.mixCategories : false,
                  })
                }
              />
              Split into U12 / U18 categories
            </label>
          </div>
          {config.splitCategories && (
            <div className="form-group form-group-check">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={config.mixCategories}
                  onChange={(e) => cfg({ mixCategories: e.target.checked })}
                />
                Allow mixed matches (one shared pool)
              </label>
            </div>
          )}
        </div>

        <div className="sim-buttons">
          <button className="btn btn-primary" onClick={handleGenerate}>
            Generate Players
          </button>
          <button
            className="btn btn-wood"
            onClick={handlePairNext}
            disabled={!canPair}
          >
            Pair Round {state ? state.currentRound + 1 : '—'}
          </button>
          <button
            className="btn btn-outline"
            onClick={handleApplyResults}
            disabled={!canApply}
          >
            Apply Results
          </button>
          <button
            className="btn btn-outline"
            onClick={handleRunAll}
            disabled={!canRunAll}
          >
            Run All Rounds
          </button>
          <button className="btn btn-ghost btn-danger" onClick={handleReset} disabled={!state}>
            Reset
          </button>
        </div>

        {error && <div className="form-error sim-error">{error}</div>}

        {state && (
          <div className="sim-status-bar">
            <span>
              Players: <strong>{state.players.length}</strong>
            </span>
            <span>
              Round: <strong>{state.currentRound}</strong> / {state.config.rounds}
            </span>
            <span>
              Mode: <strong>{state.config.resultMode}</strong>
            </span>
            {state.config.splitCategories && (
              <span>
                Categories:{' '}
                <strong>
                  {state.config.mixCategories ? 'Mixed pool' : 'Separate U12 / U18'}
                </strong>
              </span>
            )}
            {isDone && <span className="sim-done-tag">✓ Tournament complete</span>}
            {canApply && (
              <span className="sim-pending-tag">
                ⏳ Pending results for round {state.currentRound}
              </span>
            )}
          </div>
        )}
      </section>

      {state && (
        <div className="sim-body">
          {/* Current Boards */}
          {state.pendingBoards && pendingByCategory && (
            <section className="sim-section" key={`boards-${animKey}`}>
              <h2 className="sim-section-title">
                Round {state.currentRound} — Boards ({state.pendingBoards.length})
              </h2>
              {Object.entries(pendingByCategory).map(([cat, boards]) =>
                boards.length === 0 ? null : (
                  <div key={cat} className="sim-cat-block">
                    {separatePools && (
                      <h3 className="sim-cat-heading">
                        {cat === 'under12'
                          ? 'Under 12'
                          : cat === 'under18'
                            ? 'Under 18'
                            : 'Open'}
                      </h3>
                    )}
                    <div className="sim-boards-grid">
                      {boards.map((board) => (
                        <BoardCard
                          key={board.board}
                          board={board}
                          whitePlayer={
                            board.whiteId ? playerById.get(board.whiteId) : undefined
                          }
                          blackPlayer={
                            board.blackId ? playerById.get(board.blackId) : undefined
                          }
                          resultMode={state.config.resultMode}
                          pendingResult={
                            manualOverrides.find((o) => o.board === board.board)?.result
                          }
                          onSetResult={setManualResult}
                        />
                      ))}
                    </div>
                  </div>
                ),
              )}
              {state.config.resultMode === 'manual' && (
                <p className="form-hint">
                  Set results for each board above, then click &quot;Apply Results&quot;.
                </p>
              )}
            </section>
          )}

          {/* Completed Round History */}
          {state.roundsPlayed.length > 0 && (
            <section className="sim-section">
              <h2 className="sim-section-title">Round History</h2>
              <div className="sim-round-history">
                {[...state.roundsPlayed].reverse().map((rnd) => (
                  <details key={rnd.round} className="round-details">
                    <summary className="round-summary">
                      Round {rnd.round}{' '}
                      <span className="round-count">({rnd.boards.length} boards)</span>
                    </summary>
                    <div className="round-boards">
                      {rnd.boards.map((b) => {
                        const resultEntry = rnd.results.find((r) => r.board === b.board);
                        const result = resultEntry?.result ?? 'pending';
                        const white = b.whiteId ? playerById.get(b.whiteId) : undefined;
                        const black = b.blackId ? playerById.get(b.blackId) : undefined;
                        return (
                          <div key={b.board} className={`history-row ${b.isBye ? 'history-bye' : ''}`}>
                            <span className="history-board">#{b.board}</span>
                            <span className="history-white">{white?.name ?? '—'}</span>
                            <span className={`history-result result-${result.replace('/', '-')}`}>
                              {result}
                            </span>
                            <span className="history-black">{black?.name ?? (b.isBye ? 'BYE' : '—')}</span>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}

          {/* Standings */}
          {standings.length > 0 && (
            <section className="sim-section" key={`standings-${animKey}`}>
              <h2 className="sim-section-title">
                Standings{' '}
                {isDone && <span className="final-tag">Final</span>}
              </h2>
              {separatePools && (
                <div className="category-tabs sim-standings-tabs">
                  {(
                    [
                      ['all', 'All categories'],
                      ['under12', 'Under 12'],
                      ['under18', 'Under 18'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`cat-tab ${standingsTab === key ? 'active' : ''}`}
                      onClick={() => setStandingsTab(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <table className="data-table standings-table sim-standings">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Name</th>
                    <th>Cat</th>
                    <th>Rating</th>
                    <th>Score</th>
                    <th>Buchholz</th>
                    <th>W</th>
                    <th>B</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((s) => {
                    const simPlayer = playerById.get(s.id);
                    const whites = s.colors.filter((c) => c === 'W').length;
                    const blacks = s.colors.filter((c) => c === 'B').length;
                    return (
                      <tr key={s.id} className={s.rank <= 3 ? `rank-${s.rank}` : ''}>
                        <td className="rank-cell">
                          {s.rank === 1
                            ? '🥇'
                            : s.rank === 2
                              ? '🥈'
                              : s.rank === 3
                                ? '🥉'
                                : s.rank}
                        </td>
                        <td>{s.name}</td>
                        <td>
                          {simPlayer && <CategoryBadge cat={simPlayer.category} />}
                        </td>
                        <td>{s.rating || '—'}</td>
                        <td className="score-cell">
                          <span className="score-pill">{s.score}</span>
                        </td>
                        <td>{s.buchholz.toFixed(1)}</td>
                        <td>{whites}</td>
                        <td>{blacks}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {/* Players roster (collapsed by default) */}
          <section className="sim-section">
            <details>
              <summary className="sim-roster-summary">
                Players Roster ({state.players.length})
              </summary>
              <table className="data-table sim-roster-table">
                <thead>
                  <tr>
                    <th>Seed</th>
                    <th>Name</th>
                    <th>Rating</th>
                    <th>Age</th>
                    <th>Category</th>
                    <th>Gender</th>
                  </tr>
                </thead>
                <tbody>
                  {[...state.players]
                    .sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0))
                    .map((p) => (
                      <tr key={p.id}>
                        <td>{p.seed}</td>
                        <td>{p.name}</td>
                        <td>{p.rating}</td>
                        <td>{p.age}</td>
                        <td>
                          <CategoryBadge cat={p.category} />
                        </td>
                        <td>{p.gender ?? '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
          </section>

          {/* Diagnostics */}
          <DiagnosticsPanel state={state} />
        </div>
      )}

      {!state && (
        <div className="sim-empty">
          <div className="sim-empty-board" aria-hidden="true" />
          <p>Configure your simulation above and click <strong>Generate Players</strong> to begin.</p>
        </div>
      )}
    </div>
  );
}
