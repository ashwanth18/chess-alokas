import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  PlayerCareerDashboard,
  PlayerProfile,
  PlayerRelationship,
} from '@chess-alokas/shared';
import {
  apiGetPlayerDashboard,
  apiCreatePlayerProfile,
  apiUpdatePlayerProfile,
  apiDeletePlayerProfile,
  apiClaimPlayerParticipations,
  apiDownloadCertificatePdf,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';

const RELATIONSHIP_LABELS: Record<PlayerRelationship, string> = {
  self: 'Self',
  child: 'Child',
  student: 'Student',
  family: 'Family',
};

export default function PlayerPortalPage() {
  const auth = useAuth();
  const [dashboard, setDashboard] = useState<PlayerCareerDashboard | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<PlayerProfile | null>(null);
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [relationship, setRelationship] = useState<PlayerRelationship>('self');
  const [yearOfBirth, setYearOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [fideId, setFideId] = useState('');
  const [fideStandard, setFideStandard] = useState('');
  const [fideRapid, setFideRapid] = useState('');
  const [fideBlitz, setFideBlitz] = useState('');
  const [school, setSchool] = useState('');
  const [club, setClub] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [email, setEmail] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const loadDashboard = useCallback(
    async (profileId?: string | null) => {
      setLoading(true);
      setError(null);
      const res = await apiGetPlayerDashboard(profileId ?? selectedProfileId);
      if (!res.ok) {
        setError(res.error);
        setLoading(false);
        return;
      }
      setDashboard(res.data);
      if (res.data.selectedProfile) {
        setSelectedProfileId(res.data.selectedProfile.id);
      }
      setLoading(false);
    },
    [selectedProfileId],
  );

  useEffect(() => {
    void loadDashboard(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreateModal(defaultRel: PlayerRelationship = 'child') {
    setEditingProfile(null);
    const hasProfiles = (dashboard?.profiles.length ?? 0) > 0;
    const rel = hasProfiles ? defaultRel : 'self';
    setRelationship(rel);
    setFullName(!hasProfiles ? (auth.displayName ?? '') : '');
    setUsername('');
    setYearOfBirth('');
    setGender('');
    setFideId('');
    setFideStandard('');
    setFideRapid('');
    setFideBlitz('');
    setSchool('');
    setClub('');
    setCity('');
    setStateName('');
    setEmail(!hasProfiles ? (auth.user?.email ?? '') : '');
    setModalError(null);
    setModalOpen(true);
  }

  function openEditModal(profile: PlayerProfile) {
    setEditingProfile(profile);
    setRelationship(profile.relationship);
    setFullName(profile.fullName);
    setUsername(profile.username ?? '');
    setYearOfBirth(profile.yearOfBirth != null ? String(profile.yearOfBirth) : '');
    setGender(profile.gender ?? '');
    setFideId(profile.fideId != null ? String(profile.fideId) : '');
    setFideStandard(profile.fideStandard != null ? String(profile.fideStandard) : '');
    setFideRapid(profile.fideRapid != null ? String(profile.fideRapid) : '');
    setFideBlitz(profile.fideBlitz != null ? String(profile.fideBlitz) : '');
    setSchool(profile.school ?? '');
    setClub(profile.club ?? '');
    setCity(profile.city ?? '');
    setStateName(profile.state ?? '');
    setEmail(profile.email ?? '');
    setModalError(null);
    setModalOpen(true);
  }

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      setModalError('Full name is required.');
      return;
    }
    setSavingProfile(true);
    setModalError(null);

    const payload = {
      fullName: fullName.trim(),
      username: username.trim().replace(/^@/, '') || null,
      relationship,
      yearOfBirth: yearOfBirth.trim() ? Number(yearOfBirth.trim()) : null,
      gender: gender.trim() || null,
      fideId: fideId.trim() ? Number(fideId.trim()) : null,
      fideStandard: fideStandard.trim() ? Number(fideStandard.trim()) : null,
      fideRapid: fideRapid.trim() ? Number(fideRapid.trim()) : null,
      fideBlitz: fideBlitz.trim() ? Number(fideBlitz.trim()) : null,
      school: school.trim() || null,
      club: club.trim() || null,
      city: city.trim() || null,
      state: stateName.trim() || null,
      email: email.trim() || null,
    };

    if (editingProfile) {
      const res = await apiUpdatePlayerProfile(editingProfile.id, payload);
      setSavingProfile(false);
      if (!res.ok) {
        setModalError(res.error);
        return;
      }
      setModalOpen(false);
      setNotice(`Updated profile for ${res.data.profile.fullName}.`);
      await loadDashboard(res.data.profile.id);
    } else {
      const res = await apiCreatePlayerProfile({
        ...payload,
        isPrimary: (dashboard?.profiles.length ?? 0) === 0,
      });
      setSavingProfile(false);
      if (!res.ok) {
        setModalError(res.error);
        return;
      }
      setModalOpen(false);
      setNotice(`Added profile for ${res.data.profile.fullName}.`);
      await loadDashboard(res.data.profile.id);
    }
  }

  async function handleClaimPast() {
    const profile = dashboard?.selectedProfile;
    if (!profile) return;
    setClaiming(true);
    setError(null);
    setNotice(null);
    const res = await apiClaimPlayerParticipations(profile.id);
    setClaiming(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNotice(
      res.data.claimedCount > 0
        ? `Linked ${res.data.claimedCount} tournament participation(s) to ${profile.fullName}.`
        : `Nothing to link. An entry links only when it has your confirmed email (${auth.user?.email ?? 'your account email'}) and its name matches this profile's full name exactly. Otherwise, register from this profile and the organizer links it when approving.`,
    );
    await loadDashboard(profile.id);
  }

  async function handleDeleteProfile(profile: PlayerProfile) {
    if (!window.confirm(`Remove profile "${profile.fullName}" from your account?`)) return;
    const res = await apiDeletePlayerProfile(profile.id);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNotice(`Removed profile "${profile.fullName}".`);
    await loadDashboard(null);
  }

  async function handleDownloadCert(issueId: string, recipientName: string, tournamentName: string) {
    setDownloadingId(issueId);
    const safeName = `${recipientName}-${tournamentName}`.replace(/[^\w.\-]+/g, '_');
    const res = await apiDownloadCertificatePdf(issueId, safeName);
    setDownloadingId(null);
    if (!res.ok) {
      setError(res.error);
    }
  }

  const profiles = dashboard?.profiles ?? [];
  const selectedProfile = dashboard?.selectedProfile ?? null;
  const liveMatches = dashboard?.liveMatches ?? [];
  const stats = dashboard?.stats ?? {
    tournamentsCount: 0,
    gamesPlayed: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    totalPoints: 0,
  };
  const tournaments = dashboard?.tournaments ?? [];
  const certificates = dashboard?.certificates ?? [];

  return (
    <div className="page-container player-portal-page">
      <div className="page-header">
        <div>
          <p className="page-breadcrumb">
            <span>Participant &amp; Family Portal</span>
          </p>
          <h1>Player &amp; Family Hub</h1>
          <p className="page-subtitle">
            Track live tournament pairings, manage child &amp; student profiles, and download official
            digital certificates.
          </p>
          <p className="page-subtitle">
            A tournament joins this profile in one of two ways: you register from this profile and
            the organizer approves it, or the organizer entered your confirmed account email and
            you link it here. Names and FIDE IDs aren&apos;t enough, since anyone can type them.
          </p>
        </div>
        <div className="page-header-actions">
          <Link to="/discover" className="btn btn-outline">
            📍 Explore Events Near Me
          </Link>
          {selectedProfile && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => void handleClaimPast()}
              disabled={claiming}
            >
              {claiming ? 'Linking…' : 'Link Tournaments by My Email'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => openCreateModal(profiles.length === 0 ? 'self' : 'child')}
          >
            + Add Family / Student Profile
          </button>
        </div>
      </div>

      {error && (
        <div className="form-error" role="alert" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      {notice && (
        <p className="form-hint stage-banner-ok" role="status" style={{ marginBottom: '1rem' }}>
          {notice}
        </p>
      )}

      {/* Family / Player Switcher Bar */}
      <section className="player-switcher-bar" aria-label="Player profiles">
        {loading && !dashboard ? (
          <p className="form-hint">Loading player profiles…</p>
        ) : profiles.length === 0 ? (
          <div className="empty-state" style={{ padding: '2rem 1.5rem' }}>
            <h3>Create your Player or Child Profile</h3>
            <p className="form-hint" style={{ maxWidth: '34rem', margin: '0.5rem auto 1rem' }}>
              One account can manage your own chess profile plus profiles for your children or
              students. Add a profile to view live round pairings, W/D/L career stats, and
              certificates.
            </p>
            <div className="empty-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => openCreateModal('self')}
              >
                + Create My Player Profile
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => openCreateModal('child')}
              >
                + Add Child / Student Profile
              </button>
            </div>
          </div>
        ) : (
          <div className="player-switcher-row">
            <div className="player-chips" role="tablist" aria-label="Switch player profile">
              {profiles.map((p) => {
                const active = selectedProfile?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`player-profile-chip ${active ? 'active' : ''}`}
                    onClick={() => void loadDashboard(p.id)}
                  >
                    <span className="player-chip-name">{p.fullName}</span>
                    {p.username && <span className="player-chip-handle">@{p.username}</span>}
                    <span className="player-chip-badge">
                      {RELATIONSHIP_LABELS[p.relationship] ?? p.relationship}
                    </span>
                  </button>
                );
              })}
            </div>
            {selectedProfile && (
              <div className="player-switcher-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => openEditModal(selectedProfile)}
                >
                  Edit Profile
                </button>
                {!selectedProfile.isPrimary && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => void handleDeleteProfile(selectedProfile)}
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {selectedProfile && (
        <>
          {/* Live Matchday Companion Card */}
          <section className="admin-panel player-live-section" aria-label="Live Matchday Companion">
            <div className="player-section-head">
              <div>
                <h3>Live Matchday Companion</h3>
                <p className="admin-metric-detail">
                  Instant board assignment, piece color, opponent rating, and live score for{' '}
                  <strong>{selectedProfile.fullName}</strong>.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => void loadDashboard(selectedProfile.id)}
                disabled={loading}
              >
                {loading ? 'Refreshing…' : 'Refresh Live Status'}
              </button>
            </div>

            {liveMatches.length === 0 ? (
              <p className="admin-metric-detail" style={{ marginTop: '0.5rem' }}>
                No active live tournament round right now. If {selectedProfile.fullName} is playing in
                an event today, click <strong>Link Tournaments by My Email</strong>. An entry links
                only when it has your confirmed email and its name matches this profile&apos;s full
                name. Otherwise, the organizer links the player when approving a registration made
                from this profile.
              </p>
            ) : (
              <div className="player-live-grid">
                {liveMatches.map((m) => (
                  <div key={`${m.tournamentId}-${m.round}`} className="player-match-card">
                    <div className="player-match-top">
                      <div>
                        <span className="player-live-pill">
                          {m.tournamentStatus === 'in_progress' ? '● LIVE ROUND' : 'READY'}
                        </span>
                        <h4 className="player-match-tournament">{m.tournamentName}</h4>
                      </div>
                      <div className="player-match-score-badge">
                        <span>Score</span>
                        <strong>{m.currentScore} pts</strong>
                      </div>
                    </div>

                    <div className="player-match-metrics">
                      <div className="player-match-stat">
                        <span className="admin-metric-label">Round</span>
                        <strong>Round {m.round}</strong>
                      </div>
                      <div className="player-match-stat">
                        <span className="admin-metric-label">Board #</span>
                        <strong>{m.board > 0 ? `Board ${m.board}` : 'Awaiting'}</strong>
                      </div>
                      <div className="player-match-stat">
                        <span className="admin-metric-label">Color</span>
                        <strong className={`player-color-tag is-${m.color}`}>
                          {m.color === 'white'
                            ? '♔ White'
                            : m.color === 'black'
                              ? '♚ Black'
                              : 'Bye'}
                        </strong>
                      </div>
                      <div className="player-match-stat">
                        <span className="admin-metric-label">Result</span>
                        <strong>{m.result === 'pending' ? 'In Play' : m.result}</strong>
                      </div>
                    </div>

                    <div className="player-match-opponent">
                      <span className="admin-metric-label">Opponent</span>
                      {m.isBye ? (
                        <strong>Full-point Bye (+1.0)</strong>
                      ) : m.opponentName ? (
                        <strong>
                          {m.opponentName}{' '}
                          <span className="admin-metric-detail">
                            ({m.opponentRating ? `Rating ${m.opponentRating}` : 'Unrated'})
                          </span>
                        </strong>
                      ) : (
                        <strong>Pairings not published yet</strong>
                      )}
                    </div>

                    {m.publicToken && (
                      <div style={{ marginTop: '0.75rem' }}>
                        <Link
                          className="btn btn-sm btn-outline"
                          to={`/live/${encodeURIComponent(m.publicToken)}/p/${encodeURIComponent(m.participantId)}`}
                        >
                          Open Full Live Standings &amp; Pairings →
                        </Link>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Career Overview Cards */}
          <section className="admin-hero" aria-label="Career overview">
            <div className="admin-hero-card">
              <span className="admin-metric-label">Alokas Rating</span>
              <strong>{selectedProfile.alokasRating}</strong>
              <span className="admin-metric-detail">
                {selectedProfile.school || selectedProfile.club || selectedProfile.city || 'Global Player'}
              </span>
            </div>

            <div className="admin-hero-card">
              <span className="admin-metric-label">FIDE Ratings</span>
              <strong>
                {selectedProfile.fideStandard ||
                  selectedProfile.fideRapid ||
                  selectedProfile.fideBlitz ||
                  'Unrated'}
              </strong>
              <span className="admin-metric-detail">
                Std {selectedProfile.fideStandard ?? '—'} · Rpd {selectedProfile.fideRapid ?? '—'} ·
                Blz {selectedProfile.fideBlitz ?? '—'}
                {selectedProfile.fideId ? ` · ID ${selectedProfile.fideId}` : ''}
              </span>
            </div>

            <div className="admin-hero-card">
              <span className="admin-metric-label">Games Played</span>
              <strong>{stats.gamesPlayed}</strong>
              <span className="admin-metric-detail">
                {stats.tournamentsCount} tournament(s) · {stats.totalPoints} total pts
              </span>
            </div>

            <div className="admin-hero-card admin-hero-accent">
              <span className="admin-metric-label">Win / Draw / Loss</span>
              <strong>
                {stats.wins}W · {stats.draws}D · {stats.losses}L
              </strong>
              <span className="admin-metric-detail">
                {stats.gamesPlayed > 0
                  ? `${Math.round((stats.wins / stats.gamesPlayed) * 100)}% win rate`
                  : 'No completed games yet'}
              </span>
            </div>
          </section>

          {/* Past & Active Tournaments Table */}
          <section className="admin-panel" aria-label="Tournament history">
            <h3>Tournament History</h3>
            <p className="admin-metric-detail">
              All Chess Alokas tournaments linked to <strong>{selectedProfile.fullName}</strong>.
            </p>
            {tournaments.length === 0 ? (
              <p className="admin-metric-detail" style={{ marginTop: '0.5rem' }}>
                No tournaments linked yet. <strong>Link Tournaments by My Email</strong> finds entries with
                your confirmed email and this profile&apos;s full name. Otherwise, the organizer links
                the player when approving a registration made from this profile.
              </p>
            ) : (
              <div className="table-scroll" style={{ marginTop: '0.75rem' }}>
                <table className="data-table admin-table">
                  <thead>
                    <tr>
                      <th>Tournament</th>
                      <th>Date</th>
                      <th>Format</th>
                      <th>Status</th>
                      <th>Score</th>
                      <th>W / D / L</th>
                      <th>Live View</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tournaments.map((t) => (
                      <tr key={t.participantId}>
                        <td>
                          <strong>{t.tournamentName}</strong>
                        </td>
                        <td>{t.tournamentDate ?? '—'}</td>
                        <td>
                          {t.style.toUpperCase()} · {t.rounds}R
                        </td>
                        <td>{t.tournamentStatus.replace('_', ' ')}</td>
                        <td>
                          <strong>{t.score}</strong> / {t.rounds}
                        </td>
                        <td>
                          {t.wins}W · {t.draws}D · {t.losses}L
                        </td>
                        <td>
                          {t.publicToken ? (
                            <Link
                              to={`/live/${encodeURIComponent(t.publicToken)}/p/${encodeURIComponent(t.participantId)}`}
                            >
                              View →
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Digital Certificate Vault */}
          <section className="admin-panel" aria-label="Digital Certificate Vault">
            <h3>Digital Certificate Vault</h3>
            <p className="admin-metric-detail">
              Official participation and podium certificates issued to{' '}
              <strong>{selectedProfile.fullName}</strong>.
            </p>
            {certificates.length === 0 ? (
              <p className="admin-metric-detail" style={{ marginTop: '0.5rem' }}>
                No digital certificates issued yet. When an organizer issues certificates for a
                completed tournament, they appear here automatically for 1-click PDF download.
              </p>
            ) : (
              <div className="table-scroll" style={{ marginTop: '0.75rem' }}>
                <table className="data-table admin-table">
                  <thead>
                    <tr>
                      <th>Tournament</th>
                      <th>Award Type</th>
                      <th>Recipient</th>
                      <th>Serial #</th>
                      <th>Issued</th>
                      <th>Download</th>
                    </tr>
                  </thead>
                  <tbody>
                    {certificates.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <strong>{c.tournamentName}</strong>
                        </td>
                        <td>
                          {c.type === 'winner'
                            ? `🏆 Winner${c.rank ? ` (Place #${c.rank})` : ''}`
                            : 'Certificate of Participation'}
                        </td>
                        <td>{c.recipientName}</td>
                        <td>
                          <code>{c.serial ?? '—'}</code>
                        </td>
                        <td>{c.tournamentDate ?? c.createdAt.slice(0, 10)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            disabled={downloadingId === c.id}
                            onClick={() =>
                              void handleDownloadCert(c.id, c.recipientName, c.tournamentName)
                            }
                          >
                            {downloadingId === c.id ? 'Downloading…' : 'Download PDF'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* Add / Edit Player Profile Modal */}
      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label={editingProfile ? 'Edit Player Profile' : 'Add Family / Student Profile'}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>{editingProfile ? 'Edit Player Profile' : 'Add Family / Student Profile'}</h2>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setModalOpen(false)}
              >
                ✕
              </button>
            </div>
            <form className="auth-form" onSubmit={(e) => void handleSaveProfile(e)}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                <label>
                  Full Name *
                  <input
                    className="input"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Aarav Ashwanth"
                    required
                  />
                </label>
                <label>
                  Relationship
                  <select
                    className="input"
                    value={relationship}
                    onChange={(e) => setRelationship(e.target.value as PlayerRelationship)}
                  >
                    <option value="self">Self (Primary Player)</option>
                    <option value="child">Child (Son / Daughter)</option>
                    <option value="student">Academy Student</option>
                    <option value="family">Family Member</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.65rem' }}>
                <label>
                  @username (optional)
                  <input
                    className="input"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="aarav_chess"
                  />
                </label>
                <label>
                  Year of Birth
                  <input
                    className="input"
                    type="number"
                    min={1920}
                    max={2026}
                    value={yearOfBirth}
                    onChange={(e) => setYearOfBirth(e.target.value)}
                    placeholder="2014"
                  />
                </label>
                <label>
                  Gender
                  <select
                    className="input"
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                  >
                    <option value="">—</option>
                    <option value="M">Male (M)</option>
                    <option value="F">Female (F)</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.65rem' }}>
                <label>
                  FIDE ID
                  <input
                    className="input"
                    type="number"
                    value={fideId}
                    onChange={(e) => setFideId(e.target.value)}
                    placeholder="5820001"
                  />
                </label>
                <label>
                  FIDE Std
                  <input
                    className="input"
                    type="number"
                    value={fideStandard}
                    onChange={(e) => setFideStandard(e.target.value)}
                    placeholder="1450"
                  />
                </label>
                <label>
                  FIDE Rapid
                  <input
                    className="input"
                    type="number"
                    value={fideRapid}
                    onChange={(e) => setFideRapid(e.target.value)}
                    placeholder="1450"
                  />
                </label>
                <label>
                  FIDE Blitz
                  <input
                    className="input"
                    type="number"
                    value={fideBlitz}
                    onChange={(e) => setFideBlitz(e.target.value)}
                    placeholder="1420"
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem' }}>
                <label>
                  School
                  <input
                    className="input"
                    value={school}
                    onChange={(e) => setSchool(e.target.value)}
                    placeholder="SJK(C) Chung Kwo"
                  />
                </label>
                <label>
                  Chess Club / Academy
                  <input
                    className="input"
                    value={club}
                    onChange={(e) => setClub(e.target.value)}
                    placeholder="KL Junior Chess Academy"
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.65rem' }}>
                <label>
                  City
                  <input
                    className="input"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Kuala Lumpur"
                  />
                </label>
                <label>
                  State
                  <input
                    className="input"
                    value={stateName}
                    onChange={(e) => setStateName(e.target.value)}
                    placeholder="WP Kuala Lumpur"
                  />
                </label>
                <label>
                  Contact Email
                  <input
                    className="input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="parent@example.com"
                  />
                </label>
              </div>

              {modalError && <div className="form-error">{modalError}</div>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingProfile}>
                  {savingProfile
                    ? 'Saving…'
                    : editingProfile
                      ? 'Save Changes'
                      : 'Add Profile'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
