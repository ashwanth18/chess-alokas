import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PublicEventSummary } from '@chess-alokas/shared';
import { apiListPublicEvents } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { trackPageView } from '../lib/pageAnalytics';

const RADIUS_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: '10 km', value: 10 },
  { label: '25 km', value: 25 },
  { label: '50 km', value: 50 },
  { label: 'All distances', value: null },
];

function formatFee(cents: number, currency = 'MYR'): string {
  if (!cents || cents <= 0) return 'Free Entry';
  const amount = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  return `${currency} ${amount}`;
}

export default function DiscoverEventsPage() {
  const auth = useAuth();
  const [events, setEvents] = useState<PublicEventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState<number | null>(25);
  const [locating, setLocating] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<string | null>(null);

  useEffect(() => {
    trackPageView({ routeKey: 'discover', path: '/discover' });
  }, []);

  const loadEvents = useCallback(
    async (opts?: {
      lat?: number | null;
      lng?: number | null;
      radiusKm?: number | null;
      search?: string;
    }) => {
      setLoading(true);
      setError(null);
      const effectiveLat = opts?.lat !== undefined ? opts.lat : (coords?.lat ?? null);
      const effectiveLng = opts?.lng !== undefined ? opts.lng : (coords?.lng ?? null);
      const effectiveRadius =
        opts?.radiusKm !== undefined
          ? opts.radiusKm
          : effectiveLat != null
            ? radiusKm
            : null;
      const effectiveSearch = opts?.search !== undefined ? opts.search : search;

      const res = await apiListPublicEvents({
        lat: effectiveLat,
        lng: effectiveLng,
        radiusKm: effectiveRadius,
        search: effectiveSearch,
      });
      setLoading(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEvents(res.data.events);
    },
    [coords, radiusKm, search],
  );

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    void loadEvents({ search });
  }

  function handleNearMeClick() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsStatus('Geolocation is not supported by this browser.');
      return;
    }
    setLocating(true);
    setGpsStatus(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = {
          lat: Number(pos.coords.latitude.toFixed(5)),
          lng: Number(pos.coords.longitude.toFixed(5)),
        };
        setCoords(next);
        setLocating(false);
        setGpsStatus(`Showing events sorted by distance from your GPS location`);
        void loadEvents({ lat: next.lat, lng: next.lng, radiusKm });
      },
      (err) => {
        setLocating(false);
        setGpsStatus(
          err.code === 1
            ? 'Location permission denied. Allow location access or search by city.'
            : 'Could not detect GPS location. Try searching by city or venue name.',
        );
      },
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  function handleClearGps() {
    setCoords(null);
    setGpsStatus(null);
    void loadEvents({ lat: null, lng: null, radiusKm: null });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to={auth.user ? '/player' : '/'} className="brand">
          <span className="brand-knight" aria-hidden>
            ♕
          </span>
          <span className="brand-name">Chess Alokas</span>
        </Link>
        <div className="sync-bar">
          {auth.user ? (
            <>
              <Link to="/player" className="btn btn-sm btn-outline">
                ♟ Player Portal
              </Link>
              <Link to="/app" className="btn btn-sm btn-primary">
                ♕ Organizer Desk
              </Link>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-sm btn-outline">
                Sign in
              </Link>
              <Link to="/signup" className="btn btn-sm btn-primary">
                Create free account
              </Link>
            </>
          )}
        </div>
      </header>

      <main className="page-content">
        <div className="page-container discover-page">
          <div className="page-header">
            <div>
              <p className="page-breadcrumb">
                <span>Global Tournament Discovery</span>
              </p>
              <h1>Explore Chess Tournaments</h1>
              <p className="page-subtitle">
                Find verified chess tournaments near you, view categories &amp; entry fees, and
                register yourself or your children in 1 click.
              </p>
            </div>
            {auth.user && (
              <div className="page-header-actions">
                <Link to="/player" className="btn btn-outline">
                  My Player &amp; Family Profiles →
                </Link>
              </div>
            )}
          </div>

          {/* Search & GPS Nearby Controls */}
          <section className="admin-panel discover-filter-bar" aria-label="Search and GPS filters">
            <form
              className="discover-search-row"
              onSubmit={handleSearchSubmit}
            >
              <input
                className="input discover-search-input"
                type="search"
                aria-label="Search tournaments"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by tournament name, city, state, venue, or academy…"
              />
              <button type="submit" className="btn btn-primary">
                Search
              </button>
              <button
                type="button"
                className={`btn ${coords ? 'btn-primary' : 'btn-outline'}`}
                onClick={handleNearMeClick}
                disabled={locating}
              >
                {locating ? 'Locating…' : coords ? '📍 Near Me Active' : '📍 Near Me (GPS)'}
              </button>
              {coords && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleClearGps}
                >
                  Clear GPS
                </button>
              )}
            </form>

            {coords && (
              <div className="discover-radius-row" role="group" aria-label="Distance radius">
                <span className="admin-metric-label">Radius:</span>
                {RADIUS_OPTIONS.map((opt) => {
                  const active = radiusKm === opt.value;
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      className={`player-profile-chip ${active ? 'active' : ''}`}
                      onClick={() => {
                        setRadiusKm(opt.value);
                        void loadEvents({
                          lat: coords.lat,
                          lng: coords.lng,
                          radiusKm: opt.value,
                        });
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {gpsStatus && (
              <p className="form-hint" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                {gpsStatus}
              </p>
            )}
          </section>

          {error && (
            <div className="form-error" role="alert" style={{ marginBottom: '1rem' }}>
              {error}
            </div>
          )}

          {loading ? (
            <p className="loading-row">Loading published tournaments…</p>
          ) : events.length === 0 ? (
            <div className="empty-state" style={{ padding: '2.5rem 1.5rem' }}>
              <span className="empty-icon">♟</span>
              <h3>No published tournaments match your filters</h3>
              <p className="form-hint" style={{ maxWidth: '34rem', margin: '0.5rem auto 1rem' }}>
                Try expanding the distance radius, clearing your search query, or check back soon
                for newly published tournaments.
              </p>
              {(search || coords) && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setSearch('');
                    setCoords(null);
                    setGpsStatus(null);
                    void loadEvents({ lat: null, lng: null, radiusKm: null, search: '' });
                  }}
                >
                  Reset Filters
                </button>
              )}
            </div>
          ) : (
            <div className="discover-events-grid">
              {events.map((ev) => {
                const registerHref = `/register/${encodeURIComponent(ev.publicSlug || ev.id)}`;
                const locationText = [ev.venueName, ev.city, ev.state]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <article key={ev.id} className="discover-event-card">
                    <div className="discover-card-top">
                      <div>
                        {ev.organizationName && (
                          <span className="discover-org-label">{ev.organizationName}</span>
                        )}
                        <h3 className="discover-event-title">{ev.name}</h3>
                      </div>
                      <div className="discover-badges">
                        {ev.distanceKm != null && (
                          <span className="discover-distance-badge">
                            📍 {ev.distanceKm.toFixed(1)} km away
                          </span>
                        )}
                        <span
                          className={`org-status-badge ${
                            ev.registrationOpen ? 'is-verified' : 'is-pending_review'
                          }`}
                        >
                          {ev.registrationOpen ? 'Registration Open' : 'Registration Closed'}
                        </span>
                      </div>
                    </div>

                    <div className="discover-meta-grid">
                      <div>
                        <span className="admin-metric-label">Date</span>
                        <strong>{ev.date ?? 'TBA'}</strong>
                      </div>
                      <div>
                        <span className="admin-metric-label">Format</span>
                        <strong>
                          {ev.style.toUpperCase()} · {ev.rounds}R
                          {ev.timeControl ? ` (${ev.timeControl})` : ''}
                        </strong>
                      </div>
                      <div>
                        <span className="admin-metric-label">Entry Fee</span>
                        <strong>{formatFee(ev.entryFeeCents, ev.currency)}</strong>
                      </div>
                      <div>
                        <span className="admin-metric-label">Roster</span>
                        <strong>
                          {ev.registeredCount}
                          {ev.maxParticipants ? ` / ${ev.maxParticipants}` : ''} players
                        </strong>
                      </div>
                    </div>

                    {locationText && (
                      <p className="discover-venue-line">
                        🏛 {locationText}
                      </p>
                    )}

                    {ev.categories.length > 0 && (
                      <div className="discover-category-pills">
                        {ev.categories.map((c) => (
                          <span key={c.id} className="player-chip-badge">
                            {c.name}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="discover-card-footer">
                      <Link to={registerHref} className="btn btn-primary">
                        {ev.registrationOpen ? 'View & Register →' : 'View Event Details →'}
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
