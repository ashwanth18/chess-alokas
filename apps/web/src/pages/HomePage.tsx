import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/local';
import { getLastSyncAt } from '../db/local';
import { useEffect, useMemo, useState } from 'react';
import { softDeleteTournament } from '../lib/deleteTournament';
import TableSearch from '../components/TableSearch';
import { matchesTextSearch } from '../lib/textSearch';

const PAGE_SIZE = 10;

function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge status-${status}`}>{status.replace('_', ' ')}</span>;
}

/** Prefer persisted status; never infer completed from round count alone (results may still be pending). */
function deriveListStatus(t: { status: string; currentRound: number; rounds: number }): string {
  if (t.status === 'completed') return 'completed';
  if (t.status === 'in_progress' || t.currentRound > 0) return 'in_progress';
  if (t.status === 'ready') return 'ready';
  return t.status === 'draft' ? 'draft' : t.status;
}

export default function HomePage() {
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    getLastSyncAt().then(setLastSync);
  }, []);

  const tournaments = useLiveQuery(
    () =>
      db.tournaments
        .filter((t) => !t.deletedAt)
        .reverse()
        .sortBy('updatedAt'),
    [],
  );

  const filtered = useMemo(() => {
    if (!tournaments) return [];
    return tournaments.filter((t) =>
      matchesTextSearch(
        search,
        t.name,
        t.style,
        t.style === 'swiss' ? 'FIDE Swiss' : t.style,
        t.status,
        deriveListStatus(t),
        t.date,
        t.rounds,
        t.currentRound > 0 ? `round ${t.currentRound}` : undefined,
      ),
    );
  }, [tournaments, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const isEmpty = tournaments?.length === 0;
  const noMatches = !isEmpty && filtered.length === 0;

  async function handleDelete(e: React.MouseEvent, tournamentId: string, name: string) {
    e.preventDefault();
    e.stopPropagation();
    const ok = window.confirm(
      `Delete "${name}"?\n\nThis removes the tournament locally and from the cloud on the next sync.`,
    );
    if (!ok) return;
    setDeletingId(tournamentId);
    try {
      await softDeleteTournament(tournamentId);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-board-bg" aria-hidden="true" />
        <div className="hero-content">
          <h1 className="hero-title">
            <span className="hero-knight">♕</span>
            Chess Alokas
          </h1>
          <p className="hero-tagline">
            Offline-first tournament management for chess clubs &amp; academies.
          </p>
          <Link to="/tournaments/new" className="btn btn-primary btn-lg">
            New Tournament
          </Link>
        </div>
      </section>

      <section className="tournaments-section">
        <div className="section-header">
          <h2>Your Tournaments</h2>
          {lastSync && (
            <span className="sync-hint">
              Last sync: {new Date(lastSync).toLocaleString()}
            </span>
          )}
        </div>

        {tournaments === undefined && <div className="loading-row">Loading…</div>}

        {tournaments !== undefined && isEmpty && (
          <div className="empty-state">
            <span className="empty-icon">♕</span>
            <h3>No tournaments yet</h3>
            <p>Create one here, or hit Sync if you already have cloud tournaments.</p>
            <div className="empty-actions">
              <Link to="/tournaments/new" className="btn btn-primary">
                Create tournament
              </Link>
              <Link to="/settings" className="btn btn-outline">
                Sync settings
              </Link>
            </div>
          </div>
        )}

        {tournaments !== undefined && !isEmpty && (
          <>
            <div className="tournaments-toolbar">
              <TableSearch
                id="tournament-search"
                value={search}
                onChange={setSearch}
                placeholder="Search tournaments…"
                resultCount={filtered.length}
                totalCount={tournaments.length}
              />
            </div>

            {noMatches ? (
              <div className="empty-state empty-state-compact">
                <h3>No matches</h3>
                <p>Try a different name, status, or date.</p>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setSearch('')}>
                  Clear search
                </button>
              </div>
            ) : (
              <>
                <ul className="tournament-list">
                  {pageItems.map((t) => (
                    <li key={t.id} className="tournament-card">
                      <Link to={`/tournaments/${t.id}`} className="tournament-card-link">
                        <div className="tournament-card-main">
                          <span className="tournament-name">{t.name}</span>
                          <div className="tournament-meta">
                            <span>{t.style === 'swiss' ? 'FIDE Swiss' : t.style}</span>
                            <span>{t.rounds} rounds</span>
                            {t.date && <span>{new Date(t.date).toLocaleDateString()}</span>}
                          </div>
                        </div>
                        <div className="tournament-card-side">
                          <StatusBadge status={deriveListStatus(t)} />
                          {t.currentRound > 0 && (
                            <span className="round-indicator">Round {t.currentRound}</span>
                          )}
                        </div>
                      </Link>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost btn-danger tournament-delete-btn"
                        disabled={deletingId === t.id}
                        aria-label={`Delete ${t.name}`}
                        onClick={(e) => void handleDelete(e, t.id, t.name)}
                      >
                        {deletingId === t.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="list-pagination">
                  <span className="list-pagination-meta">
                    Showing {(safePage - 1) * PAGE_SIZE + 1}–
                    {Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
                  </span>
                  <div className="list-pagination-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      disabled={safePage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </button>
                    <span className="list-pagination-page">
                      Page {safePage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
