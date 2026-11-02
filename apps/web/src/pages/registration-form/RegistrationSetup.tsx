import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  DEFAULT_REGISTRATION_FORM_CONFIG,
  countRegistrationAnswers,
  type RegistrationFormConfig,
  type Tournament,
  type TournamentRegistration,
} from '@chess-alokas/shared';
import { apiGetTournamentPublishing, apiUpdateTournamentPublishing } from '../../api/client';
import { Button, Field, Sheet } from '../../ui';
import { FormBuilder } from './FormBuilder';
import { RegistrationPreview, type RegistrationEvent } from './RegistrationView';
import { ShareLink } from './ShareLink';
import { asPublicForm, formSummary, fromLocalInput, registrationLink, toLocalInput } from './formLogic';
import './registrationForm.css';

interface Draft {
  publicSlug: string;
  registrationOpen: boolean;
  isPublishedGlobal: boolean;
  registrationDeadline: string;
  maxParticipants: string;
  venueName: string;
  venueAddress: string;
  city: string;
  state: string;
  country: string;
  latitude: string;
  longitude: string;
  timeControl: string;
  entryFee: string;
  paymentInstructions: string;
  paymentQrUrl: string | null;
  descriptionMd: string;
  rulesMd: string;
  form: RegistrationFormConfig;
}

type SavedRow = Partial<Tournament>;

function draftFrom(t: SavedRow): Draft {
  return {
    publicSlug: t.publicSlug ?? '',
    registrationOpen: Boolean(t.registrationOpen),
    isPublishedGlobal: Boolean(t.isPublishedGlobal),
    registrationDeadline: toLocalInput(t.registrationDeadline),
    maxParticipants: t.maxParticipants != null ? String(t.maxParticipants) : '',
    venueName: t.venueName ?? '',
    venueAddress: t.venueAddress ?? '',
    city: t.city ?? '',
    state: t.state ?? '',
    country: t.country ?? 'Malaysia',
    latitude: t.latitude != null ? String(t.latitude) : '',
    longitude: t.longitude != null ? String(t.longitude) : '',
    timeControl: t.timeControl ?? '',
    entryFee: t.entryFeeCents != null ? String(t.entryFeeCents / 100) : '0',
    paymentInstructions: t.paymentInstructions ?? '',
    paymentQrUrl: t.paymentQrUrl ?? null,
    descriptionMd: t.descriptionMd ?? '',
    rulesMd: t.rulesMd ?? '',
    form: { ...DEFAULT_REGISTRATION_FORM_CONFIG, ...(t.registrationFormSchema ?? {}) },
  };
}

const optionalNumber = (raw: string): number | null => {
  const n = raw.trim() === '' ? null : Number(raw);
  return n != null && Number.isFinite(n) ? n : null;
};

/** Tidies what the textarea allows while typing: blank lines and repeats aren't options. */
function cleanForm(form: RegistrationFormConfig): RegistrationFormConfig {
  return {
    ...form,
    customQuestions: (form.customQuestions ?? []).map((q) => ({
      ...q,
      label: q.label.trim(),
      labelMs: q.labelMs?.trim() || null,
      ...(q.type === 'select'
        ? { options: [...new Set((q.options ?? []).map((o) => o.trim()).filter(Boolean))] }
        : {}),
    })),
  };
}

export function RegistrationSetup({
  tournamentId,
  tournamentName,
  local,
  categories,
  registrations,
  ensureSynced,
  onSaved,
  onFormChange,
}: {
  tournamentId: string;
  tournamentName: string;
  /** The desk's own copy, shown while the server's is on its way or out of reach. */
  local: SavedRow;
  categories: Array<{ id: string; name: string }>;
  /** The queue as it stands, so the editor knows which questions have answers right now. */
  registrations: TournamentRegistration[];
  /** A tournament made offline has to reach the cloud before it can be published. */
  ensureSynced: () => Promise<void>;
  onSaved: (tournament: Tournament) => Promise<void> | void;
  onFormChange?: (form: RegistrationFormConfig) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(local));
  const [baseline, setBaseline] = useState<string>(() => JSON.stringify(draftFrom(local)));
  const [can, setCan] = useState<{ listPublicly: boolean; takePaidEntries: boolean; maxPlayers: number | null }>({
    listPublicly: false,
    takePaidEntries: false,
    maxPlayers: null,
  });
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'forbidden' | 'offline'>('loading');
  const [editing, setEditing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState('loading');
    let res = await apiGetTournamentPublishing(tournamentId);
    if (!res.ok && res.status === 404) {
      await ensureSynced().catch(() => undefined);
      res = await apiGetTournamentPublishing(tournamentId);
    }
    if (!res.ok) {
      setLoadState(res.status === 403 ? 'forbidden' : 'offline');
      return;
    }
    const next = draftFrom({ ...res.data.tournament, registrationFormSchema: res.data.form });
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setCan(res.data.can);
    onFormChange?.(res.data.form);
    setLoadState('ready');
  }, [tournamentId, ensureSynced, onFormChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = JSON.stringify(draft) !== baseline;
  const set = (patch: Partial<Draft>) => {
    setNotice(null);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const text = (field: keyof Draft) => ({
    value: String(draft[field] ?? ''),
    onChange: (e: ChangeEvent<HTMLInputElement>) => set({ [field]: e.target.value } as Partial<Draft>),
  });

  // The server applies the same rule on save, so a stale count here can't lose an answer.
  const answerCounts = useMemo(
    () =>
      countRegistrationAnswers(
        draft.form.customQuestions ?? [],
        registrations.map((r) => ({ customAnswers: r.customAnswers, privateFiles: r.files })),
      ),
    [draft.form.customQuestions, registrations],
  );

  const previewForm = useMemo(() => asPublicForm(cleanForm(draft.form)), [draft.form]);
  const slugOrId = draft.publicSlug.trim() || tournamentId;
  const link = registrationLink(
    slugOrId,
    Boolean(window.desktop?.isDesktop),
    window.location.origin,
  );
  const approved = registrations.filter((r) => r.status === 'approved').length;
  // The public page's event, as this draft would publish it.
  const previewEvent: RegistrationEvent = {
    name: tournamentName,
    organizationName: null,
    date: local.date ?? null,
    style: local.style ?? 'swiss',
    rounds: local.rounds ?? 0,
    timeControl: draft.timeControl.trim() || null,
    venueName: draft.venueName.trim() || null,
    venueAddress: draft.venueAddress.trim() || null,
    city: draft.city.trim() || null,
    state: draft.state.trim() || null,
    latitude: optionalNumber(draft.latitude),
    longitude: optionalNumber(draft.longitude),
    entryFeeCents: Math.max(0, Math.round((Number(draft.entryFee) || 0) * 100)),
    currency: 'MYR',
    registrationOpen: draft.registrationOpen,
    registrationDeadline: fromLocalInput(draft.registrationDeadline),
    maxParticipants: optionalNumber(draft.maxParticipants),
    registeredCount: approved,
    descriptionMd: draft.descriptionMd.trim() || null,
    rulesMd: draft.rulesMd.trim() || null,
    paymentInstructions: draft.paymentInstructions.trim() || null,
    paymentQrUrl: draft.paymentQrUrl,
    publicToken: null,
  };
  const baselineOpen = useMemo(() => (JSON.parse(baseline) as Draft).registrationOpen, [baseline]);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await ensureSynced().catch(() => undefined);
      const form = cleanForm(draft.form);
      const emptyLabel = form.customQuestions.find((q) => !q.hidden && !q.label);
      if (emptyLabel) {
        setError('Each question needs an English label.');
        setEditing(true);
        return;
      }
      const noOptions = form.customQuestions.find((q) => !q.hidden && q.type === 'select' && !q.options?.length);
      if (noOptions) {
        setError(`“${noOptions.label}” needs at least one option.`);
        setEditing(true);
        return;
      }
      const res = await apiUpdateTournamentPublishing(tournamentId, {
        publicSlug: draft.publicSlug.trim() || null,
        registrationOpen: draft.registrationOpen,
        isPublishedGlobal: draft.isPublishedGlobal,
        registrationDeadline: fromLocalInput(draft.registrationDeadline),
        maxParticipants: optionalNumber(draft.maxParticipants),
        venueName: draft.venueName.trim() || null,
        venueAddress: draft.venueAddress.trim() || null,
        city: draft.city.trim() || null,
        state: draft.state.trim() || null,
        country: draft.country.trim() || null,
        latitude: optionalNumber(draft.latitude),
        longitude: optionalNumber(draft.longitude),
        timeControl: draft.timeControl.trim() || null,
        entryFeeCents: Math.max(0, Math.round((Number(draft.entryFee) || 0) * 100)),
        currency: 'MYR',
        paymentInstructions: draft.paymentInstructions.trim() || null,
        paymentQrUrl: draft.paymentQrUrl,
        descriptionMd: draft.descriptionMd.trim() || null,
        rulesMd: draft.rulesMd.trim() || null,
        registrationFormSchema: form,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const next = draftFrom(res.data.tournament);
      setDraft(next);
      setBaseline(JSON.stringify(next));
      onFormChange?.(next.form);
      await onSaved(res.data.tournament);
      setNotice(
        res.data.playerLimitCapped != null
          ? `Saved. Player limit is ${res.data.playerLimitCapped}, the most your plan allows.`
          : 'Saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  if (loadState === 'forbidden') {
    return (
      <div className="ui-root rf" data-surface="desk">
        <p className="rf-note">Registration is managed by the event’s owner, admin or director.</p>
      </div>
    );
  }

  const feeLocked = !can.takePaidEntries && loadState === 'ready';
  const listLocked = !can.listPublicly && loadState === 'ready';

  return (
    <>
      <div className="ui-root rf" data-surface="desk">
        {loadState === 'offline' && (
          <p className="rf-note rf-note--warn" role="status">
            Setting up registration needs a connection. Showing what this device last saved.{' '}
            <button type="button" className="rf-linkbtn" onClick={() => void load()}>
              Try again
            </button>
          </p>
        )}

        <section className="ui-card rf-step" aria-labelledby="rf-step-form">
          <header className="rf-step__head">
            <span className="rf-step__n" aria-hidden="true">1</span>
            <div className="rf-step__title">
              <h3 id="rf-step-form">Form</h3>
              {!editing && <p>{formSummary(draft.form)}</p>}
            </div>
            <div className="rf-step__actions">
              <Button size="sm" onClick={() => setPreviewOpen(true)}>
                Preview
              </Button>
              <Button size="sm" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
                {editing ? 'Close editor' : 'Change form'}
              </Button>
            </div>
          </header>
          {editing && (
            <FormBuilder
              form={draft.form}
              answerCounts={answerCounts}
              onChange={(next) => set({ form: next })}
            />
          )}
        </section>

        <section className="ui-card rf-step" aria-labelledby="rf-step-limits">
          <header className="rf-step__head">
            <span className="rf-step__n" aria-hidden="true">2</span>
            <div className="rf-step__title">
              <h3 id="rf-step-limits">Deadline and player limit</h3>
            </div>
          </header>
          <div className="rf-pair">
            <Field
              label="Registration closes"
              hint="Your local time. Leave empty for no deadline."
              type="datetime-local"
              {...text('registrationDeadline')}
            />
            <Field
              label="Player limit"
              hint={
                can.maxPlayers != null
                  ? `Your plan allows up to ${can.maxPlayers}. Everyone on the roster counts. Once full, new entries go on the waitlist.`
                  : 'Everyone on the roster counts. Once full, new entries go on the waitlist. Leave empty for no limit.'
              }
              type="number"
              min={1}
              {...(can.maxPlayers != null ? { max: can.maxPlayers } : {})}
              inputMode="numeric"
              {...text('maxParticipants')}
            />
          </div>
        </section>

        <section className="ui-card rf-step" aria-labelledby="rf-step-share">
          <header className="rf-step__head">
            <span className="rf-step__n" aria-hidden="true">3</span>
            <div className="rf-step__title">
              <h3 id="rf-step-share">Open and share</h3>
            </div>
          </header>
          <label className="rf-check rf-check--lead">
            <input
              type="checkbox"
              checked={draft.registrationOpen}
              onChange={(e) => set({ registrationOpen: e.target.checked })}
            />
            <span>
              Accept entries
              <span className="rf-check__hint">Anyone with the link can register. No app or account needed.</span>
            </span>
          </label>
          <ShareLink link={link} eventName={tournamentName} live={baselineOpen} />
          <div className="rf-pair">
            <Field
              label="Link name"
              hint="Letters, numbers and hyphens. Empty makes one from the event name."
              {...text('publicSlug')}
            />
            <label className={`rf-check rf-check--inline${listLocked ? ' rf-check--locked' : ''}`}>
              <input
                type="checkbox"
                checked={draft.isPublishedGlobal}
                disabled={listLocked}
                onChange={(e) => set({ isPublishedGlobal: e.target.checked })}
              />
              <span>
                List on Find a tournament
                <span className="rf-check__hint">
                  {listLocked ? 'Needs a verified academy. The link above works without it.' : 'Optional. The link works either way.'}
                </span>
              </span>
            </label>
          </div>

          <details className="rf-details">
            <summary>Event details on the public page</summary>
            <div className="rf-pair">
              <Field label="Venue" optional {...text('venueName')} />
              <Field label="Address" optional {...text('venueAddress')} />
            </div>
            <div className="rf-triple">
              <Field label="City" optional {...text('city')} />
              <Field label="State" optional {...text('state')} />
              <Field label="Country" optional {...text('country')} />
            </div>
            <div className="rf-pair">
              <Field label="Latitude" optional type="number" step="any" {...text('latitude')} />
              <Field label="Longitude" optional type="number" step="any" {...text('longitude')} />
            </div>
            <Field label="Time control" optional {...text('timeControl')} />
            <Field label="Description" optional>
              {(control) => (
                <textarea
                  {...control}
                  rows={3}
                  maxLength={10000}
                  value={draft.descriptionMd}
                  onChange={(e) => set({ descriptionMd: e.target.value })}
                />
              )}
            </Field>
            <Field label="Rules" optional>
              {(control) => (
                <textarea
                  {...control}
                  rows={3}
                  maxLength={10000}
                  value={draft.rulesMd}
                  onChange={(e) => set({ rulesMd: e.target.value })}
                />
              )}
            </Field>
          </details>

          <details className="rf-details">
            <summary>Entry fee and payment</summary>
            {feeLocked && <p className="rf-note">Paid entries need a verified academy. Free events need nothing.</p>}
            <Field
              label="Entry fee (MYR)"
              type="number"
              min={0}
              step="0.01"
              disabled={feeLocked}
              {...text('entryFee')}
            />
            <Field label="Payment instructions" optional>
              {(control) => (
                <textarea
                  {...control}
                  rows={2}
                  maxLength={4000}
                  disabled={feeLocked}
                  value={draft.paymentInstructions}
                  onChange={(e) => set({ paymentInstructions: e.target.value })}
                />
              )}
            </Field>
            <Field label="Payment QR image" optional hint="Shown on the public page.">
              {(control) => (
                <input
                  {...control}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={feeLocked}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (typeof reader.result === 'string') set({ paymentQrUrl: reader.result });
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              )}
            </Field>
            {draft.paymentQrUrl && (
              <div className="rf-qr-current">
                <img src={draft.paymentQrUrl} alt="Current payment QR" />
                <Button size="sm" variant="quiet" onClick={() => set({ paymentQrUrl: null })}>
                  Remove QR
                </Button>
              </div>
            )}
          </details>
        </section>

        {(dirty || error || notice) && (
          <div className="rf-savebar">
            <span className="rf-savebar__state" role="status">
              {error ? <span className="rf-savebar__error">{error}</span> : dirty ? 'Unsaved changes' : notice}
            </span>
            {dirty && (
              <Button variant="primary" disabled={saving || loadState === 'offline'} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Outside the desk's styles, so the preview is the public page and nothing else. */}
      <Sheet
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Preview: what players see"
        variant="modal"
        className="rg-preview-sheet"
      >
        {previewOpen && <RegistrationPreview event={previewEvent} form={previewForm} categories={categories} />}
      </Sheet>
    </>
  );
}
