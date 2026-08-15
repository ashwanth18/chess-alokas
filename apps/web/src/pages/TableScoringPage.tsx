import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ArbiterScorableResult, GameCardType } from '@chess-alokas/shared';
import {
  ILLEGAL_MOVE_LIMIT,
  WARNING_LIMIT,
  emptyCardCounts,
  isAbsenceResult,
} from '@chess-alokas/shared';
import {
  apiPublicTableCard,
  apiPublicTableGet,
  apiPublicTableResult,
  apiPublicTableSession,
  checkOnline,
  type FloorTableView,
  type PlayerCardCounts,
} from '../api/client';
import ColorSide from '../components/ColorSide';
import TableQrScanner from '../components/TableQrScanner';
import {
  clearFloorPin,
  loadFloorCredentials,
  saveFloorCredentials,
} from '../lib/floorCredentials';

function networkErrorMessage(raw: string): string {
  if (/abort|timeout|timed out|failed to fetch|network|load failed|offline/i.test(raw)) {
    return 'No connection — reconnect and try again. The result was not saved.';
  }
  return raw;
}

const SESSION_KEY = (slug: string) => `chess-alokas-arbiter-session:${slug}`;

const RESULT_OPTIONS: { value: ArbiterScorableResult; label: string; hint: string }[] = [
  { value: '1-0', label: 'White wins', hint: '1–0' },
  { value: '0-1', label: 'Black wins', hint: '0–1' },
  { value: '1/2-1/2', label: 'Draw', hint: '½–½' },
  { value: '1-0F', label: 'Black absent', hint: 'White wins' },
  { value: '0-1F', label: 'White absent', hint: 'Black wins' },
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

function boardHasCards(view: FloorTableView): boolean {
  return (
    (view.whiteCards?.illegalMove ?? 0) +
      (view.whiteCards?.warning ?? 0) +
      (view.blackCards?.illegalMove ?? 0) +
      (view.blackCards?.warning ?? 0) >
    0
  );
}

function CardChips({ counts }: { counts: PlayerCardCounts }) {
  return (
    <div className="floor-card-chips">
      <span className="floor-card-chip floor-card-yellow" title="Warnings">
        🟡 {counts.warning}/{WARNING_LIMIT}
      </span>
      <span className="floor-card-chip floor-card-red" title="Illegal moves">
        🔴 {counts.illegalMove}/{ILLEGAL_MOVE_LIMIT}
      </span>
    </div>
  );
}

function Matchup({
  whiteName,
  blackName,
  whiteCards,
  blackCards,
  canIssue,
  busy,
  online,
  onIssue,
}: {
  whiteName: string | null;
  blackName: string | null;
  whiteCards?: PlayerCardCounts | null;
  blackCards?: PlayerCardCounts | null;
  canIssue?: boolean;
  busy?: boolean;
  online?: boolean;
  onIssue?: (side: 'white' | 'black', cardType: GameCardType) => void;
}) {
  const w = whiteCards ?? emptyCardCounts();
  const b = blackCards ?? emptyCardCounts();
  return (
    <div className="table-score-matchup">
      <div className="table-score-player table-score-player-white">
        <ColorSide color="white" />
        <div className="table-score-player-meta">
          <strong className="table-score-player-name">{whiteName ?? '—'}</strong>
          <CardChips counts={w} />
          {canIssue && onIssue && (
            <div className="floor-card-actions">
              <button
                type="button"
                className="btn btn-sm floor-btn-yellow"
                disabled={busy || !online || w.warning >= WARNING_LIMIT}
                onClick={() => onIssue('white', 'warning')}
              >
                Warning
              </button>
              <button
                type="button"
                className="btn btn-sm floor-btn-red"
                disabled={busy || !online || w.illegalMove >= ILLEGAL_MOVE_LIMIT}
                onClick={() => onIssue('white', 'illegal_move')}
              >
                Illegal
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="table-score-vs" aria-hidden>
        vs
      </div>
      <div className="table-score-player table-score-player-black">
        <ColorSide color="black" onDark />
        <div className="table-score-player-meta">
          <strong className="table-score-player-name">{blackName ?? '—'}</strong>
          <CardChips counts={b} />
          {canIssue && onIssue && (
            <div className="floor-card-actions">
              <button
                type="button"
                className="btn btn-sm floor-btn-yellow"
                disabled={busy || !online || b.warning >= WARNING_LIMIT}
                onClick={() => onIssue('black', 'warning')}
              >
                Warning
              </button>
              <button
                type="button"
                className="btn btn-sm floor-btn-red"
                disabled={busy || !online || b.illegalMove >= ILLEGAL_MOVE_LIMIT}
                onClick={() => onIssue('black', 'illegal_move')}
              >
                Illegal
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TableScoringPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [view, setView] = useState<FloorTableView | null>(null);
  const [token, setToken] = useState<string | null>(() => (slug ? loadSession(slug) : null));
  const [arbiterName, setArbiterName] = useState('');
  const [pin, setPin] = useState('');
  const [selected, setSelected] = useState<ArbiterScorableResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cardPending, setCardPending] = useState<{
    side: 'white' | 'black';
    cardType: GameCardType;
  } | null>(null);
  const [cardNote, setCardNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const markOnline = () => {
      setOnline(true);
      void checkOnline().then(setOnline);
    };
    const markOffline = () => setOnline(false);
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
    void checkOnline().then(setOnline);
    const interval = setInterval(() => {
      void checkOnline().then(setOnline);
    }, 15_000);
    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
      clearInterval(interval);
    };
  }, []);

  const refresh = useCallback(
    async (session = token) => {
      if (!slug) return;
      setLoading(true);
      setError(null);
      const res = await apiPublicTableGet(slug, session);
      setLoading(false);
      if (!res.ok) {
        setError(networkErrorMessage(res.error));
        if (/abort|timeout|timed out|failed to fetch|network|load failed|offline/i.test(res.error)) {
          setOnline(false);
        }
        setView(null);
        return;
      }
      setOnline(true);
      setView(res.data);
      const creds = loadFloorCredentials(res.data.tournamentId);
      if (creds) {
        setArbiterName((n) => n || creds.arbiterName);
        if (creds.pinRound != null && res.data.pinRound != null && creds.pinRound !== res.data.pinRound) {
          clearFloorPin(res.data.tournamentId);
          setPin('');
        } else if (creds.pin && !session) {
          setPin(creds.pin);
        }
      }
      if (res.data.status === 'needs_pin' && session) {
        clearSession(slug);
        setToken(null);
      }
    },
    [slug, token],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    if (!slug || busy) return;
    if (!online) {
      setError('No connection — unlock needs internet.');
      return;
    }
    const name = arbiterName.trim();
    if (name.length < 1) {
      setError('Enter your name');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await apiPublicTableSession(slug, pin.trim());
    setBusy(false);
    if (!res.ok) {
      setError(networkErrorMessage(res.error));
      if (/abort|timeout|timed out|failed to fetch|network|load failed|offline/i.test(res.error)) {
        setOnline(false);
      }
      return;
    }
    setOnline(true);
    saveSession(slug, res.data.token);
    setToken(res.data.token);
    setView(res.data.table);
    saveFloorCredentials(res.data.table.tournamentId, {
      arbiterName: name,
      pin: pin.trim(),
      pinRound: res.data.table.pinRound,
    });
  }

  async function issueCard() {
    if (!slug || !token || !cardPending || busy) return;
    if (!online) {
      setError('No connection — card was not saved.');
      return;
    }
    const name = arbiterName.trim();
    if (name.length < 1) {
      setError('Enter your name before issuing a card');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await apiPublicTableCard(slug, token, {
      playerSide: cardPending.side,
      cardType: cardPending.cardType,
      note: cardNote.trim() || undefined,
      arbiterName: name,
    });
    setBusy(false);
    if (!res.ok) {
      setError(networkErrorMessage(res.error));
      if (/PIN|session|expired/i.test(res.error)) {
        clearSession(slug);
        setToken(null);
        void refresh(null);
      }
      return;
    }
    setView(res.data.table);
    setCardPending(null);
    setCardNote('');
    setConfirming(false);
    setSelected(null);
    if (res.data.forfeited) {
      setError(null);
    }
  }

  async function confirmResult() {
    if (!slug || !token || !selected || busy) return;
    if (!online) {
      setError('No connection — result was not saved. Reconnect and confirm again.');
      return;
    }
    const name = arbiterName.trim();
    if (name.length < 1) {
      setError('Enter your name before confirming');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await apiPublicTableResult(slug, token, selected, name);
    setBusy(false);
    if (!res.ok) {
      setError(networkErrorMessage(res.error));
      if (/abort|timeout|timed out|failed to fetch|network|load failed|offline/i.test(res.error)) {
        setOnline(false);
      }
      if (/PIN|session|expired/i.test(res.error)) {
        clearSession(slug);
        setToken(null);
        void refresh(null);
      }
      return;
    }
    setOnline(true);
    if (view?.tournamentId) {
      saveFloorCredentials(view.tournamentId, {
        arbiterName: name,
        pin: loadFloorCredentials(view.tournamentId)?.pin ?? '',
        pinRound: view.pinRound,
      });
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

  const showScan =
    view &&
    (view.status === 'locked' ||
      view.status === 'bye' ||
      view.status === 'no_game' ||
      view.status === 'confirmed_closed');

  return (
    <div className="table-score-page">
      <header className="table-score-header">
        <div className="table-score-header-row">
          <p className="table-score-brand">Chess Alokas</p>
          <span className="table-score-conn" title={online ? 'API reachable' : 'Offline'}>
            <span className={`status-dot ${online ? 'online' : 'offline'}`} />
            <span className="status-label">{online ? 'Online' : 'Offline'}</span>
          </span>
        </div>
        <h1>Table {view?.tableNumber ?? '…'}</h1>
        {view && <p className="table-score-tour">{view.tournamentName}</p>}
      </header>

      {!online && (
        <div className="table-score-offline" role="status">
          <strong>No internet</strong>
          <span>Results will not save until this phone is back online. Do not leave the table yet.</span>
        </div>
      )}

      {loading && !view && <p className="form-hint">Loading table…</p>}
      {error && <div className="form-error">{error}</div>}

      {view?.status === 'needs_pin' && (
        <form className="table-score-card" onSubmit={(e) => void submitPin(e)}>
          <h2>Unlock table</h2>
          <p className="form-hint">
            Your name is saved on this phone. The PIN is remembered until the director rotates it.
          </p>
          <label>
            Your name
            <input
              className="input"
              autoComplete="name"
              value={arbiterName}
              onChange={(e) => setArbiterName(e.target.value)}
              required
              maxLength={80}
              placeholder="Floor arbiter name"
            />
          </label>
          <label>
            Round PIN
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
          <button
            type="submit"
            className="btn btn-primary"
            disabled={
              busy || !online || pin.trim().length < 4 || arbiterName.trim().length < 1
            }
          >
            {busy ? 'Checking…' : online ? 'Unlock table' : 'Waiting for connection…'}
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
          <Matchup
            whiteName={view.whiteName}
            blackName={view.blackName}
            whiteCards={view.whiteCards}
            blackCards={view.blackCards}
          />
          <p className="table-score-result">{resultLabel(view.result)}</p>
          {view.forfeitReason && (
            <p className="form-hint stage-banner-warn">Auto-loss: {view.forfeitReason}</p>
          )}
          <p className="form-hint">This result cannot be changed from the floor.</p>
        </div>
      )}

      {view && view.sessionOk && view.status === 'pending' && cardPending && (
        <div className="table-score-card">
          <h2>
            Issue {cardPending.cardType === 'warning' ? 'yellow warning' : 'red illegal-move'} card
          </h2>
          <p className="table-score-round">
            {cardPending.side === 'white' ? view.whiteName : view.blackName}
            {' · '}
            {cardPending.cardType === 'warning'
              ? `${(view[cardPending.side === 'white' ? 'whiteCards' : 'blackCards']?.warning ?? 0) + 1}/${WARNING_LIMIT}`
              : `${(view[cardPending.side === 'white' ? 'whiteCards' : 'blackCards']?.illegalMove ?? 0) + 1}/${ILLEGAL_MOVE_LIMIT}`}
          </p>
          <p className="form-hint stage-banner-warn">
            {cardPending.cardType === 'illegal_move'
              ? `2nd illegal move = instant loss for this player.`
              : `3rd warning = instant loss for this player.`}
          </p>
          <label>
            Note (optional)
            <input
              className="input"
              value={cardNote}
              onChange={(e) => setCardNote(e.target.value)}
              maxLength={200}
              placeholder="e.g. touched piece / phones"
            />
          </label>
          <div className="table-score-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                setCardPending(null);
                setCardNote('');
              }}
            >
              Back
            </button>
            <button
              type="button"
              className={`btn ${cardPending.cardType === 'warning' ? 'floor-btn-yellow' : 'floor-btn-red'}`}
              disabled={busy || !online || arbiterName.trim().length < 1}
              onClick={() => void issueCard()}
            >
              {busy ? 'Saving…' : 'Confirm card'}
            </button>
          </div>
        </div>
      )}

      {view && view.sessionOk && view.status === 'pending' && !confirming && !cardPending && (
        <div className="table-score-card">
          <p className="table-score-round">Round {view.round}</p>
          {arbiterName.trim() && (
            <p className="form-hint">Scoring as <strong>{arbiterName.trim()}</strong></p>
          )}
          <Matchup
            whiteName={view.whiteName}
            blackName={view.blackName}
            whiteCards={view.whiteCards}
            blackCards={view.blackCards}
            canIssue
            busy={busy}
            online={online}
            onIssue={(side, cardType) => {
              setCardPending({ side, cardType });
              setCardNote('');
            }}
          />
          <h2>Select result</h2>
          {boardHasCards(view) ? (
            <p className="form-hint">
              Cards were issued, so this game started — score a played result, not an absence.
            </p>
          ) : null}
          <div className="table-score-options">
            {(boardHasCards(view)
              ? RESULT_OPTIONS.filter((opt) => !isAbsenceResult(opt.value))
              : RESULT_OPTIONS
            ).map((opt) => (
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
            disabled={!selected || (boardHasCards(view) && isAbsenceResult(selected))}
            onClick={() => setConfirming(true)}
          >
            Continue
          </button>
        </div>
      )}

      {view && view.sessionOk && view.status === 'pending' && confirming && selected && !cardPending && (
        <div className="table-score-card">
          <h2>Confirm result</h2>
          <p className="table-score-round">
            Round {view.round} · Table {view.tableNumber}
            {arbiterName.trim() ? ` · ${arbiterName.trim()}` : ''}
          </p>
          <Matchup
            whiteName={view.whiteName}
            blackName={view.blackName}
            whiteCards={view.whiteCards}
            blackCards={view.blackCards}
          />
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
              disabled={busy || !online}
              onClick={() => void confirmResult()}
            >
              {busy ? 'Saving…' : online ? 'Confirm result' : 'Waiting for connection…'}
            </button>
          </div>
        </div>
      )}

      {showScan && (
        <div className="table-score-next">
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => setScanning(true)}
          >
            Scan next table
          </button>
          <p className="form-hint">Opens the camera — or scan with your phone camera app.</p>
        </div>
      )}

      {scanning && (
        <TableQrScanner
          onSlug={(next) => {
            setScanning(false);
            navigate(`/t/${next}`);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
