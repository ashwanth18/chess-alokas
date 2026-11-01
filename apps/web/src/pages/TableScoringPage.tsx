import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  ArbiterScorableResult,
  FloorZoneBoard,
  GameCardType,
} from '@chess-alokas/shared';
import {
  ILLEGAL_MOVE_LIMIT,
  WARNING_LIMIT,
  emptyCardCounts,
  isAbsenceResult,
} from '@chess-alokas/shared';
import {
  apiPublicTableCallChief,
  apiPublicTableCard,
  apiPublicTableGet,
  apiPublicTableSetResult,
  apiPublicTableSession,
  apiPublicTableZone,
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
import {
  conflictMessage,
  flushBanner,
  summarizeFlush,
  type FlushAttempt,
  type QueuedFloorResult,
  type RejectedFloorResult,
} from '../lib/floorQueue';

function isNetworkError(raw: string): boolean {
  return /abort|timeout|timed out|failed to fetch|network|load failed|offline/i.test(raw);
}

function networkErrorMessage(raw: string): string {
  if (isNetworkError(raw)) {
    return 'No connection — reconnect and try again.';
  }
  return raw;
}

const SESSION_KEY = (slug: string) => `chess-alokas-arbiter-session:${slug}`;
const LAST_SESSION_KEY = 'chess-alokas-arbiter-last-token';
const OFFLINE_QUEUE_KEY = 'alokas-floor-offline-queue';
const CONFLICTS_KEY = 'alokas-floor-offline-conflicts';
const VIEW_KEY = (slug: string) => `alokas-floor-view:${slug}`;
const ZONE_KEY = (slug: string) => `alokas-floor-zone:${slug}`;

export type OfflineFloorResultItem = QueuedFloorResult & { result: ArbiterScorableResult };

/** Last boards seen, per tab, so a reload with no signal can still show them and queue results. */
function rememberForTab(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function recallFromTab<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function loadConflicts(): RejectedFloorResult[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFLICTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as RejectedFloorResult[]) : [];
  } catch {
    return [];
  }
}

function saveConflicts(items: RejectedFloorResult[]) {
  try {
    if (items.length === 0) localStorage.removeItem(CONFLICTS_KEY);
    else localStorage.setItem(CONFLICTS_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

function loadOfflineQueue(): OfflineFloorResultItem[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineFloorResultItem[]) : [];
  } catch {
    return [];
  }
}

function saveOfflineQueue(items: OfflineFloorResultItem[]): void {
  try {
    if (items.length === 0) {
      localStorage.removeItem(OFFLINE_QUEUE_KEY);
    } else {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
    }
  } catch {
    /* ignore */
  }
}

function enqueueOfflineResult(item: OfflineFloorResultItem): OfflineFloorResultItem[] {
  const existing = loadOfflineQueue().filter((q) => q.slug !== item.slug);
  const next = [...existing, item];
  saveOfflineQueue(next);
  return next;
}

const RESULT_OPTIONS: { value: ArbiterScorableResult; label: string; hint: string }[] = [
  { value: '1-0', label: 'White wins', hint: '1–0' },
  { value: '0-1', label: 'Black wins', hint: '0–1' },
  { value: '1/2-1/2', label: 'Draw', hint: '½–½' },
  { value: '1-0F', label: 'Black absent', hint: 'White wins' },
  { value: '0-1F', label: 'White absent', hint: 'Black wins' },
  { value: '0-0', label: 'Both absent', hint: '0–0' },
];

const CHIEF_ARBITER_PRESETS = [
  'Illegal move dispute',
  'Clock malfunction',
  'Player missing',
] as const;

type ZoneRangeFilter = 'all' | '1-15' | '16-30' | '31+' | 'pending';

function loadSession(slug: string): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY(slug)) || sessionStorage.getItem(LAST_SESSION_KEY);
  } catch {
    return null;
  }
}

function saveSession(slug: string, token: string) {
  try {
    sessionStorage.setItem(SESSION_KEY(slug), token);
    sessionStorage.setItem(LAST_SESSION_KEY, token);
  } catch {
    /* ignore */
  }
}

function clearSession(slug: string) {
  try {
    sessionStorage.removeItem(SESSION_KEY(slug));
    sessionStorage.removeItem(LAST_SESSION_KEY);
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

  // Phase 3: View Mode Toggle (Single Table vs Zone Grid)
  const [viewMode, setViewMode] = useState<'single' | 'zone'>('single');
  const [zoneRange, setZoneRange] = useState<ZoneRangeFilter>('all');
  const [zoneBoards, setZoneBoards] = useState<FloorZoneBoard[]>([]);
  const [zoneLoading, setZoneLoading] = useState(false);
  const [zoneSelectedByTable, setZoneSelectedByTable] = useState<
    Record<number, ArbiterScorableResult | undefined>
  >({});
  const [zoneBusyTable, setZoneBusyTable] = useState<number | null>(null);

  // Phase 3: Call Chief Arbiter state
  const [chiefSheetOpen, setChiefSheetOpen] = useState(false);
  const [chiefTargetTable, setChiefTargetTable] = useState<{
    slug: string;
    tableNumber: number;
  } | null>(null);
  const [chiefReason, setChiefReason] = useState<string>(CHIEF_ARBITER_PRESETS[0]);
  const [chiefCustomNote, setChiefCustomNote] = useState('');
  const [chiefBusy, setChiefBusy] = useState(false);
  const [chiefBanner, setChiefBanner] = useState<string | null>(null);

  // Phase 3: Offline Result Queue state
  const [offlineQueue, setOfflineQueue] = useState<OfflineFloorResultItem[]>(() =>
    loadOfflineQueue(),
  );
  const [offlineBanner, setOfflineBanner] = useState<string | null>(null);
  const [flushingQueue, setFlushingQueue] = useState(false);
  const [conflicts, setConflicts] = useState<RejectedFloorResult[]>(() => loadConflicts());

  useEffect(() => {
    setToken(slug ? loadSession(slug) : null);
    setSelected(null);
    setConfirming(false);
    setCardPending(null);
    setCardNote('');
    setError(null);
  }, [slug]);

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

  const refreshZone = useCallback(
    async (session = token) => {
      if (!slug || !session) return;
      setZoneLoading(true);
      const res = await apiPublicTableZone(slug, session);
      setZoneLoading(false);
      if (res.ok) {
        setZoneBoards(res.data.boards);
        rememberForTab(ZONE_KEY(slug), res.data.boards);
      } else if (isNetworkError(res.error)) {
        setZoneBoards((current) =>
          current.length > 0 ? current : (recallFromTab<FloorZoneBoard[]>(ZONE_KEY(slug)) ?? []),
        );
      }
    },
    [slug, token],
  );

  const refresh = useCallback(
    async (session = token) => {
      if (!slug) return;
      setLoading(true);
      setError(null);
      const res = await apiPublicTableGet(slug, session);
      setLoading(false);
      if (!res.ok) {
        if (isNetworkError(res.error)) {
          setOnline(false);
          const lastSeen = recallFromTab<FloorTableView>(VIEW_KEY(slug));
          if (lastSeen && session) {
            setView(lastSeen);
            return;
          }
        }
        setError(networkErrorMessage(res.error));
        setView(null);
        return;
      }
      setOnline(true);
      setView(res.data);
      if (res.data.sessionOk) rememberForTab(VIEW_KEY(slug), res.data);
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
      } else if (res.data.sessionOk && session) {
        saveSession(slug, session);
      }
    },
    [slug, token],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Also before Zone Grid is opened, so its boards are there if the Wi-Fi drops first.
    if (token && view?.sessionOk) {
      void refreshZone(token);
    }
  }, [viewMode, token, view?.sessionOk, refreshZone]);

  // Flush offline result queue automatically when online becomes true
  const flushOfflineResultQueue = useCallback(async () => {
    const queued = loadOfflineQueue();
    if (queued.length === 0 || flushingQueue) return;
    setFlushingQueue(true);
    const attempts: { item: QueuedFloorResult; attempt: FlushAttempt }[] = [];

    for (const item of queued) {
      const res = await apiPublicTableSetResult(
        item.slug,
        item.token,
        item.result,
        item.arbiterName || arbiterName.trim() || 'Floor Arbiter',
      );
      attempts.push({ item, attempt: res.ok ? { ok: true } : { ok: false, error: res.error } });
    }

    const summary = summarizeFlush(attempts);
    const remaining = summary.remaining as OfflineFloorResultItem[];
    saveOfflineQueue(remaining);
    setOfflineQueue(remaining);

    if (summary.rejected.length > 0) {
      // Show what the server actually holds, so the arbiter can tell the chief what differs.
      const newConflicts: RejectedFloorResult[] = [];
      for (const { item, reason } of summary.rejected) {
        const current = await apiPublicTableGet(item.slug, item.token);
        newConflicts.push({
          slug: item.slug,
          tableNumber: item.tableNumber,
          result: item.result,
          reason,
          serverResult: current.ok ? current.data.result : null,
          rejectedAt: new Date().toISOString(),
        });
      }
      setConflicts((prev) => {
        const next = [...prev, ...newConflicts];
        saveConflicts(next);
        return next;
      });
    }
    setFlushingQueue(false);

    setOfflineBanner(flushBanner(summary));
    if (summary.submitted > 0 || summary.rejected.length > 0) {
      void refresh();
      if (viewMode === 'zone') void refreshZone();
    }
  }, [arbiterName, flushingQueue, refresh, refreshZone, viewMode]);

  useEffect(() => {
    if (online && offlineQueue.length > 0) {
      void flushOfflineResultQueue();
    }
  }, [online, offlineQueue.length, flushOfflineResultQueue]);

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
    const res = await apiPublicTableSession(slug, pin.trim(), name);
    setBusy(false);
    if (!res.ok) {
      setError(networkErrorMessage(res.error));
      if (isNetworkError(res.error)) {
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

  function queueResultOffline(
    targetSlug: string,
    targetResult: ArbiterScorableResult,
    targetTableNumber?: number,
  ) {
    if (!token) return;
    const next = enqueueOfflineResult({
      slug: targetSlug,
      token,
      result: targetResult,
      arbiterName: arbiterName.trim() || 'Floor Arbiter',
      tableNumber: targetTableNumber,
      queuedAt: new Date().toISOString(),
    });
    setOfflineQueue(next);
    setOfflineBanner('Saved offline — will auto-submit when Wi-Fi reconnects');
    setError(null);
  }

  async function confirmResult() {
    if (!slug || !token || !selected || busy) return;
    const name = arbiterName.trim() || 'Floor Arbiter';

    if (!online) {
      queueResultOffline(slug, selected, view?.tableNumber);
      setConfirming(false);
      setSelected(null);
      return;
    }

    setBusy(true);
    setError(null);
    const res = await apiPublicTableSetResult(slug, token, selected, name);
    setBusy(false);
    if (!res.ok) {
      if (isNetworkError(res.error)) {
        setOnline(false);
        queueResultOffline(slug, selected, view?.tableNumber);
        setConfirming(false);
        setSelected(null);
        return;
      }
      setError(networkErrorMessage(res.error));
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

  async function submitZoneBoardResult(board: FloorZoneBoard) {
    const picked = zoneSelectedByTable[board.tableNumber];
    if (!token || !picked || zoneBusyTable !== null) return;
    const name = arbiterName.trim() || 'Floor Arbiter';

    if (!online) {
      queueResultOffline(board.slug, picked, board.tableNumber);
      setZoneBoards((prev) =>
        prev.map((b) =>
          b.tableNumber === board.tableNumber
            ? { ...b, result: picked, locked: true }
            : b,
        ),
      );
      return;
    }

    setZoneBusyTable(board.tableNumber);
    setError(null);
    const res = await apiPublicTableSetResult(board.slug, token, picked, name);
    setZoneBusyTable(null);

    if (!res.ok) {
      if (isNetworkError(res.error)) {
        setOnline(false);
        queueResultOffline(board.slug, picked, board.tableNumber);
        setZoneBoards((prev) =>
          prev.map((b) =>
            b.tableNumber === board.tableNumber
              ? { ...b, result: picked, locked: true }
              : b,
          ),
        );
        return;
      }
      setError(`Table ${board.tableNumber}: ${networkErrorMessage(res.error)}`);
      return;
    }

    setOnline(true);
    setZoneBoards((prev) =>
      prev.map((b) =>
        b.tableNumber === board.tableNumber
          ? { ...b, result: picked, locked: true }
          : b,
      ),
    );
    if (board.tableNumber === view?.tableNumber && res.data.table) {
      setView(res.data.table);
    }
  }

  async function submitCallChief(e: React.FormEvent) {
    e.preventDefault();
    if (!token || chiefBusy) return;
    const targetSlug = chiefTargetTable?.slug || slug;
    const targetNum = chiefTargetTable?.tableNumber ?? view?.tableNumber ?? 1;
    const finalReason =
      chiefReason === '__custom__' ? chiefCustomNote.trim() : chiefReason.trim();
    if (!finalReason) {
      setError('Select or enter a reason for the Chief Arbiter alert.');
      return;
    }
    setChiefBusy(true);
    setError(null);
    const res = await apiPublicTableCallChief(
      targetSlug,
      token,
      finalReason,
      arbiterName.trim() || undefined,
    );
    setChiefBusy(false);
    if (!res.ok) {
      setError(networkErrorMessage(res.error));
      return;
    }
    setChiefSheetOpen(false);
    setChiefCustomNote('');
    setChiefBanner(`Chief Arbiter alerted for Table ${targetNum}`);
  }

  const filteredZoneBoards = useMemo(() => {
    return zoneBoards.filter((b) => {
      if (zoneRange === '1-15') return b.tableNumber >= 1 && b.tableNumber <= 15;
      if (zoneRange === '16-30') return b.tableNumber >= 16 && b.tableNumber <= 30;
      if (zoneRange === '31+') return b.tableNumber >= 31;
      if (zoneRange === 'pending') return !b.locked && !b.isBye && b.result === 'pending';
      return true;
    });
  }, [zoneBoards, zoneRange]);

  if (!slug) {
    return (
      <div className="table-score-page">
        <p className="form-error">Invalid table link.</p>
      </div>
    );
  }

  const isUnlocked = Boolean(view && view.sessionOk && view.status !== 'needs_pin');

  const showScan =
    view &&
    viewMode === 'single' &&
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
        <h1>
          {viewMode === 'zone'
            ? `Floor Zone · Round ${view?.round ?? view?.pinRound ?? '—'}`
            : `Table ${view?.tableNumber ?? '…'}`}
        </h1>
        {view && <p className="table-score-tour">{view.tournamentName}</p>}
      </header>

      {!online && (
        <div className="table-score-offline" role="status">
          <strong>No internet</strong>
          <span>
            You can still confirm results — they will be saved in the offline queue and
            auto-submitted when Wi-Fi reconnects.
          </span>
        </div>
      )}

      {(offlineBanner || offlineQueue.length > 0) && (
        <div
          className="table-score-card"
          role="status"
          style={{
            borderColor: '#f59e0b',
            background: 'rgba(245, 158, 11, 0.12)',
            marginBottom: '0.85rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div>
              <strong>
                {offlineBanner || 'Saved offline — will auto-submit when Wi-Fi reconnects'}
              </strong>
              {offlineQueue.length > 0 && (
                <p className="form-hint" style={{ margin: '0.2rem 0 0' }}>
                  {offlineQueue.length} result{offlineQueue.length === 1 ? '' : 's'} queued (
                  {offlineQueue
                    .map((q) => (q.tableNumber ? `Table ${q.tableNumber}: ${q.result}` : q.result))
                    .join(', ')}
                  )
                </p>
              )}
            </div>
            {offlineQueue.length > 0 && online && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={flushingQueue}
                onClick={() => void flushOfflineResultQueue()}
              >
                {flushingQueue ? 'Syncing…' : 'Sync now'}
              </button>
            )}
          </div>
        </div>
      )}

      {conflicts.map((c) => (
        <div className="table-score-card floor-conflict" role="alert" key={`${c.slug}:${c.rejectedAt}`}>
          <strong>{conflictMessage(c)}</strong>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() =>
              setConflicts((prev) => {
                const next = prev.filter((x) => x !== c);
                saveConflicts(next);
                return next;
              })
            }
          >
            Dismiss
          </button>
        </div>
      ))}

      {chiefBanner && (
        <div
          className="table-score-card"
          role="status"
          style={{
            borderColor: '#10b981',
            background: 'rgba(16, 185, 129, 0.12)',
            marginBottom: '0.85rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <strong>🚨 {chiefBanner}</strong>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setChiefBanner(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {isUnlocked && (
        <div
          className="table-score-card"
          style={{
            padding: '0.75rem',
            marginBottom: '0.85rem',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'single' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setViewMode('single')}
            >
              Single Table ({view?.tableNumber ?? '…'})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'zone' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setViewMode('zone')}
            >
              Zone Grid (All Tables)
            </button>
          </div>
          <button
            type="button"
            className="btn btn-sm floor-btn-red"
            onClick={() => {
              setChiefTargetTable({
                slug,
                tableNumber: view?.tableNumber ?? 1,
              });
              setChiefSheetOpen(true);
            }}
          >
            🚨 Call Chief Arbiter
          </button>
        </div>
      )}

      {chiefSheetOpen && (
        <form
          className="table-score-card"
          onSubmit={(e) => void submitCallChief(e)}
          style={{ borderColor: '#ef4444', marginBottom: '0.85rem' }}
        >
          <h2>🚨 Call Chief Arbiter — Table {chiefTargetTable?.tableNumber ?? view?.tableNumber}</h2>
          <p className="form-hint">
            Sends an immediate high-visibility alert to the Tournament Director desk.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', margin: '0.65rem 0' }}>
            {CHIEF_ARBITER_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`btn btn-sm ${chiefReason === preset ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setChiefReason(preset)}
              >
                {preset}
              </button>
            ))}
            <button
              type="button"
              className={`btn btn-sm ${chiefReason === '__custom__' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setChiefReason('__custom__')}
            >
              Custom note…
            </button>
          </div>
          {chiefReason === '__custom__' && (
            <label>
              Describe issue
              <input
                className="input"
                value={chiefCustomNote}
                onChange={(e) => setChiefCustomNote(e.target.value)}
                maxLength={300}
                placeholder="e.g. Score sheet disagreement on move 28"
                required
              />
            </label>
          )}
          <div className="table-score-actions" style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={chiefBusy}
              onClick={() => setChiefSheetOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn floor-btn-red" disabled={chiefBusy}>
              {chiefBusy ? 'Alerting…' : 'Send Alert to Chief Arbiter'}
            </button>
          </div>
        </form>
      )}

      {loading && !view && <p className="form-hint">Loading table…</p>}
      {error && <div className="form-error">{error}</div>}

      {view?.status === 'needs_pin' && (
        <form className="table-score-card" onSubmit={(e) => void submitPin(e)}>
          <h2>Unlock table</h2>
          <p className="form-hint">
            Your name is saved on this phone. The PIN unlocks all tables in this round.
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

      {isUnlocked && viewMode === 'zone' && (
        <div className="table-score-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <h2 style={{ margin: 0 }}>Zone Grid ({filteredZoneBoards.length} tables)</h2>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              disabled={zoneLoading}
              onClick={() => void refreshZone()}
            >
              {zoneLoading ? 'Refreshing…' : 'Refresh Zone'}
            </button>
          </div>

          <div className="live-round-pills" style={{ marginBottom: '0.85rem' }}>
            {(
              [
                { id: 'all', label: 'All' },
                { id: '1-15', label: '1–15' },
                { id: '16-30', label: '16–30' },
                { id: '31+', label: '31+' },
                { id: 'pending', label: 'Pending Only' },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                className={`live-round-pill ${zoneRange === pill.id ? 'active' : ''}`}
                onClick={() => setZoneRange(pill.id)}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {zoneLoading && zoneBoards.length === 0 ? (
            <p className="form-hint">Loading zone boards…</p>
          ) : filteredZoneBoards.length === 0 ? (
            <p className="form-hint">No tables match this filter.</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {filteredZoneBoards.map((board) => {
                const picked = zoneSelectedByTable[board.tableNumber];
                const isPending = !board.locked && !board.isBye && board.result === 'pending';
                return (
                  <div
                    key={board.tableNumber}
                    className="board-card"
                    style={{
                      padding: '0.85rem',
                      border: '1px solid var(--color-border)',
                      borderRadius: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', marginBottom: '0.45rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <strong>Table {board.tableNumber}</strong>
                        {board.categoryName && (
                          <span className="player-chip-badge">{board.categoryName}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span
                          className={`live-result-pill ${isPending ? 'is-pending' : 'is-done'}`}
                        >
                          {board.isBye
                            ? 'BYE'
                            : board.result === 'pending'
                              ? 'Pending'
                              : board.result}
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            if (token) saveSession(board.slug, token);
                            setViewMode('single');
                            navigate(`/t/${board.slug}`);
                          }}
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          title="Call Chief Arbiter for this table"
                          onClick={() => {
                            setChiefTargetTable({
                              slug: board.slug,
                              tableNumber: board.tableNumber,
                            });
                            setChiefSheetOpen(true);
                          }}
                        >
                          🚨
                        </button>
                      </div>
                    </div>

                    <div style={{ fontSize: '0.95rem', marginBottom: isPending ? '0.6rem' : 0 }}>
                      <div>⚪ <strong>{board.whiteName ?? '—'}</strong></div>
                      {!board.isBye && (
                        <div>⚫ <strong>{board.blackName ?? '—'}</strong></div>
                      )}
                    </div>

                    {isPending && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                        {RESULT_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            className={`btn btn-sm ${picked === opt.value ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() =>
                              setZoneSelectedByTable((prev) => ({
                                ...prev,
                                [board.tableNumber]: opt.value,
                              }))
                            }
                          >
                            {opt.value}
                          </button>
                        ))}
                        {picked && (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            disabled={zoneBusyTable === board.tableNumber}
                            onClick={() => void submitZoneBoardResult(board)}
                          >
                            {zoneBusyTable === board.tableNumber
                              ? 'Saving…'
                              : `Confirm ${picked}`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {view && view.sessionOk && viewMode === 'single' && view.status === 'no_game' && (
        <div className="table-score-card">
          <h2>No game this round</h2>
          <p className="form-hint">
            Round {view.pinRound ?? '—'} has no pairing on this table yet.
          </p>
        </div>
      )}

      {view && view.sessionOk && viewMode === 'single' && view.status === 'confirmed_closed' && (
        <div className="table-score-card">
          <h2>Round closed</h2>
          <p className="form-hint">The director has confirmed this round. Scoring is locked.</p>
        </div>
      )}

      {view && view.sessionOk && viewMode === 'single' && view.status === 'bye' && (
        <div className="table-score-card">
          <h2>Bye</h2>
          <p className="form-hint">
            Round {view.round} — {view.whiteName ?? view.blackName ?? 'Player'} has a bye (1 pt).
          </p>
        </div>
      )}

      {view && view.sessionOk && viewMode === 'single' && view.status === 'locked' && (
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

      {view && view.sessionOk && viewMode === 'single' && view.status === 'pending' && cardPending && (
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

      {view && view.sessionOk && viewMode === 'single' && view.status === 'pending' && !confirming && !cardPending && (
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

      {view && view.sessionOk && viewMode === 'single' && view.status === 'pending' && confirming && selected && !cardPending && (
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
              disabled={busy}
              onClick={() => void confirmResult()}
            >
              {busy ? 'Saving…' : online ? 'Confirm result' : 'Save offline (queue)'}
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
          <p className="form-hint">Opens the camera — or switch to Zone Grid above.</p>
        </div>
      )}

      {scanning && (
        <TableQrScanner
          onSlug={(next) => {
            setScanning(false);
            if (token) saveSession(next, token);
            navigate(`/t/${next}`);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
