import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { ArbiterScorableResult } from '@chess-alokas/shared';
import {
  apiPublicTableGet,
  apiPublicTableResult,
  apiPublicTableSession,
  type FloorTableView,
} from '../api/client';

const SESSION_KEY = (slug: string) => `chess-alokas-arbiter-session:${slug}`;

const RESULT_OPTIONS: { value: ArbiterScorableResult; label: string; hint: string }[] = [
  { value: '1-0', label: 'White wins', hint: '1–0' },
  { value: '0-1', label: 'Black wins', hint: '0–1' },
  { value: '1/2-1/2', label: 'Draw', hint: '½–½' },
  { value: '1-0F', label: 'Black forfeit', hint: 'White wins' },
  { value: '0-1F', label: 'White forfeit', hint: 'Black wins' },
  { value: '0-0', label: 'Both absent', hint: '0–0' },
];

function loadSession(slug: string): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY(slug));
  } catch {
    return null;
  }
}

function saveSession(slug: string, token: string) {
  try {
    sessionStorage.setItem(SESSION_KEY(slug), token);
  } catch {
    /* ignore */
  }
}

function clearSession(slug: string) {
  try {
    sessionStorage.removeItem(SESSION_KEY(slug));
  } catch {
    /* ignore */
  }
}

function resultLabel(result: string | null): string {
  if (!result) return '';
  const opt = RESULT_OPTIONS.find((o) => o.value === result);
  return opt ? `${opt.label} (${opt.hint})` : result;
}

export default function TableScoringPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [view, setView] = useState<FloorTableView | null>(null);
  const [token, setToken] = useState<string | null>(() => (slug ? loadSession(slug) : null));
  const [pin, setPin] = useState('');
  const [selected, setSelected] = useState<ArbiterScorableResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (session = token) => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    const res = await apiPublicTableGet(slug, session);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setView(null);
      return;
    }
    setView(res.data);
    if (res.data.status === 'needs_pin' && session) {
      clearSession(slug);
      setToken(null);
    }
  }, [slug, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    if (!slug || busy) return;
    setBusy(true);
    setError(null);
    const res = await apiPublicTableSession(slug, pin.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    saveSession(slug, res.data.token);
    setToken(res.data.token);
    setView(res.data.table);
    setPin('');
  }

  async function confirmResult() {
    if (!slug || !token || !selected || busy) return;
    setBusy(true);
    setError(null);
    const res = await apiPublicTableResult(slug, token, selected);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      if (/PIN|session|expired/i.test(res.error)) {
        clearSession(slug);
        setToken(null);
        void refresh(null);
      }
      return;
    }
    setView(res.data.table);
    setConfirming(false);
    setSelected(null);
  }

  if (!slug) {
    return (
      <div className="table-score-page">
        <p className="form-error">Invalid table link.</p>
      </div>
    );
  }

  return (
    <div className="table-score-page">
      <header className="table-score-header">
        <p className="table-score-brand">Chess Alokas</p>
        <h1>Table {view?.tableNumber ?? '…'}</h1>
        {view && <p className="table-score-tour">{view.tournamentName}</p>}
      </header>

      {loading && !view && <p className="form-hint">Loading table…</p>}
      {error && <div className="form-error">{error}</div>}

      {view?.status === 'needs_pin' && (
        <form className="table-score-card" onSubmit={(e) => void submitPin(e)}>
          <h2>Enter round PIN</h2>
          <p className="form-hint">
            Ask the director for this round&apos;s PIN. It changes every new round.
          </p>
          <label>
            PIN
            <input
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || pin.trim().length < 4}>
            {busy ? 'Checking…' : 'Unlock table'}
          </button>
        </form>
      )}

      {view && view.sessionOk && view.status === 'no_game' && (
        <div className="table-score-card">
          <h2>No game this round</h2>
          <p className="form-hint">
            Round {view.pinRound ?? '—'} has no pairing on this table yet.
          </p>
        </div>
      )}

      {view && view.sessionOk && view.status === 'confirmed_closed' && (
        <div className="table-score-card">
          <h2>Round closed</h2>
          <p className="form-hint">The director has confirmed this round. Scoring is locked.</p>
        </div>
      )}

      {view && view.sessionOk && view.status === 'bye' && (
        <div className="table-score-card">
          <h2>Bye</h2>
          <p className="form-hint">
            Round {view.round} — {view.whiteName ?? view.blackName ?? 'Player'} has a bye (1 pt).
          </p>
        </div>
      )}

      {view && view.sessionOk && view.status === 'locked' && (
        <div className="table-score-card is-locked">
          <h2>Result locked</h2>
          <p className="table-score-round">Round {view.round}</p>
          <div className="table-score-players">
            <div>
              <span className="table-score-side">White</span>
              <strong>{view.whiteName ?? '—'}</strong>
            </div>
            <div>
              <span className="table-score-side">Black</span>
              <strong>{view.blackName ?? '—'}</strong>
            </div>
          </div>
          <p className="table-score-result">{resultLabel(view.result)}</p>
          <p className="form-hint">This result cannot be changed from the floor.</p>
        </div>
      )}

      {view && view.sessionOk && view.status === 'pending' && !confirming && (
        <div className="table-score-card">
          <p className="table-score-round">Round {view.round}</p>
          <div className="table-score-players">
            <div>
              <span className="table-score-side">White</span>
              <strong>{view.whiteName ?? '—'}</strong>
            </div>
            <div>
              <span className="table-score-side">Black</span>
              <strong>{view.blackName ?? '—'}</strong>
            </div>
          </div>
          <h2>Select result</h2>
          <div className="table-score-options">
            {RESULT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`table-score-opt ${selected === opt.value ? 'active' : ''}`}
                onClick={() => setSelected(opt.value)}
              >
                <strong>{opt.label}</strong>
                <span>{opt.hint}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selected}
            onClick={() => setConfirming(true)}
          >
            Continue
          </button>
        </div>
      )}

      {view && view.sessionOk && view.status === 'pending' && confirming && selected && (
        <div className="table-score-card">
          <h2>Confirm result</h2>
          <p className="table-score-round">Round {view.round} · Table {view.tableNumber}</p>
          <div className="table-score-players">
            <div>
              <span className="table-score-side">White</span>
              <strong>{view.whiteName ?? '—'}</strong>
            </div>
            <div>
              <span className="table-score-side">Black</span>
              <strong>{view.blackName ?? '—'}</strong>
            </div>
          </div>
          <p className="table-score-result">{resultLabel(selected)}</p>
          <p className="form-hint stage-banner-warn">
            You cannot change this after confirm. Double-check names and result.
          </p>
          <div className="table-score-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void confirmResult()}
            >
              {busy ? 'Saving…' : 'Confirm result'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
