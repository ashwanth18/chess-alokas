import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  matchesFilter,
  type PlayerProfile,
  type PlayerRelationship,
  type TournamentRegistration,
} from '@chess-alokas/shared';
import {
  apiGetPublicEvent,
  apiListPlayerProfiles,
  apiSubmitEventRegistration,
  type PublicEventDetailResponse,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { GuardianConsentField } from '../components/LegalLinks';
import { guardianConsentRequired } from '@chess-alokas/shared';
import { trackPageView } from '../lib/pageAnalytics';

const RELATIONSHIP_LABELS: Record<PlayerRelationship, string> = {
  self: 'Self',
  child: 'Child',
  student: 'Student',
  family: 'Family',
};

function formatFee(cents: number, currency = 'MYR'): string {
  if (!cents || cents <= 0) return 'Free Entry';
  const amount = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  return `${currency} ${amount}`;
}

export default function EventRegistrationPage() {
  const { slug } = useParams<{ slug: string }>();
  const auth = useAuth();

  const [detail, setDetail] = useState<PublicEventDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<PlayerProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [yearOfBirth, setYearOfBirth] = useState('');
  const [guardianConsent, setGuardianConsent] = useState(false);
  const [gender, setGender] = useState('');
  const [fideId, setFideId] = useState('');
  const [rating, setRating] = useState('');
  const [school, setSchool] = useState('');
  const [club, setClub] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [receiptDataUrl, setReceiptDataUrl] = useState<string | null>(null);
  const [receiptFileName, setReceiptFileName] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedReg, setSubmittedReg] = useState<TournamentRegistration | null>(null);

  useEffect(() => {
    if (slug) {
      trackPageView({ routeKey: 'event_register', path: `/register/${slug}` });
    }
  }, [slug]);

  const applyProfileAutofill = useCallback(
    (profile: PlayerProfile, cats: PublicEventDetailResponse['categories']) => {
      setSelectedProfileId(profile.id);
      setName(profile.fullName);
      const yob = profile.yearOfBirth;
      setYearOfBirth(yob != null ? String(yob) : '');
      setGender(profile.gender ?? '');
      setFideId(profile.fideId != null ? String(profile.fideId) : '');
      const bestRating =
        profile.fideStandard ?? profile.fideRapid ?? profile.fideBlitz ?? null;
      setRating(bestRating != null ? String(bestRating) : '');
      setSchool(profile.school ?? '');
      setClub(profile.club ?? '');
      setCity(profile.city ?? '');
      setStateName(profile.state ?? '');
      setEmail(profile.email ?? auth.user?.email ?? '');
      setPhone(profile.phone ?? '');

      if (cats.length > 0) {
        const age = yob != null ? Math.max(0, new Date().getFullYear() - yob) : 0;
        const matched = cats.find((c) =>
          matchesFilter(
            {
              name: profile.fullName,
              age,
              gender: profile.gender ?? null,
              rating: bestRating,
              club: profile.club ?? profile.school ?? null,
            },
            c.filter,
          ),
        );
        if (matched) {
          setSelectedCategoryId(matched.id);
        }
      }
    },
    [auth.user?.email],
  );

  const loadEventAndProfiles = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    const res = await apiGetPublicEvent(slug);
    if (!res.ok) {
      setError(res.error);
      setLoading(false);
      return;
    }
    setDetail(res.data);
    if (res.data.categories.length > 0 && !selectedCategoryId) {
      const first = [...res.data.categories].sort((a, b) => a.sortOrder - b.sortOrder)[0]!;
      setSelectedCategoryId(first.id);
    }

    if (auth.user) {
      const profRes = await apiListPlayerProfiles();
      if (profRes.ok && profRes.data.profiles.length > 0) {
        setProfiles(profRes.data.profiles);
        const primary =
          profRes.data.profiles.find((p) => p.isPrimary) ?? profRes.data.profiles[0]!;
        applyProfileAutofill(primary, res.data.categories);
      } else if (auth.user.email) {
        setEmail(auth.user.email);
      }
    }
    setLoading(false);
  }, [slug, auth.user, applyProfileAutofill, selectedCategoryId]);

  useEffect(() => {
    void loadEventAndProfiles();
  }, [loadEventAndProfiles]);

  function handleReceiptFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setReceiptDataUrl(null);
      setReceiptFileName(null);
      return;
    }
    if (file.size > 3.5 * 1024 * 1024) {
      setSubmitError('Receipt file must be under 3.5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setReceiptDataUrl(reader.result);
        setReceiptFileName(file.name);
        setSubmitError(null);
      }
    };
    reader.readAsDataURL(file);
  }

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId) ?? null;
  const consentYear = yearOfBirth.trim() ? Number(yearOfBirth.trim()) : null;
  const needsGuardianConsent = guardianConsentRequired({
    relationship: selectedProfile?.relationship ?? null,
    yearOfBirth: consentYear,
    dateOfBirth: selectedProfile?.dateOfBirth ?? null,
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!slug || !detail) return;
    if (!name.trim()) {
      setSubmitError('Player full name is required.');
      return;
    }

    const yobNum = yearOfBirth.trim() ? Number(yearOfBirth.trim()) : null;
    const ageNum =
      yobNum != null ? Math.max(0, new Date().getFullYear() - yobNum) : null;

    setSubmitting(true);
    setSubmitError(null);

    const res = await apiSubmitEventRegistration(slug, {
      playerProfileId: selectedProfileId,
      selectedCategoryId: selectedCategoryId || null,
      name: name.trim(),
      age: ageNum,
      yearOfBirth: yobNum,
      gender: gender.trim() || null,
      fideId: fideId.trim() ? Number(fideId.trim()) : null,
      rating: rating.trim() ? Number(rating.trim()) : null,
      school: school.trim() || null,
      club: club.trim() || null,
      city: city.trim() || null,
      state: stateName.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      customAnswers,
      receiptDataUrl,
      guardianConsent: needsGuardianConsent ? guardianConsent : undefined,
    });
    setSubmitting(false);

    if (!res.ok) {
      setSubmitError(res.error);
      return;
    }
    setSubmittedReg(res.data.registration);
  }

  const event = detail?.event ?? null;
  const categories = [...(detail?.categories ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const participants = detail?.participants ?? [];
  const formSchema = event?.registrationFormSchema;
  const mapsHref =
    event?.latitude != null && event?.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${event.latitude},${event.longitude}`
      : event?.venueAddress || event?.venueName
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            [event.venueName, event.venueAddress, event.city, event.state]
              .filter(Boolean)
              .join(', '),
          )}`
        : null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/discover" className="brand">
          <span className="brand-knight" aria-hidden>
            ♕
          </span>
          <span className="brand-name">Chess Alokas</span>
        </Link>
        <div className="sync-bar">
          <Link to="/discover" className="btn btn-sm btn-ghost">
            ← All Events
          </Link>
          {auth.user ? (
            <Link to="/player" className="btn btn-sm btn-outline">
              ♟ Player Portal
            </Link>
          ) : (
            <Link to="/login" className="btn btn-sm btn-outline">
              Sign in for 1-Click Autofill
            </Link>
          )}
        </div>
      </header>

      <main className="page-content">
        <div className="page-container event-register-page">
          {loading ? (
            <p className="loading-row">Loading tournament details…</p>
          ) : error || !event ? (
            <div className="empty-state">
              <h1>Tournament Not Found</h1>
              <p className="form-hint">{error ?? 'This registration link is no longer valid.'}</p>
              <Link to="/discover" className="btn btn-primary">
                Explore Events
              </Link>
            </div>
          ) : (
            <>
              {/* Event Hero Card */}
              <section className="admin-panel event-hero-card">
                <div className="discover-card-top">
                  <div>
                    {event.organizationName && (
                      <span className="discover-org-label">{event.organizationName}</span>
                    )}
                    <h1>{event.name}</h1>
                    <p className="page-subtitle">
                      {[event.venueName, event.venueAddress, event.city, event.state]
                        .filter(Boolean)
                        .join(' · ') || 'Venue details announced by organizer'}
                    </p>
                  </div>
                  <div className="discover-badges">
                    <span
                      className={`org-status-badge ${
                        event.registrationOpen ? 'is-verified' : 'is-pending_review'
                      }`}
                    >
                      {event.registrationOpen ? 'Registration Open' : 'Registration Closed'}
                    </span>
                    {event.publicToken && (
                      <Link
                        to={`/live/${encodeURIComponent(event.publicToken)}`}
                        className="btn btn-sm btn-outline"
                      >
                        Live Standings →
                      </Link>
                    )}
                  </div>
                </div>

                <div className="discover-meta-grid" style={{ marginTop: '1rem' }}>
                  <div>
                    <span className="admin-metric-label">Date</span>
                    <strong>{event.date ?? 'TBA'}</strong>
                  </div>
                  <div>
                    <span className="admin-metric-label">Format &amp; Rounds</span>
                    <strong>
                      {event.style.toUpperCase()} · {event.rounds} Rounds
                      {event.timeControl ? ` (${event.timeControl})` : ''}
                    </strong>
                  </div>
                  <div>
                    <span className="admin-metric-label">Entry Fee</span>
                    <strong>{formatFee(event.entryFeeCents, event.currency)}</strong>
                  </div>
                  <div>
                    <span className="admin-metric-label">Approved Roster</span>
                    <strong>
                      {event.registeredCount}
                      {event.maxParticipants ? ` / ${event.maxParticipants}` : ''} players
                    </strong>
                  </div>
                </div>

                {mapsHref && (
                  <div style={{ marginTop: '0.85rem' }}>
                    <a
                      href={mapsHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-sm btn-outline"
                    >
                      📍 Open Venue in Google Maps ↗
                    </a>
                  </div>
                )}

                {event.descriptionMd && (
                  <div className="event-description-box" style={{ marginTop: '1rem' }}>
                    <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{event.descriptionMd}</p>
                  </div>
                )}
                {event.rulesMd && (
                  <details style={{ marginTop: '0.75rem' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                      Tournament Rules &amp; Regulations
                    </summary>
                    <p className="form-hint" style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>
                      {event.rulesMd}
                    </p>
                  </details>
                )}
              </section>

              {/* Registration Form or Confirmation Card */}
              {submittedReg ? (
                <section className="admin-panel" aria-live="polite">
                  <span className="org-status-badge is-verified">Registration Submitted</span>
                  <h2 style={{ marginTop: '0.5rem' }}>
                    You’re in the queue, {submittedReg.playerSnapshot.name}!
                  </h2>
                  <p className="form-hint">
                    Your registration status is <strong>{submittedReg.status.toUpperCase()}</strong>
                    {submittedReg.paymentStatus !== 'not_required'
                      ? ` · Payment: ${submittedReg.paymentStatus.replace('_', ' ')}`
                      : ''}
                    . Once the tournament organizer verifies your entry, you will appear in the
                    official tournament roster and receive live board pairings on matchday.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem', marginTop: '1rem' }}>
                    {auth.user ? (
                      <Link to="/player" className="btn btn-primary">
                        Open Player &amp; Family Portal →
                      </Link>
                    ) : (
                      <Link to="/signup" className="btn btn-primary">
                        Create Free Player Account to Track Live Pairings →
                      </Link>
                    )}
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => {
                        setSubmittedReg(null);
                        setReceiptDataUrl(null);
                        setReceiptFileName(null);
                      }}
                    >
                      + Register Another Child / Player
                    </button>
                  </div>
                </section>
              ) : !event.registrationOpen ? (
                <section className="admin-panel">
                  <h3>Online Registration Closed</h3>
                  <p className="form-hint">
                    Online registration is currently closed for this tournament. Contact the
                    organizer for late entry availability.
                  </p>
                </section>
              ) : (
                <section className="admin-panel" aria-label="Player registration form">
                  <h2>Player Registration Form</h2>

                  {/* 1-Click Family / Student Profile Selector */}
                  {auth.user && profiles.length > 0 && (
                    <div className="player-switcher-bar" style={{ marginTop: '0.75rem' }}>
                      <p className="admin-metric-label" style={{ marginBottom: '0.5rem' }}>
                        ⚡ 1-Click Autofill from your Player &amp; Family Profiles:
                      </p>
                      <div className="player-chips">
                        {profiles.map((p) => {
                          const active = selectedProfileId === p.id;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              className={`player-profile-chip ${active ? 'active' : ''}`}
                              onClick={() => applyProfileAutofill(p, categories)}
                            >
                              <span className="player-chip-name">{p.fullName}</span>
                              <span className="player-chip-badge">
                                {RELATIONSHIP_LABELS[p.relationship] ?? p.relationship}
                              </span>
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          className={`player-profile-chip ${selectedProfileId === null ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedProfileId(null);
                            setName('');
                            setYearOfBirth('');
                            setGender('');
                            setFideId('');
                            setRating('');
                            setSchool('');
                            setClub('');
                          }}
                        >
                          + Enter Manually
                        </button>
                      </div>
                    </div>
                  )}

                  <form className="auth-form" onSubmit={(e) => void handleSubmit(e)}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.75rem' }}>
                      <label>
                        Player Full Name *
                        <input
                          className="input"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="e.g. Aarav Ashwanth"
                          required
                        />
                      </label>
                      <label>
                        Year of Birth
                        <input
                          className="input"
                          type="number"
                          min={1920}
                          max={new Date().getFullYear()}
                          value={yearOfBirth}
                          onChange={(e) => setYearOfBirth(e.target.value)}
                          placeholder="2015"
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

                    {categories.length > 0 && (
                      <label>
                        Category / Section
                        <select
                          className="input"
                          value={selectedCategoryId}
                          onChange={(e) => setSelectedCategoryId(e.target.value)}
                        >
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      {(formSchema?.collectFideId ?? true) && (
                        <label>
                          FIDE ID (optional)
                          <input
                            className="input"
                            type="number"
                            value={fideId}
                            onChange={(e) => setFideId(e.target.value)}
                            placeholder="5820001"
                          />
                        </label>
                      )}
                      <label>
                        Rating (FIDE / National, optional)
                        <input
                          className="input"
                          type="number"
                          value={rating}
                          onChange={(e) => setRating(e.target.value)}
                          placeholder="1450"
                        />
                      </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      {(formSchema?.collectSchool ?? true) && (
                        <label>
                          School / Institution
                          <input
                            className="input"
                            value={school}
                            onChange={(e) => setSchool(e.target.value)}
                            placeholder="SJK(C) Chung Kwo"
                          />
                        </label>
                      )}
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

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
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
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <label>
                        Contact email (for the organizer and your digital certificate)
                        <input
                          className="input"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="parent@example.com"
                        />
                      </label>
                      {(formSchema?.collectPhone ?? true) && (
                        <label>
                          Phone / WhatsApp
                          <input
                            className="input"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="+60 12-345 6789"
                          />
                        </label>
                      )}
                    </div>

                    {/* Organizer Custom Questions */}
                    {(formSchema?.customQuestions ?? []).map((q) => (
                      <label key={q.id}>
                        {q.label} {q.required ? '*' : ''}
                        {q.type === 'select' && q.options?.length ? (
                          <select
                            className="input"
                            required={q.required}
                            value={customAnswers[q.id] ?? ''}
                            onChange={(e) =>
                              setCustomAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                            }
                          >
                            <option value="">Select…</option>
                            {q.options.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="input"
                            required={q.required}
                            value={customAnswers[q.id] ?? ''}
                            onChange={(e) =>
                              setCustomAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                            }
                          />
                        )}
                      </label>
                    ))}

                    {/* Paid Entry Fee & Receipt Upload */}
                    {event.entryFeeCents > 0 && (
                      <div className="payment-box">
                        <h4>
                          Entry Fee Payment: {formatFee(event.entryFeeCents, event.currency)}
                        </h4>
                        {event.paymentInstructions && (
                          <p className="form-hint" style={{ whiteSpace: 'pre-wrap' }}>
                            {event.paymentInstructions}
                          </p>
                        )}
                        {event.paymentQrUrl && (
                          <div style={{ margin: '0.75rem 0' }}>
                            <img
                              src={event.paymentQrUrl}
                              alt="Organizer payment QR code"
                              style={{
                                maxWidth: '220px',
                                borderRadius: '8px',
                                border: '1px solid var(--color-border)',
                              }}
                            />
                          </div>
                        )}
                        <label>
                          Upload Payment Receipt (Screenshot / Image / PDF)
                          <input
                            className="input"
                            type="file"
                            accept="image/*,application/pdf"
                            onChange={handleReceiptFileChange}
                          />
                        </label>
                        {receiptFileName && (
                          <p className="form-hint">Attached: {receiptFileName}</p>
                        )}
                      </div>
                    )}

                    {needsGuardianConsent && (
                      <GuardianConsentField
                        checked={guardianConsent}
                        onChange={setGuardianConsent}
                        ageKnown={consentYear != null || Boolean(selectedProfile?.dateOfBirth)}
                      />
                    )}

                    {submitError && <div className="form-error">{submitError}</div>}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={submitting}
                      >
                        {submitting ? 'Submitting Registration…' : 'Submit Registration →'}
                      </button>
                    </div>
                  </form>
                </section>
              )}

              {/* Registered Roster Preview */}
              <section className="admin-panel" aria-label="Approved participants">
                <h3>Confirmed Roster ({participants.length})</h3>
                {participants.length === 0 ? (
                  <p className="form-hint">No confirmed players on the roster yet.</p>
                ) : (
                  <div className="table-scroll" style={{ marginTop: '0.75rem' }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Name</th>
                          <th>Rating</th>
                          <th>FIDE ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {participants.map((p, idx) => (
                          <tr key={p.id}>
                            <td>{idx + 1}</td>
                            <td>
                              <strong>{p.name}</strong>
                            </td>
                            <td>{p.rating ?? '—'}</td>
                            <td>{p.fideId ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
