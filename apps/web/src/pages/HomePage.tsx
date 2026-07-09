import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/local';
import { getLastSyncAt } from '../db/local';
import { useEffect, useState } from 'react';

function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge status-${status}`}>{status.replace('_', ' ')}</span>;
}

export default function HomePage() {
  const [lastSync, setLastSync] = useState<string | null>(null);

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

  const isEmpty = tournaments?.length === 0;

  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-board-bg" aria-hidden="true" />
        <div className="hero-content">
          <h1 className="hero-title">
            <span className="hero-knight">♞</span>
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

        {tournaments === undefined && (
          <div className="loading-row">Loading…</div>
        )}

        {tournaments !== undefined && isEmpty && (
          <div className="empty-state">
            <span className="empty-icon">♟</span>
            <p>No tournaments yet.</p>
            <Link to="/tournaments/new" className="btn btn-primary">
              Create your first tournament
            </Link>
          </div>
        )}

        {tournaments !== undefined && !isEmpty && (
          <ul className="tournament-list">
            {tournaments.map((t) => (
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
                    <StatusBadge status={t.status} />
                    {t.currentRound > 0 && (
                      <span className="round-indicator">Round {t.currentRound}</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
