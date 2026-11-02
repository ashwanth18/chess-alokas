import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AGE_PROOF_FIELD,
  matchesFilter,
  type PlayerProfile,
  type PlayerRelationship,
  type TournamentRegistration,
} from '@chess-alokas/shared';
import {
  apiGetPublicEvent,
  apiListPlayerProfiles,
  apiSchoolSuggestions,
  apiSubmitEventRegistration,
  type PublicEventDetailResponse,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { GuardianConsentNotice } from '../components/LegalLinks';
import { DemoNotice } from '../components/DemoNotice';
import { trackPageView } from '../lib/pageAnalytics';
import { BrandCrown } from '../ui/BrandCrown';
import { Button, Field, PlayerName, buttonClass } from '../ui';
import { Surface } from '../ui/Surface';
import {
  EMPTY_PARENT_FORM,
  ParentFormFields,
  type ParentFormValues,
} from './registration-form/ParentFormFields';
import { UPLOAD_ACCEPT, asPublicForm, readUpload } from './registration-form/formLogic';
import './registration-form/registrationForm.css';

const RELATIONSHIP_LABELS: Record<PlayerRelationship, string> = {
  self: 'Self',
  child: 'Child',
  student: 'Student',
  family: 'Family',
};

const STATUS_SENTENCE: Record<string, string> = {
  pending: 'waiting for the organizer to approve it',
  waitlisted: 'on the waitlist, because the roster is full',
};

function formatFee(cents: number, currency = 'MYR'): string {
  if (!cents || cents <= 0) return 'Free';
  const amount = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  return `${currency} ${amount}`;
}

function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The event's own calendar date, so "2 Mar 2030" doesn't move with the reader's time zone. */
export function formatEventDate(date: string): string {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export default function EventRegistrationPage() {
  const { slug } = useParams<{ slug: string }>();
  const auth = useAuth();

  const [detail, setDetail] = useState<PublicEventDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<PlayerProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  const [values, setValues] = useState<ParentFormValues>(EMPTY_PARENT_FORM);
  const onChange = useCallback(
    (patch: Partial<ParentFormValues>) => setValues((v) => ({ ...v, ...patch })),
    [],
  );
  /** Field (`ageProof`, a question id, or `receipt`) to the file chosen for it. */
  const [files, setFiles] = useState<Record<string, { dataUrl: string; name: string }>>({});
  const [schoolOptions, setSchoolOptions] = useState<string[]>([]);

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
      const yob = profile.yearOfBirth;
      const bestRating = profile.fideStandard ?? profile.fideRapid ?? profile.fideBlitz ?? null;
      const matched =
        cats.length > 0
          ? cats.find((c) =>
              matchesFilter(
                {
                  name: profile.fullName,
                  age: yob != null ? Math.max(0, new Date().getFullYear() - yob) : 0,
                  gender: profile.gender ?? null,
                  rating: bestRating,
                  club: profile.club ?? profile.school ?? null,
                },
                c.filter,
              ),
            )
          : undefined;
      setValues((v) => ({
        ...v,
        name: profile.fullName,
        yearOfBirth: yob != null ? String(yob) : '',
        gender: profile.gender ?? '',
        fideId: profile.fideId != null ? String(profile.fideId) : '',
        rating: bestRating != null ? String(bestRating) : '',
        school: profile.school ?? '',
        club: profile.club ?? '',
        city: profile.city ?? '',
        state: profile.state ?? '',
        email: profile.email ?? auth.user?.email ?? '',
        phone: profile.phone ?? '',
        ...(matched ? { categoryId: matched.id } : {}),
      }));
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
    if (res.data.categories.length > 0) {
      const first = [...res.data.categories].sort((a, b) => a.sortOrder - b.sortOrder)[0]!;
      setValues((v) => (v.categoryId ? v : { ...v, categoryId: first.id }));
    }

    if (auth.user) {
      const profRes = await apiListPlayerProfiles();
      if (profRes.ok && profRes.data.profiles.length > 0) {
        setProfiles(profRes.data.profiles);
        const primary = profRes.data.profiles.find((p) => p.isPrimary) ?? profRes.data.profiles[0]!;
        applyProfileAutofill(primary, res.data.categories);
      } else if (auth.user.email) {
        const email = auth.user.email;
        setValues((v) => ({ ...v, email }));
      }
    }
    setLoading(false);
  }, [slug, auth.user, applyProfileAutofill]);

  useEffect(() => {
    void loadEventAndProfiles();
  }, [loadEventAndProfiles]);

  const event = detail?.event ?? null;
  const form = useMemo(() => asPublicForm(event?.registrationFormSchema), [event?.registrationFormSchema]);

  // Suggestions come from this organizer's own earlier entries, as the parent types.
  const schoolQuery = values.school.trim();
  const canSuggestSchools = Boolean(event?.registrationOpen && form.collectSchool);
  useEffect(() => {
    if (!slug || !canSuggestSchools || schoolQuery.length < 2) {
      setSchoolOptions([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      void apiSchoolSuggestions(slug, schoolQuery).then((res) => {
        if (!stale && res.ok) setSchoolOptions(res.data.schools);
      });
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [slug, canSuggestSchools, schoolQuery]);

  async function chooseFile(field: string, file: File | null) {
    if (!file) {
      setFiles((prev) => {
        const { [field]: _removed, ...rest } = prev;
        return rest;
      });
      return;
    }
    const read = await readUpload(file);
    if ('error' in read) {
      setSubmitError(read.error);
      return;
    }
    setSubmitError(null);
    setFiles((prev) => ({ ...prev, [field]: { dataUrl: read.dataUrl, name: file.name } }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!slug || !detail) return;
    if (!values.name.trim()) {
      setSubmitError('Player full name is required.');
      return;
    }
    const yobNum = values.yearOfBirth.trim() ? Number(values.yearOfBirth.trim()) : null;
    const ageNum = yobNum != null ? Math.max(0, new Date().getFullYear() - yobNum) : null;
    const customFiles = Object.fromEntries(
      form.questions
        .filter((q) => q.type === 'file' && files[q.id])
        .map((q) => [q.id, files[q.id]!.dataUrl]),
    );

    setSubmitting(true);
    setSubmitError(null);
    const res = await apiSubmitEventRegistration(slug, {
      playerProfileId: selectedProfileId,
      selectedCategoryId: values.categoryId || null,
      name: values.name.trim(),
      age: ageNum,
      yearOfBirth: yobNum,
      gender: values.gender.trim() || null,
      fideId: values.fideId.trim() ? Number(values.fideId.trim()) : null,
      rating: values.rating.trim() ? Number(values.rating.trim()) : null,
      school: values.school.trim() || null,
      club: values.club.trim() || null,
      city: values.city.trim() || null,
      state: values.state.trim() || null,
      email: values.email.trim() || null,
      phone: values.phone.trim() || null,
      customAnswers: values.answers,
      ...(Object.keys(customFiles).length ? { customFiles } : {}),
      ...(form.collectNric ? { nricNumber: values.nricNumber.trim() } : {}),
      ...(form.collectAgeProof && files[AGE_PROOF_FIELD]
        ? { ageProofDataUrl: files[AGE_PROOF_FIELD]!.dataUrl }
        : {}),
      receiptDataUrl: files.receipt?.dataUrl ?? null,
      // The notice sits by the button, so submitting is the acceptance.
      guardianConsent: true,
    });
    setSubmitting(false);

    if (!res.ok) {
      setSubmitError(res.error);
      return;
    }
    setSubmittedReg(res.data.registration);
    window.scrollTo?.({ top: 0 });
  }

  /** A sibling shares contact details and school, but never a name, an ID or a file. */
  function registerAnother() {
    setSubmittedReg(null);
    setFiles({});
    setSelectedProfileId(null);
    setValues((v) => ({
      ...EMPTY_PARENT_FORM,
      categoryId: v.categoryId,
      school: v.school,
      club: v.club,
      city: v.city,
      state: v.state,
      email: v.email,
      phone: v.phone,
    }));
  }

  const categories = [...(detail?.categories ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const participants = detail?.participants ?? [];
  const mapsHref =
    event?.latitude != null && event?.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${event.latitude},${event.longitude}`
      : event?.venueAddress || event?.venueName
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            [event.venueName, event.venueAddress, event.city, event.state].filter(Boolean).join(', '),
          )}`
        : null;
  const deadlinePassed =
    event?.registrationDeadline != null && new Date(event.registrationDeadline).getTime() < Date.now();
  const acceptingEntries = Boolean(event?.registrationOpen) && !deadlinePassed;
  const full = event?.maxParticipants != null && (event.registeredCount ?? 0) >= event.maxParticipants;

  return (
    <Surface name="family">
      <div className="rg-page">
        <header className="rg-top">
          <Link to="/discover" className="rg-brand">
            <BrandCrown />
            Chess Alokas
          </Link>
          <nav aria-label="Account">
            <Link to="/discover" className={buttonClass({ size: 'sm', variant: 'quiet' })}>
              All events
            </Link>
            {auth.user ? (
              <Link to="/player" className={buttonClass({ size: 'sm' })}>
                Player portal
              </Link>
            ) : (
              <Link to="/login" className={buttonClass({ size: 'sm' })}>
                Sign in to fill from a saved player
              </Link>
            )}
          </nav>
        </header>

        <main className="rg-main">
          {event?.isDemo && (
            <DemoNotice>
              This is a demo event. It is fictional: please don’t attend or pay. Entries are only
              saved from a demo player account.
            </DemoNotice>
          )}
          {loading ? (
            <p role="status">Loading the event…</p>
          ) : error || !event ? (
            <section className="ui-card rg-card">
              <h1>Event not found</h1>
              <p>{error ?? 'This registration link is no longer valid.'}</p>
              <Link to="/discover" className={buttonClass({ variant: 'primary' })}>
                Explore events
              </Link>
            </section>
          ) : (
            <>
              <section className="ui-card rg-hero">
                {event.organizationName && <span className="rg-org">{event.organizationName}</span>}
                <h1>{event.name}</h1>
                <p className="rg-where">
                  {[event.venueName, event.venueAddress, event.city, event.state].filter(Boolean).join(' · ') ||
                    'Venue to be announced by the organizer'}
                </p>
                <dl className="rg-facts">
                  <div>
                    <dt>Date</dt>
                    <dd>{event.date ? formatEventDate(event.date) : 'To be announced'}</dd>
                  </div>
                  <div>
                    <dt>Format</dt>
                    <dd>
                      {event.style === 'dutch' ? 'FIDE Dutch Swiss' : 'Swiss'}, {event.rounds} rounds
                      {event.timeControl ? `, ${event.timeControl}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>Entry fee</dt>
                    <dd>{formatFee(event.entryFeeCents, event.currency)}</dd>
                  </div>
                  <div>
                    <dt>Players</dt>
                    <dd>
                      {event.registeredCount} confirmed
                      {event.maxParticipants ? ` · ${event.maxParticipants} places` : ''}
                    </dd>
                  </div>
                  {event.registrationDeadline && (
                    <div>
                      <dt>{deadlinePassed ? 'Registration closed' : 'Registration closes'}</dt>
                      <dd>{formatDeadline(event.registrationDeadline)}</dd>
                    </div>
                  )}
                </dl>
                <div className="rg-links">
                  {mapsHref && (
                    <a href={mapsHref} target="_blank" rel="noopener noreferrer" className={buttonClass({ size: 'sm' })}>
                      Open venue in Google Maps
                    </a>
                  )}
                  {event.publicToken && (
                    <Link to={`/live/${encodeURIComponent(event.publicToken)}`} className={buttonClass({ size: 'sm' })}>
                      Live standings
                    </Link>
                  )}
                </div>
                {event.descriptionMd && <p className="rg-text">{event.descriptionMd}</p>}
                {event.rulesMd && (
                  <details className="rg-rules">
                    <summary>Rules</summary>
                    <p className="rg-text">{event.rulesMd}</p>
                  </details>
                )}
              </section>

              {submittedReg ? (
                <section className="ui-card rg-card" aria-live="polite">
                  <h2>Entry sent for {submittedReg.playerSnapshot.name}</h2>
                  <p>
                    Your entry is {STATUS_SENTENCE[submittedReg.status] ?? submittedReg.status}. Once the
                    organizer approves it, the player joins the roster.
                  </p>
                  <div className="rg-links">
                    <Button variant="primary" onClick={registerAnother}>
                      Register another player
                    </Button>
                    {auth.user ? (
                      <Link to="/player" className={buttonClass()}>
                        Open player portal
                      </Link>
                    ) : (
                      <Link to="/signup" className={buttonClass()}>
                        Create an account to follow pairings
                      </Link>
                    )}
                  </div>
                </section>
              ) : !acceptingEntries ? (
                <section className="ui-card rg-card">
                  <h2>Registration is closed</h2>
                  <p>Contact the organizer about late entries.</p>
                </section>
              ) : (
                <section className="ui-card rg-card" aria-label="Player registration form">
                  <h2>Register a player</h2>
                  {full && <p className="rf-note rf-note--warn">The roster is full. New entries join the waitlist.</p>}

                  {auth.user && profiles.length > 0 && (
                    <div>
                      <p className="rf-note">Fill from a saved player</p>
                      <div className="rg-profiles">
                        {profiles.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className={`rg-profile${selectedProfileId === p.id ? ' is-on' : ''}`}
                            aria-pressed={selectedProfileId === p.id}
                            onClick={() => applyProfileAutofill(p, categories)}
                          >
                            {p.fullName} ({RELATIONSHIP_LABELS[p.relationship] ?? p.relationship})
                          </button>
                        ))}
                        <button
                          type="button"
                          className={`rg-profile${selectedProfileId === null ? ' is-on' : ''}`}
                          aria-pressed={selectedProfileId === null}
                          onClick={() => {
                            setSelectedProfileId(null);
                            onChange({
                              name: '',
                              yearOfBirth: '',
                              gender: '',
                              fideId: '',
                              rating: '',
                              school: '',
                              club: '',
                            });
                          }}
                        >
                          Someone else
                        </button>
                      </div>
                    </div>
                  )}

                  <form onSubmit={(e) => void handleSubmit(e)}>
                    <ParentFormFields
                      form={form}
                      categories={categories}
                      values={values}
                      onChange={onChange}
                      fileNames={Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.name]))}
                      onFile={(field, file) => void chooseFile(field, file)}
                      schoolOptions={schoolOptions}
                    />

                    {event.entryFeeCents > 0 && (
                      <div className="rg-payment">
                        <h3>Entry fee: {formatFee(event.entryFeeCents, event.currency)}</h3>
                        {event.paymentInstructions && <p className="rg-text">{event.paymentInstructions}</p>}
                        {event.paymentQrUrl && <img src={event.paymentQrUrl} alt="Organizer payment QR code" />}
                        <Field
                          label="Payment receipt"
                          optional
                          hint={
                            files.receipt
                              ? `Attached: ${files.receipt.name}`
                              : 'Screenshot or PDF, up to 5 MB. You can also send it later from your account.'
                          }
                        >
                          {(control) => (
                            <input
                              {...control}
                              type="file"
                              accept={UPLOAD_ACCEPT}
                              onChange={(e) => void chooseFile('receipt', e.target.files?.[0] ?? null)}
                            />
                          )}
                        </Field>
                      </div>
                    )}

                    {submitError && (
                      <p className="rg-error" role="alert">
                        {submitError}
                      </p>
                    )}

                    <GuardianConsentNotice />

                    <div className="rg-submit">
                      <Button type="submit" variant="primary" disabled={submitting}>
                        {submitting ? 'Sending…' : 'Submit entry'}
                      </Button>
                    </div>
                  </form>
                </section>
              )}

              <section className="ui-card rg-card" aria-label="Players on the roster">
                <h2>Roster ({participants.length})</h2>
                {participants.length === 0 ? (
                  <p>No confirmed players yet.</p>
                ) : (
                  <table className="rg-roster">
                    <thead>
                      <tr>
                        <th scope="col" className="rg-num">
                          No.
                        </th>
                        <th scope="col">Name</th>
                        <th scope="col" className="rg-data">
                          Rating
                        </th>
                        <th scope="col" className="rg-data">
                          FIDE ID
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {participants.map((p, idx) => (
                        <tr key={p.id}>
                          <td>{idx + 1}</td>
                          <td>
                            <PlayerName name={p.name} />
                          </td>
                          <td className="rg-data">{p.rating ?? 'None'}</td>
                          <td className="rg-data">{p.fideId ?? 'None'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </Surface>
  );
}
