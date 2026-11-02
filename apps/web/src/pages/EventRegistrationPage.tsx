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
import { trackPageView } from '../lib/pageAnalytics';
import { BrandCrown } from '../ui/BrandCrown';
import { PlayerName, buttonClass } from '../ui';
import { Surface } from '../ui/Surface';
import { EMPTY_ENTRY_FORM, type EntryFormValues } from './registration-form/EntryFormFields';
import {
  EntrySent,
  EventHeader,
  RegistrationClosed,
  RegistrationForm,
  availability,
  useChosenFiles,
} from './registration-form/RegistrationView';
import { asPublicForm } from './registration-form/formLogic';

export { formatEventDate } from './registration-form/RegistrationView';

const RELATIONSHIP_LABELS: Record<PlayerRelationship, string> = {
  self: 'Self',
  child: 'Child',
  student: 'Student',
  family: 'Family',
};

export default function EventRegistrationPage() {
  const { slug } = useParams<{ slug: string }>();
  const auth = useAuth();

  const [detail, setDetail] = useState<PublicEventDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<PlayerProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  const [values, setValues] = useState<EntryFormValues>(EMPTY_ENTRY_FORM);
  const onChange = useCallback(
    (patch: Partial<EntryFormValues>) => setValues((v) => ({ ...v, ...patch })),
    [],
  );
  const [schoolOptions, setSchoolOptions] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Field (`ageProof`, a question id, or `receipt`) to the file chosen for it. */
  const { files, setFiles, choose: chooseFile } = useChosenFiles(setSubmitError);
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

  // Suggestions come from this organizer's own earlier entries, as the player types.
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
    // Lead with what happened, not the event card above it.
    requestAnimationFrame(() => document.getElementById('rg-done-title')?.scrollIntoView?.({ block: 'start' }));
  }

  /** A sibling shares contact details and school, but never a name, an ID or a file. */
  function registerAnother() {
    setSubmittedReg(null);
    setFiles({});
    setSelectedProfileId(null);
    setValues((v) => ({
      ...EMPTY_ENTRY_FORM,
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
  const now = Date.now();
  const state = event ? availability(event, now) : 'closed';
  const submittedCategory = submittedReg?.selectedCategoryId
    ? (categories.find((c) => c.id === submittedReg.selectedCategoryId)?.name ?? null)
    : null;

  const lead =
    auth.user && profiles.length > 0 ? (
      <div className="rg-profiles-wrap">
        <p className="rg-profiles__label">Fill from a saved player</p>
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
    ) : !auth.user ? (
      <p className="rg-signin">
        Registered before? <Link to="/login">Sign in</Link> to fill this from a saved player.
      </p>
    ) : null;

  const roster = (
    <section className="ui-card rg-roster-card" aria-labelledby="rg-roster-title">
      <h2 id="rg-roster-title">Confirmed players ({participants.length})</h2>
      {participants.length === 0 ? (
        <p className="rg-muted">No confirmed players yet.</p>
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
  );

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
                Sign in
              </Link>
            )}
          </nav>
        </header>

        <main className="rg-main">
          {event?.isDemo && (
            <p className="rg-note rg-note--demo" role="note">
              This is a demo event. It is fictional: please don’t attend or pay. Entries are only
              saved from a demo player account.
            </p>
          )}
          {loading ? (
            <p role="status">Loading the event…</p>
          ) : error || !event ? (
            <section className="ui-card rg-done">
              <h1>Event not found</h1>
              <p>{error ?? 'This registration link is no longer valid.'}</p>
              <div className="rg-done__actions">
                <Link to="/discover" className={buttonClass({ variant: 'primary' })}>
                  Explore events
                </Link>
              </div>
            </section>
          ) : (
            <>
              <EventHeader event={event} now={now} />

              {submittedReg ? (
                <div className="rg-body">
                  <div className="rg-col">
                    <EntrySent
                      registration={submittedReg}
                      event={event}
                      category={submittedCategory}
                      signedIn={Boolean(auth.user)}
                      onAnother={registerAnother}
                    />
                    {roster}
                  </div>
                </div>
              ) : state === 'closed' ? (
                <div className="rg-body">
                  <div className="rg-col">
                    <RegistrationClosed event={event} now={now} />
                    {roster}
                  </div>
                </div>
              ) : (
                <RegistrationForm
                  event={event}
                  form={form}
                  categories={categories}
                  values={values}
                  onChange={onChange}
                  files={files}
                  onFile={(field, file) => void chooseFile(field, file)}
                  schoolOptions={schoolOptions}
                  onSubmit={(e) => void handleSubmit(e)}
                  submitting={submitting}
                  error={submitError}
                  full={state === 'full'}
                  lead={lead}
                  idPrefix="rg"
                  signedIn={Boolean(auth.user)}
                  after={roster}
                />
              )}

            </>
          )}
        </main>
      </div>
    </Surface>
  );
}
