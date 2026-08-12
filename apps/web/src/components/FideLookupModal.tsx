import { useEffect, useMemo, useState } from 'react';
import {
  apiFideLookup,
  type FideLookupResultRow,
  type FidePlayerCandidate,
} from '../api/client';
import { db, nowIso, type LocalParticipant } from '../db/local';
import { syncOnline } from '../sync/sync';

type RatingType = 'standard' | 'rapid' | 'blitz';

type RowState = {
  participantId: string;
  name: string;
  currentRating: number | null;
  status: FideLookupResultRow['status'] | 'pending';
  selectedFideId: number | null;
  candidates: FidePlayerCandidate[];
  ratingType: RatingType;
  include: boolean;
};

function ratingFromCandidate(
  c: FidePlayerCandidate | undefined,
  type: RatingType,
): number | null {
  if (!c) return null;
  if (type === 'rapid') return c.rapid;
  if (type === 'blitz') return c.blitz;
  return c.standard;
}

function statusLabel(status: RowState['status']): string {
  switch (status) {
    case 'exact':
      return 'FIDE ID';
    case 'unique':
      return 'Unique match';
    case 'ambiguous':
      return 'Pick one';
    case 'not_found':
      return 'Not found';
    default:
      return '…';
  }
}

export default function FideLookupModal({
  tournamentId,
  participants,
  onClose,
}: {
  tournamentId: string;
  participants: LocalParticipant[];
  onClose: () => void;
}) {
  const [ratingType, setRatingType] = useState<RatingType>('standard');
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [lookedUp, setLookedUp] = useState(false);

  const activePlayers = useMemo(
    () => participants.filter((p) => !p.deletedAt),
    [participants],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && !applying) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, applying, onClose]);

  async function runLookup() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFideLookup(tournamentId, {
        ratingType,
        players: activePlayers.map((p) => ({
          id: p.id,
          name: p.name,
          country: p.country ?? null,
          yearOfBirth: p.yearOfBirth ?? null,
          fideId: p.fideId ?? null,
        })),
      });
      if (!res.ok || !res.data) {
        const msg = res.error ?? 'FIDE lookup failed';
        setError(
          /forbidden/i.test(msg)
            ? 'Lookup was blocked (sign in again, or Sync this tournament). If it persists after update, the API may still be deploying.'
            : msg,
        );
        return;
      }
      const byId = new Map(res.data.results.map((r) => [r.participantId, r]));
      setRows(
        activePlayers.map((p) => {
          const r = byId.get(p.id);
          const status = r?.status ?? 'not_found';
          const selected =
            r?.selectedFideId ??
            (r?.candidates.length === 1 ? r.candidates[0]!.fideId : null);
          return {
            participantId: p.id,
            name: p.name,
            currentRating: p.rating ?? null,
            status,
            selectedFideId: selected,
            candidates: r?.candidates ?? [],
            ratingType,
            include: status === 'exact' || status === 'unique',
          };
        }),
      );
      setLookedUp(true);
    } finally {
      setBusy(false);
    }
  }

  async function applySelected() {
    const toApply = rows.filter((r) => r.include && r.selectedFideId != null);
    if (toApply.length === 0) {
      setError('Select at least one matched player to apply.');
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const now = nowIso();
      for (const row of toApply) {
        const cand = row.candidates.find((c) => c.fideId === row.selectedFideId);
        const rating = ratingFromCandidate(cand, row.ratingType);
        const existing = await db.participants.get(row.participantId);
        if (!existing) continue;
        await db.participants.put({
          ...existing,
          fideId: row.selectedFideId,
          rating: rating ?? null,
          updatedAt: now,
          dirty: 1,
        });
      }
      void syncOnline();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply ratings');
    } finally {
      setApplying(false);
    }
  }

  const applyCount = rows.filter((r) => r.include && r.selectedFideId != null).length;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={() => !busy && !applying && onClose()}
    >
      <div
        className="modal-card fide-lookup-modal"
        role="dialog"
        aria-modal
        aria-labelledby="fide-lookup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <h2 id="fide-lookup-title">Look up FIDE ratings</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={busy || applying}
          >
            Close
          </button>
        </div>

        <p className="form-hint">
          Uses the monthly FIDE list (not live scrape). Confirm matches, choose standard / rapid /
          blitz, then apply. FIDE IDs are saved for next time. Not found / new players stay blank
          (—) — that&apos;s fine.
        </p>

        <div className="fide-lookup-controls">
          <label className="form-field">
            <span>Rating type</span>
            <select
              value={ratingType}
              disabled={busy || applying}
              onChange={(e) => {
                const next = e.target.value as RatingType;
                setRatingType(next);
                setRows((prev) => prev.map((r) => ({ ...r, ratingType: next })));
              }}
            >
              <option value="standard">Standard</option>
              <option value="rapid">Rapid</option>
              <option value="blitz">Blitz</option>
            </select>
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || applying || activePlayers.length === 0}
            onClick={() => void runLookup()}
          >
            {busy ? 'Looking up…' : lookedUp ? 'Look up again' : 'Look up'}
          </button>
        </div>

        {error && (
          <p className="form-hint stage-banner-warn" role="alert">
            {error}
          </p>
        )}

        {!lookedUp && !busy && (
          <p className="form-hint">{activePlayers.length} players in this tournament.</p>
        )}

        {lookedUp && (
          <div className="fide-lookup-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Apply</th>
                  <th>Name</th>
                  <th>Match</th>
                  <th>FIDE player</th>
                  <th>Std / Rap / Blz</th>
                  <th>Will set</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const selected = row.candidates.find((c) => c.fideId === row.selectedFideId);
                  const nextRating = ratingFromCandidate(selected, row.ratingType);
                  return (
                    <tr key={row.participantId}>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.include}
                          disabled={row.selectedFideId == null || applying}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setRows((prev) =>
                              prev.map((r) =>
                                r.participantId === row.participantId
                                  ? { ...r, include: checked }
                                  : r,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td>
                        {row.name}
                        {row.currentRating && row.currentRating > 0 ? (
                          <span className="form-hint"> (now {row.currentRating})</span>
                        ) : null}
                      </td>
                      <td>{statusLabel(row.status)}</td>
                      <td>
                        {row.candidates.length === 0 ? (
                          '—'
                        ) : row.candidates.length === 1 ? (
                          <>
                            {row.candidates[0]!.name}
                            {row.candidates[0]!.federation
                              ? ` (${row.candidates[0]!.federation})`
                              : ''}
                            {row.candidates[0]!.inactive ? ' · inactive' : ''}
                          </>
                        ) : (
                          <select
                            value={row.selectedFideId ?? ''}
                            disabled={applying}
                            onChange={(e) => {
                              const id = e.target.value ? Number(e.target.value) : null;
                              setRows((prev) =>
                                prev.map((r) =>
                                  r.participantId === row.participantId
                                    ? {
                                        ...r,
                                        selectedFideId: id,
                                        include: id != null,
                                        status: id != null ? 'unique' : 'ambiguous',
                                      }
                                    : r,
                                ),
                              );
                            }}
                          >
                            <option value="">Choose…</option>
                            {row.candidates.map((c) => (
                              <option key={c.fideId} value={c.fideId}>
                                {c.name} · {c.federation ?? '?'} · {c.birthYear ?? '—'}
                                {c.inactive ? ' · i' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        {selected
                          ? `${selected.standard ?? '—'} / ${selected.rapid ?? '—'} / ${selected.blitz ?? '—'}`
                          : '—'}
                      </td>
                      <td>{nextRating != null ? nextRating : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || applying}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!lookedUp || applying || busy || applyCount === 0}
            onClick={() => void applySelected()}
          >
            {applying ? 'Applying…' : `Apply ${applyCount} rating${applyCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
