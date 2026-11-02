import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AGE_PROOF_FIELD,
  maskNric,
  type PublicRegistrationForm,
  type TournamentRegistration,
} from '@chess-alokas/shared';
import { GuardianConsentNotice } from '../../components/LegalLinks';
import {
  Button,
  IconCalendar,
  IconCheck,
  IconCheckCircle,
  IconClock,
  IconExternal,
  IconHourglass,
  IconLock,
  IconMapPin,
  IconTicket,
  IconUsers,
  buttonClass,
} from '../../ui';
import {
  EMPTY_ENTRY_FORM,
  EntryFormFields,
  FileDrop,
  FormSection,
  entrySections,
  type ChosenFile,
  type EntryFormValues,
  type SectionInfo,
} from './EntryFormFields';
import { readUpload } from './formLogic';
import './registerPage.css';

/** What the page shows about an event. The public API's event fits it; so does the organizer's draft. */
export interface RegistrationEvent {
  isDemo?: boolean;
  name: string;
  organizationName: string | null;
  date: string | null;
  style: string;
  rounds: number;
  timeControl: string | null;
  venueName: string | null;
  venueAddress: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  entryFeeCents: number;
  currency: string;
  registrationOpen: boolean;
  registrationDeadline: string | null;
  maxParticipants: number | null;
  registeredCount: number;
  descriptionMd: string | null;
  rulesMd: string | null;
  paymentInstructions: string | null;
  paymentQrUrl: string | null;
  publicToken: string | null;
}

const DAY = 86_400_000;

/** "RM 30" for ringgit, "SGD 30" for anything else, "Free" for nothing. */
export function formatFee(cents: number, currency = 'MYR'): string {
  if (!cents || cents <= 0) return 'Free';
  const amount = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  return `${currency === 'MYR' ? 'RM' : currency} ${amount}`;
}

/** The event's own calendar date, so "Sat, 2 Mar 2030" doesn't move with the reader's time zone. */
export function formatEventDate(date: string): string {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Closes 14 Dec, 23:59 · 5 days left", urgent under three days, or when it closed. */
export function deadlineText(
  iso: string,
  now: number,
): { text: string; day: string; urgent: boolean; passed: boolean } {
  const at = new Date(iso);
  const left = at.getTime() - now;
  const sameYear = at.getFullYear() === new Date(now).getFullYear();
  const day = at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (left <= 0) return { text: `Closed ${day}`, day, urgent: false, passed: true };
  const days = Math.floor(left / DAY);
  const remaining = days === 0 ? 'last day' : days === 1 ? '1 day left' : `${days} days left`;
  return { text: `Closes ${day}, ${time} · ${remaining}`, day, urgent: left < 3 * DAY, passed: false };
}

export type Availability = 'open' | 'full' | 'closed';

export function availability(event: RegistrationEvent, now: number): Availability {
  const passed = event.registrationDeadline != null && new Date(event.registrationDeadline).getTime() <= now;
  if (!event.registrationOpen || passed) return 'closed';
  if (event.maxParticipants != null && event.registeredCount >= event.maxParticipants) return 'full';
  return 'open';
}

function mapsHref(event: RegistrationEvent): string | null {
  if (event.latitude != null && event.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${event.latitude},${event.longitude}`;
  }
  const where = [event.venueName, event.venueAddress, event.city, event.state].filter(Boolean).join(', ');
  return where ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}` : null;
}

function formatName(event: RegistrationEvent): string {
  const style = event.style === 'dutch' ? 'FIDE Dutch Swiss' : 'Swiss';
  return [`${style}, ${event.rounds} rounds`, event.timeControl].filter(Boolean).join(' · ');
}

const STATUS_PILL: Record<Availability, string> = {
  open: 'Open for entries',
  full: 'Full · waitlist open',
  closed: 'Registration closed',
};

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="rg-fact">
      <dt>
        <span className="rg-fact__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="ui-vh">{label}</span>
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The event card at the top: what, who, when, where, how much, and how long there is to enter. */
export function EventHeader({ event, now }: { event: RegistrationEvent; now: number }) {
  const state = availability(event, now);
  const deadline = event.registrationDeadline ? deadlineText(event.registrationDeadline, now) : null;
  const map = mapsHref(event);
  const address = [event.venueAddress, event.city, event.state].filter(Boolean).join(', ');
  const places = event.maxParticipants;
  return (
    <section className="ui-card rg-event" aria-labelledby="rg-event-title">
      <div className="rg-event__main">
        <div className="rg-event__tags">
          <span className={`rg-pill rg-pill--${state}`}>{STATUS_PILL[state]}</span>
          {event.isDemo && <span className="rg-pill rg-pill--demo">Demo</span>}
        </div>
        {event.organizationName && <p className="rg-event__org">{event.organizationName}</p>}
        <h1 id="rg-event-title">{event.name}</h1>
        {event.descriptionMd && <p className="rg-text">{event.descriptionMd}</p>}
        <div className="rg-event__links">
          {event.publicToken && (
            <Link to={`/live/${encodeURIComponent(event.publicToken)}`} className={buttonClass({ size: 'sm' })}>
              Live standings
            </Link>
          )}
        </div>
        {event.rulesMd && (
          <details className="rg-more">
            <summary>Rules</summary>
            <p className="rg-text">{event.rulesMd}</p>
          </details>
        )}
      </div>
      <dl className="rg-event__facts">
        <Fact icon={<IconCalendar size={18} />} label="Date">
          {event.date ? formatEventDate(event.date) : 'Date to be announced'}
        </Fact>
        <Fact icon={<IconMapPin size={18} />} label="Venue">
          {event.venueName || address ? (
            <>
              <span className="rg-fact__main">{event.venueName || address}</span>
              {event.venueName && address && <span className="rg-fact__sub">{address}</span>}
            </>
          ) : (
            'Venue to be announced'
          )}
          {map && (
            <a className="rg-fact__link" href={map} target="_blank" rel="noopener noreferrer">
              Directions <IconExternal size={14} />
            </a>
          )}
        </Fact>
        <Fact icon={<IconClock size={18} />} label="Format">
          {formatName(event)}
        </Fact>
        <Fact icon={<IconTicket size={18} />} label="Entry fee">
          {event.entryFeeCents > 0 ? `Entry ${formatFee(event.entryFeeCents, event.currency)}` : 'Free'}
        </Fact>
        <Fact icon={<IconUsers size={18} />} label="Places">
          {event.registeredCount} confirmed{places ? ` · ${places} places` : ''}
          {places ? (
            <span className="rg-meter" aria-hidden="true">
              <span style={{ width: `${Math.min(100, Math.round((event.registeredCount / places) * 100))}%` }} />
            </span>
          ) : null}
        </Fact>
        {deadline && (
          <Fact icon={<IconHourglass size={18} />} label="Registration deadline">
            <span className={deadline.urgent ? 'rg-urgent' : undefined}>{deadline.text}</span>
          </Fact>
        )}
      </dl>
    </section>
  );
}

/** A sticky list of the sections on a wide screen, a bar on a phone. */
function Steps({ sections, prefix }: { sections: SectionInfo[]; prefix: string }) {
  const done = sections.filter((s) => s.done).length;
  const go = (key: string) => {
    const el = document.getElementById(`${prefix}-${key}`);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };
  return (
    <nav className="rg-steps" aria-label="Form sections">
      <p className="rg-steps__count">
        {done} of {sections.length} sections done
      </p>
      <span className="rg-meter rg-steps__bar" aria-hidden="true">
        <span style={{ width: `${Math.round((done / sections.length) * 100)}%` }} />
      </span>
      <ol>
        {sections.map((s, i) => (
          <li key={s.key}>
            <button type="button" className={`rg-step${s.done ? ' is-done' : ''}`} onClick={() => go(s.key)}>
              <span className="rg-step__n" aria-hidden="true">
                {s.done ? <IconCheck size={14} /> : i + 1}
              </span>
              {s.title}
              {s.done && <span className="ui-vh">, complete</span>}
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="rg-step" onClick={() => go('review')}>
            <span className="rg-step__n" aria-hidden="true">
              {sections.length + 1}
            </span>
            Check and send
          </button>
        </li>
      </ol>
    </nav>
  );
}

export interface RegistrationFormProps {
  event: RegistrationEvent;
  form: PublicRegistrationForm;
  categories: Array<{ id: string; name: string }>;
  values: EntryFormValues;
  onChange: (patch: Partial<EntryFormValues>) => void;
  files: Record<string, ChosenFile>;
  onFile: (field: string, file: File | null) => void;
  schoolOptions?: string[];
  onSubmit: (e: FormEvent) => void;
  submitting?: boolean;
  error?: string | null;
  full: boolean;
  /** Above the player fields: saved players, or a sign-in line. */
  lead?: ReactNode;
  /** Shown above the button instead of sending, in the organizer's preview. */
  previewNote?: ReactNode;
  idPrefix: string;
  /** Below the form, in the same column: the roster on the public page. */
  after?: ReactNode;
}

/** The form, in sections, with payment, a short review and the button. */
export function RegistrationForm(props: RegistrationFormProps) {
  const { event, form, categories, values, files, full, idPrefix } = props;
  const hasFee = event.entryFeeCents > 0;
  const sections = useMemo(() => entrySections(form, values, files, hasFee), [form, values, files, hasFee]);
  const fee = formatFee(event.entryFeeCents, event.currency);
  const payment = sections.find((s) => s.key === 'payment');
  const reviewN = sections.length + 1;

  const category = categories.find((c) => c.id === values.categoryId)?.name;
  const docFields = [
    ...(form.collectAgeProof ? [AGE_PROOF_FIELD] : []),
    ...form.questions.filter((q) => q.type === 'file').map((q) => q.id),
  ];
  const attached = docFields.filter((f) => files[f]).length;
  const born = values.yearOfBirth.trim();

  return (
    <div className="rg-body rg-body--steps">
      <Steps sections={sections} prefix={idPrefix} />
      <div className="rg-col">
        <form className="rg-form" onSubmit={props.onSubmit} aria-label="Player registration form">
          {full && (
            <p className="rg-note rg-note--wait" role="status">
              All {event.maxParticipants} places are taken. New entries join the waitlist.
            </p>
          )}
          <EntryFormFields
            form={form}
            categories={categories}
            values={values}
            onChange={props.onChange}
            files={files}
            onFile={props.onFile}
            schoolOptions={props.schoolOptions}
            sections={sections}
            idPrefix={idPrefix}
            lead={props.lead}
          />

          {payment && (
            <FormSection id={`${idPrefix}-payment`} n={sections.indexOf(payment) + 1} title="Payment" done={payment.done}>
              <ol className="rg-pay">
                <li className="rg-pay__step">
                  <p className="rg-pay__title">
                    Pay <strong>{fee}</strong> to the organizer
                  </p>
                  <div className="rg-pay__how">
                    {event.paymentInstructions && <p className="rg-text">{event.paymentInstructions}</p>}
                    {event.paymentQrUrl && (
                      <img className="rg-pay__qr" src={event.paymentQrUrl} alt="Organizer payment QR code" />
                    )}
                  </div>
                </li>
                <li className="rg-pay__step">
                  <FileDrop
                    label={<span className="rg-pay__title">Attach the payment receipt</span>}
                    required={false}
                    hint="Screenshot or PDF, up to 5 MB. You can also send it later from your account."
                    file={files.receipt}
                    onFile={(file) => props.onFile('receipt', file)}
                  />
                </li>
              </ol>
            </FormSection>
          )}

          <FormSection id={`${idPrefix}-review`} n={reviewN} title="Check and send">
            <dl className="rg-summary">
              <div>
                <dt>Player</dt>
                <dd>
                  {values.name.trim() ? (
                    <>
                      {values.name.trim()}
                      {born ? `, born ${born}` : ''}
                    </>
                  ) : (
                    <span className="rg-missing">Name needed</span>
                  )}
                </dd>
              </div>
              {category && (
                <div>
                  <dt>Category</dt>
                  <dd>{category}</dd>
                </div>
              )}
              {form.collectNric && (
                <div>
                  <dt>NRIC</dt>
                  <dd>{maskNric(values.nricNumber) ?? <span className="rg-missing">Needed</span>}</dd>
                </div>
              )}
              <div>
                <dt>Contact</dt>
                <dd>{[values.email.trim(), values.phone.trim()].filter(Boolean).join(' · ') || 'None given'}</dd>
              </div>
              {docFields.length > 0 && (
                <div>
                  <dt>Documents</dt>
                  <dd>
                    {attached} of {docFields.length} attached
                  </dd>
                </div>
              )}
              {hasFee && (
                <div>
                  <dt>Payment</dt>
                  <dd>
                    {fee} · {files.receipt ? 'receipt attached' : 'no receipt yet'}
                  </dd>
                </div>
              )}
            </dl>

            {props.error && (
              <p className="rg-error" role="alert">
                {props.error}
              </p>
            )}
            {props.previewNote}
            <GuardianConsentNotice />
            <div className="rg-submit">
              <Button type="submit" variant="primary" size="lg" disabled={props.submitting}>
                {props.submitting ? 'Sending…' : full ? 'Join the waitlist' : 'Submit entry'}
              </Button>
            </div>
          </FormSection>
        </form>
        {props.after}
      </div>
    </div>
  );
}

/** After sending: who is entered, and what happens next. */
export function EntrySent({
  registration,
  event,
  category,
  signedIn,
  onAnother,
}: {
  registration: TournamentRegistration;
  event: RegistrationEvent;
  category: string | null;
  signedIn: boolean;
  onAnother: () => void;
}) {
  const waitlisted = registration.status === 'waitlisted';
  const pay = registration.paymentStatus;
  return (
    <section className="ui-card rg-done" aria-live="polite" aria-labelledby="rg-done-title">
      <span className="rg-done__icon" aria-hidden="true">
        <IconCheckCircle size={32} />
      </span>
      <h2 id="rg-done-title">Entry sent for {registration.playerSnapshot.name}</h2>
      <p className="rg-done__what">{[event.name, category].filter(Boolean).join(' · ')}</p>

      <h3 className="rg-done__next">What happens next</h3>
      <ol className="rg-next">
        <li className="rg-next__item is-now">
          <strong>{waitlisted ? 'On the waitlist' : 'Waiting for approval'}</strong>
          <span>
            {waitlisted
              ? 'The roster is full. If a place opens, the organizer can move this entry up.'
              : 'The organizer checks each entry. Once approved, the player joins the roster.'}
          </span>
        </li>
        {pay !== 'not_required' && (
          <li className={`rg-next__item${pay === 'submitted' ? ' is-done' : ''}`}>
            <strong>{pay === 'submitted' ? 'Receipt sent' : 'No receipt attached'}</strong>
            <span>
              {pay === 'submitted'
                ? 'The organizer checks it against the payment.'
                : 'Pay the organizer and keep the receipt. They may ask for it before approving.'}
            </span>
          </li>
        )}
        {event.publicToken && (
          <li className="rg-next__item">
            <strong>On the day</strong>
            <span>
              Pairings and results appear on the{' '}
              <Link to={`/live/${encodeURIComponent(event.publicToken)}`}>live page</Link>.
            </span>
          </li>
        )}
      </ol>

      <div className="rg-done__actions">
        <Button variant="primary" onClick={onAnother}>
          Register another player
        </Button>
        {signedIn ? (
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
  );
}

export function RegistrationClosed({ event, now }: { event: RegistrationEvent; now: number }) {
  const deadline = event.registrationDeadline ? deadlineText(event.registrationDeadline, now) : null;
  return (
    <section className="ui-card rg-done rg-done--closed" aria-labelledby="rg-closed-title">
      <span className="rg-done__icon" aria-hidden="true">
        <IconLock size={28} />
      </span>
      <h2 id="rg-closed-title">Registration is closed</h2>
      <p>
        {deadline?.passed ? `Entries closed on ${deadline.day}. ` : ''}Contact the organizer about late entries.
      </p>
      <div className="rg-done__actions">
        {event.publicToken && (
          <Link to={`/live/${encodeURIComponent(event.publicToken)}`} className={buttonClass({ variant: 'primary' })}>
            Live standings
          </Link>
        )}
        <Link to="/discover" className={buttonClass()}>
          Find another event
        </Link>
      </div>
    </section>
  );
}

/** Reads chosen files for the form. Errors go to `onError`. */
export function useChosenFiles(onError: (message: string | null) => void) {
  const [files, setFiles] = useState<Record<string, ChosenFile>>({});
  const choose = useCallback(
    async (field: string, file: File | null) => {
      if (!file) {
        setFiles((prev) => {
          const { [field]: _removed, ...rest } = prev;
          return rest;
        });
        return;
      }
      const read = await readUpload(file);
      if ('error' in read) {
        onError(read.error);
        return;
      }
      onError(null);
      setFiles((prev) => ({ ...prev, [field]: { dataUrl: read.dataUrl, name: file.name } }));
    },
    [onError],
  );
  return { files, setFiles, choose };
}

/**
 * The organizer's preview: the same header and form as the public page, inside the desk. It keeps
 * what is typed and attached on this screen only. Nothing is sent.
 */
export function RegistrationPreview({
  event,
  form,
  categories,
}: {
  event: RegistrationEvent;
  form: PublicRegistrationForm;
  categories: Array<{ id: string; name: string }>;
}) {
  const [width, setWidth] = useState<'phone' | 'computer'>('computer');
  const [values, setValues] = useState<EntryFormValues>(EMPTY_ENTRY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const { files, choose } = useChosenFiles(setError);
  const now = Date.now();
  const full = availability(event, now) === 'full';

  useEffect(() => {
    if (!values.categoryId && categories[0]) setValues((v) => ({ ...v, categoryId: categories[0]!.id }));
  }, [categories, values.categoryId]);

  return (
    <div className="rg-preview">
      <div className="rg-preview__bar">
        <p className="rg-preview__note">
          Preview only. Nothing here is sent.
          {!event.registrationOpen && ' Entries are off, so players see a closed page for now.'}
        </p>
        <div className="rg-preview__widths" role="group" aria-label="Preview width">
          {(['phone', 'computer'] as const).map((w) => (
            <button
              key={w}
              type="button"
              className={`rg-seg${width === w ? ' is-on' : ''}`}
              aria-pressed={width === w}
              onClick={() => setWidth(w)}
            >
              {w === 'phone' ? 'Phone' : 'Computer'}
            </button>
          ))}
        </div>
      </div>
      <div className={`ui-root rg-frame rg-frame--${width}`} data-surface="family">
        <div className="rg-page">
          <EventHeader event={{ ...event, registrationOpen: true }} now={now} />
          <RegistrationForm
            event={event}
            form={form}
            categories={categories}
            values={values}
            onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
            files={files}
            onFile={(field, file) => void choose(field, file)}
            onSubmit={(e) => {
              e.preventDefault();
              setTried(true);
            }}
            error={error}
            full={full}
            idPrefix="rg-preview"
            previewNote={
              tried ? (
                <p className="rg-note" role="status">
                  Preview only. This entry was not sent.
                </p>
              ) : null
            }
          />
        </div>
      </div>
    </div>
  );
}
