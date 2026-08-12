import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiAdminOverview, type AdminOverview } from '../api/client';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return '—';
  }
}

function recordSummary(rec: Record<string, number>): string {
  const entries = Object.entries(rec);
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k}: ${v}`).join(' · ');
}

export default function AdminPage() {
  const auth = useAuth();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiAdminOverview();
    if (!res.ok) {
      setData(null);
      setError(res.error);
      setLoading(false);
      return;
    }
    setData(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!auth.isPlatformAdmin && !loading && error) {
    return (
      <div className="page-container admin-page">
        <div className="page-header">
          <div>
            <p className="page-breadcrumb">
              <Link to="/app">Tournaments</Link>
              <span aria-hidden> / </span>
              <span>Admin</span>
            </p>
            <h1>Platform admin</h1>
          </div>
        </div>
        <p className="form-hint stage-banner-warn" role="status">
          Not allowed. This page is only for platform admins.
        </p>
      </div>
    );
  }

  const totals = data?.totals;

  return (
    <div className="page-container admin-page">
      <div className="page-header">
        <div>
          <p className="page-breadcrumb">
            <Link to="/app">Tournaments</Link>
            <span aria-hidden> / </span>
            <span>Admin</span>
          </p>
          <h1>Platform admin</h1>
          <p className="page-subtitle">Accounts and usage across Chess Alokas</p>
        </div>
        <button type="button" className="btn btn-outline" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <p className="form-hint stage-banner-warn" role="alert">
          {error}
        </p>
      )}

      {totals && (
        <section className="admin-metrics" aria-label="Totals">
          <div className="admin-metric">
            <span className="admin-metric-label">Users</span>
            <strong>{totals.users}</strong>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-label">Tournaments</span>
            <strong>{totals.tournaments}</strong>
            <span className="admin-metric-detail">{recordSummary(totals.tournamentsByStatus)}</span>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-label">Public live</span>
            <strong>{totals.publicLiveEnabled}</strong>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-label">Participants</span>
            <strong>{totals.participants}</strong>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-label">Games</span>
            <strong>{totals.games}</strong>
            <span className="admin-metric-detail">
              pending {totals.gamesPending} · finished {totals.gamesFinished}
            </span>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-label">Floor QR</span>
            <strong>{totals.floorTournaments}</strong>
            <span className="admin-metric-detail">tournaments with tables</span>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-label">Certificates</span>
            <strong>
              {Object.values(totals.certificateIssuesByStatus).reduce((a, b) => a + b, 0)}
            </strong>
            <span className="admin-metric-detail">
              {recordSummary(totals.certificateIssuesByStatus)}
            </span>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-label">Cards</span>
            <strong>{Object.values(totals.gameCardsByType).reduce((a, b) => a + b, 0)}</strong>
            <span className="admin-metric-detail">{recordSummary(totals.gameCardsByType)}</span>
          </div>
          <div className="admin-metric">
            <span className="admin-metric-label">Results (7d)</span>
            <strong>
              {Object.values(totals.resultEventsLast7dByRole).reduce((a, b) => a + b, 0)}
            </strong>
            <span className="admin-metric-detail">
              {recordSummary(totals.resultEventsLast7dByRole)}
            </span>
          </div>
        </section>
      )}

      <section className="account-panel">
        <h3>Accounts</h3>
        {!data && loading ? (
          <p className="form-hint">Loading…</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Joined</th>
                  <th>Last sign-in</th>
                  <th>Tournaments</th>
                  <th>Players</th>
                  <th>Admin</th>
                </tr>
              </thead>
              <tbody>
                {(data?.accounts ?? []).map((a) => (
                  <tr key={a.id}>
                    <td>{a.email ?? '—'}</td>
                    <td>{a.displayName ?? '—'}</td>
                    <td>{fmtDate(a.createdAt)}</td>
                    <td>{fmtDate(a.lastSignInAt)}</td>
                    <td>{a.tournamentCount}</td>
                    <td>{a.participantCount}</td>
                    <td>{a.isPlatformAdmin ? 'Yes' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="account-panel">
        <h3>Recent tournaments</h3>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Players</th>
                <th>Round</th>
                <th>Live</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recentTournaments ?? []).map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.status}</td>
                  <td>{t.ownerEmail ?? '—'}</td>
                  <td>{t.participantCount}</td>
                  <td>{t.currentRound}</td>
                  <td>{t.publicEnabled ? 'On' : '—'}</td>
                  <td>{fmtDate(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
