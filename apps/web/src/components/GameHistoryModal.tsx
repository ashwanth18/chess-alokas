import { useEffect, useState } from 'react';
import type { GameCorrection, GameResultEvent } from '@chess-alokas/shared';
import { apiGameHistory } from '../api/client';

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Who changed a result, when, from what to what, and why. */
export default function GameHistoryModal({
  gameId,
  round,
  board,
  queued,
  onClose,
}: {
  gameId: string;
  round: number;
  board: number;
  /** Corrections on this device that haven't reached the server yet. */
  queued: GameCorrection[];
  onClose: () => void;
}) {
  const [events, setEvents] = useState<GameResultEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void apiGameHistory(gameId).then((res) => {
      if (!live) return;
      if (res.ok) setEvents(res.data.events);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [gameId]);

  const rows = [
    ...[...queued].reverse().map((c) => ({
      id: c.id,
      at: c.at,
      who: c.actorName ?? 'Director',
      from: c.previousResult as string | null | undefined,
      to: c.result as string,
      why: c.reason as string | null | undefined,
      queued: true,
    })),
    ...(events ?? []).map((e) => ({
      id: e.id,
      at: e.createdAt,
      who: e.actorName ?? (e.actorRole === 'floor' ? 'Floor' : 'Director'),
      from: e.previousResult,
      to: e.result as string,
      why: e.note,
      queued: false,
    })),
  ];

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card result-change-modal"
        role="dialog"
        aria-modal
        aria-labelledby="game-history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="game-history-title">
          Round {round}, Table {board}
        </h2>
        {failed && <p className="form-hint">Couldn't load the history. Check your connection.</p>}
        {rows.length === 0 && !failed && <p className="form-hint">{events ? 'No changes.' : 'Loading…'}</p>}
        {rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Result</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {when(row.at)}
                      {row.queued ? ' · queued' : ''}
                    </td>
                    <td>{row.who}</td>
                    <td>
                      {row.from ?? '—'} → {row.to}
                    </td>
                    <td>{row.why ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
