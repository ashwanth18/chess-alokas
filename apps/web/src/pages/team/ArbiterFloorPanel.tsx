import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FloorAlert, Tournament } from '@chess-alokas/shared';
import {
  apiFloorListAlerts,
  apiFloorListTables,
  apiFloorResolveAlert,
  apiFloorRotatePin,
  apiGetTournaments,
  type FloorTableRow,
} from '../../api/client';

function FloorCard({ tournament }: { tournament: Tournament }) {
  const [tables, setTables] = useState<FloorTableRow[]>([]);
  const [alerts, setAlerts] = useState<FloorAlert[]>([]);
  const [pin, setPin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [tableRes, alertRes] = await Promise.all([
      apiFloorListTables(tournament.id),
      apiFloorListAlerts(tournament.id),
    ]);
    if (tableRes.ok) setTables(tableRes.data.tables);
    if (alertRes.ok) setAlerts(alertRes.data.alerts);
    const failed = !tableRes.ok ? tableRes.error : !alertRes.ok ? alertRes.error : null;
    setError(failed);
  }, [tournament.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function newPin() {
    const warning =
      'Get a new scoring PIN? The current PIN stops working, so anyone using it will need this one.';
    if (!window.confirm(warning)) return;
    setBusy(true);
    const res = await apiFloorRotatePin(tournament.id, Math.max(1, tournament.currentRound ?? 1));
    setBusy(false);
    if (res.ok) {
      setPin(res.data.arbiterPin);
      setError(null);
    } else {
      setError(res.error);
    }
  }

  async function resolve(alertId: string) {
    setBusy(true);
    const res = await apiFloorResolveAlert(tournament.id, alertId);
    setBusy(false);
    if (res.ok) await load();
    else setError(res.error);
  }

  return (
    <article className="tm-floor">
      <h3>{tournament.name}</h3>
      {error && (
        <p className="tm-note tm-note-error" role="alert">
          {error}
        </p>
      )}
      {tables.length === 0 ? (
        <p className="tm-muted">The director hasn't set up tables for this event yet.</p>
      ) : (
        <div className="tm-tables">
          {tables.map((t) => (
            <Link key={t.id} className="tm-btn" to={`/t/${t.slug}`}>
              Table {t.tableNumber}
            </Link>
          ))}
        </div>
      )}
      {alerts.map((alert) => (
        <div key={alert.id} className="tm-note tm-note-wait" role="status">
          Table {alert.tableNumber}, round {alert.round}: {alert.reason}{' '}
          <button
            type="button"
            className="tm-btn"
            disabled={busy}
            onClick={() => void resolve(alert.id)}
          >
            Resolved
          </button>
        </div>
      ))}
      {pin && (
        <p className="tm-note tm-note-ok" role="status">
          Scoring PIN: <span className="tm-pin">{pin}</span>
        </p>
      )}
      <button type="button" className="tm-btn" disabled={busy} onClick={() => void newPin()}>
        Get a new scoring PIN
      </button>
    </article>
  );
}

/**
 * Arbiters don't sync tournaments to this device, because that data includes player records.
 * This is their whole working surface, loaded live from the API.
 */
export default function ArbiterFloorPanel({ organizationId }: { organizationId: string }) {
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiGetTournaments();
    if (res.ok) {
      setTournaments(
        res.data.filter((t) => t.organizationId === organizationId && t.status !== 'completed'),
      );
    } else {
      setError(res.error);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="tm-section" aria-labelledby="tm-floor-heading">
      <h2 id="tm-floor-heading">Floor duty</h2>
      {error && (
        <p className="tm-note tm-note-error" role="alert">
          {error}{' '}
          <button type="button" className="tm-btn" onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}
      {tournaments?.length === 0 && <p className="tm-muted">No tournaments are running right now.</p>}
      {tournaments?.map((t) => <FloorCard key={t.id} tournament={t} />)}
    </section>
  );
}
