import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiAdminOverview, type AdminOverview } from '../api/client';

/** Format UTC ISO for display in the viewer's local timezone, with TZ abbreviation. */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return '—';
  }
}

function viewerTimeZoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  } catch {
    return 'local';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'ready':
      return 'Ready';
    case 'in_progress':
      return 'In progress';
    case 'completed':
      return 'Completed';
    default:
      return status;
  }
}

function fmtShortDay(iso: string): string {
  try {
    return new Date(iso + (iso.includes('T') ? '' : 'T00:00:00')).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso.slice(5);
  }
}

function sumRecord(rec: Record<string, number>): number {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}

function SegmentBar({
  parts,
}: {
  parts: Array<{ key: string; value: number; className: string }>;
}) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="admin-seg-bar" role="img" aria-label="Breakdown">
      {parts.map((p) =>
        p.value > 0 ? (
          <span
            key={p.key}
            className={`admin-seg ${p.className}`}
            style={{ flexGrow: p.value, flexBasis: 0 }}
            title={`${p.key}: ${p.value}`}
          />
        ) : null,
      )}
      {total === 1 && parts.every((p) => p.value === 0) ? (
        <span className="admin-seg admin-seg-empty" style={{ flex: 1 }} />
      ) : null}
    </div>
  );
}

function VBars({
  items,
  valueKey,
  label,
}: {
  items: AdminOverview['growthByWeek'] | AdminOverview['pageViews']['byDayLast14d'];
  valueKey: string;
  label: (item: { weekStart?: string; day?: string }) => string;
}) {
  const values = items.map((item) => Number((item as Record<string, unknown>)[valueKey] ?? 0));
  const max = Math.max(1, ...values);
  return (
    <div className="admin-vbars" aria-label={valueKey}>
      {items.map((item, i) => {
        const v = values[i] ?? 0;
        const h = Math.max(v > 0 ? 8 : 2, Math.round((v / max) * 72));
        return (
          <div key={i} className="admin-vbar-col" title={`${label(item)}: ${v}`}>
            <div className="admin-vbar" style={{ height: h }} />
            <span className="admin-vbar-label">{label(item)}</span>
          </div>
        );
      })}
    </div>
  );
}

function HBars({ entries }: { entries: Array<[string, number]> }) {
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <ul className="admin-hbars">
      {entries.map(([key, value]) => (
        <li key={key}>
          <span className="admin-hbar-label">{key}</span>
          <div className="admin-hbar-track">
            <div className="admin-hbar-fill" style={{ width: `${(value / max) * 100}%` }} />
          </div>
          <span className="admin-hbar-value">{value}</span>
        </li>
      ))}
    </ul>
  );
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

  const statusParts = useMemo(() => {
    const s = data?.totals.tournamentsByStatus ?? {};
    return [
      { key: 'draft', value: s.draft ?? 0, className: 'admin-seg-draft' },
      { key: 'ready', value: s.ready ?? 0, className: 'admin-seg-ready' },
      { key: 'in_progress', value: s.in_progress ?? 0, className: 'admin-seg-progress' },
      { key: 'completed', value: s.completed ?? 0, className: 'admin-seg-done' },
    ];
  }, [data]);

  const gameParts = useMemo(() => {
    if (!data) return [];
    return [
      { key: 'pending', value: data.totals.gamesPending, className: 'admin-seg-pending' },
      { key: 'finished', value: data.totals.gamesFinished, className: 'admin-seg-done' },
    ];
  }, [data]);

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
  const pv = data?.pageViews;
  const adoption = data?.adoption;

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
          <p className="page-subtitle">Usage insights and traffic across Chess Alokas</p>
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

      {totals && pv && adoption && (
        <>
          <section className="admin-hero" aria-label="Key metrics">
            <div className="admin-hero-card">
              <span className="admin-metric-label">Users</span>
              <strong>{totals.users}</strong>
            </div>
            <div className="admin-hero-card">
              <span className="admin-metric-label">Tournaments</span>
              <strong>{totals.tournaments}</strong>
            </div>
            <div className="admin-hero-card">
              <span className="admin-metric-label">Participants</span>
              <strong>{totals.participants}</strong>
            </div>
            <div className="admin-hero-card admin-hero-accent">
              <span className="admin-metric-label">Page views (7d)</span>
              <strong>{pv.last7d}</strong>
              <span className="admin-metric-detail">{pv.last30d} in 30 days</span>
            </div>
          </section>

          <div className="admin-grid-2">
            <section className="admin-panel">
              <h3>Tournament status</h3>
              <SegmentBar parts={statusParts} />
              <ul className="admin-legend">
                {statusParts.map((p) => (
                  <li key={p.key}>
                    <span className={`admin-dot ${p.className}`} />
                    {p.key.replace('_', ' ')} · {p.value}
                  </li>
                ))}
              </ul>
            </section>

            <section className="admin-panel">
              <h3>Games</h3>
              <SegmentBar parts={gameParts} />
              <p className="admin-metric-detail">
                {totals.gamesPending} pending · {totals.gamesFinished} finished · {totals.games} total
              </p>
              <h3 className="admin-subhead">Adoption</h3>
              <ul className="admin-adoption">
                <li>
                  <span>Public live</span>
                  <div className="admin-hbar-track">
                    <div className="admin-hbar-fill" style={{ width: `${adoption.publicLivePct}%` }} />
                  </div>
                  <strong>{adoption.publicLivePct}%</strong>
                </li>
                <li>
                  <span>Floor QR</span>
                  <div className="admin-hbar-track">
                    <div className="admin-hbar-fill" style={{ width: `${adoption.floorTablesPct}%` }} />
                  </div>
                  <strong>{adoption.floorTablesPct}%</strong>
                </li>
                <li>
                  <span>Certificates</span>
                  <div className="admin-hbar-track">
                    <div
                      className="admin-hbar-fill"
                      style={{ width: `${adoption.certificatesPct}%` }}
                    />
                  </div>
                  <strong>{adoption.certificatesPct}%</strong>
                </li>
              </ul>
            </section>
          </div>

          <section className="admin-panel">
            <h3>Growth (8 weeks)</h3>
            <p className="admin-metric-detail">
              Signups, result events, page views, and certificates issued per week
            </p>
            <div className="admin-growth-grid">
              <div>
                <h4>Signups</h4>
                <VBars
                  items={data.growthByWeek}
                  valueKey="users"
                  label={(i) => fmtShortDay(i.weekStart!)}
                />
              </div>
              <div>
                <h4>Result events</h4>
                <VBars
                  items={data.growthByWeek}
                  valueKey="resultEvents"
                  label={(i) => fmtShortDay(i.weekStart!)}
                />
              </div>
              <div>
                <h4>Page views</h4>
                <VBars
                  items={data.growthByWeek}
                  valueKey="pageViews"
                  label={(i) => fmtShortDay(i.weekStart!)}
                />
              </div>
              <div>
                <h4>Certificates</h4>
                <VBars
                  items={data.growthByWeek}
                  valueKey="certificates"
                  label={(i) => fmtShortDay(i.weekStart!)}
                />
              </div>
            </div>
          </section>

          <div className="admin-grid-2">
            <section className="admin-panel">
              <h3>Traffic (14 days)</h3>
              <VBars
                items={pv.byDayLast14d}
                valueKey="count"
                label={(i) => fmtShortDay(i.day!)}
              />
            </section>
            <section className="admin-panel">
              <h3>Views by route (7d)</h3>
              {Object.keys(pv.byRouteKeyLast7d).length === 0 ? (
                <p className="admin-metric-detail">No page views recorded yet.</p>
              ) : (
                <HBars
                  entries={Object.entries(pv.byRouteKeyLast7d).sort((a, b) => b[1] - a[1])}
                />
              )}
              {pv.topLiveHashesLast7d.length > 0 && (
                <>
                  <h3 className="admin-subhead">Top live links (hashed)</h3>
                  <HBars
                    entries={pv.topLiveHashesLast7d.map((t) => [t.hashPrefix, t.count])}
                  />
                </>
              )}
            </section>
          </div>

          <div className="admin-grid-2">
            <section className="admin-panel">
              <h3>Results logged (7d)</h3>
              {sumRecord(totals.resultEventsLast7dByRole) === 0 ? (
                <p className="admin-metric-detail">No result events in the last 7 days.</p>
              ) : (
                <HBars
                  entries={Object.entries(totals.resultEventsLast7dByRole).sort(
                    (a, b) => b[1] - a[1],
                  )}
                />
              )}
            </section>
            <section className="admin-panel">
              <h3>Discipline cards</h3>
              {sumRecord(totals.gameCardsByType) === 0 ? (
                <p className="admin-metric-detail">No cards issued.</p>
              ) : (
                <HBars
                  entries={Object.entries(totals.gameCardsByType).sort((a, b) => b[1] - a[1])}
                />
              )}
            </section>
          </div>
        </>
      )}

      <section className="admin-panel">
        <h3>Accounts</h3>
        <p className="admin-metric-detail">
          Times shown in your timezone ({viewerTimeZoneLabel()}); stored as UTC.
        </p>
        {!data && loading ? (
          <p className="admin-metric-detail">Loading…</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table admin-table">
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

      <section className="admin-panel">
        <h3>Recent tournaments</h3>
        <p className="admin-metric-detail">
          Status is the tournament lifecycle (draft → ready → in progress → completed). There is no
          cancelled state. <strong>Public live</strong> is whether the parent viewer link is
          enabled. Times are stored in UTC and shown in your timezone ({viewerTimeZoneLabel()}),
          not the tournament owner’s.
        </p>
        <div className="table-scroll">
          <table className="data-table admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Players</th>
                <th>Round</th>
                <th>Public live</th>
                <th>Created</th>
                <th>Completed</th>
                <th>Last update</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recentTournaments ?? []).map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{statusLabel(t.status)}</td>
                  <td>{t.ownerEmail ?? '—'}</td>
                  <td>{t.participantCount}</td>
                  <td>{t.currentRound}</td>
                  <td>{t.publicEnabled ? 'On' : 'Off'}</td>
                  <td>{fmtDate(t.createdAt)}</td>
                  <td>{t.status === 'completed' ? fmtDate(t.completedAt ?? t.updatedAt) : '—'}</td>
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
