import { useEffect, useMemo, useState } from 'react';
import {
  AGE_PROOF_FIELD,
  type RegistrationFormConfig,
  type TournamentRegistration,
} from '@chess-alokas/shared';
import {
  apiDeleteRegistrationAgeProofs,
  apiFetchRegistrationFile,
  apiFetchRegistrationReceipt,
  apiRevealRegistrationNric,
} from '../../api/client';
import { needsPaymentConfirmation } from '../../lib/registrationReview';
import { Button, IconDownload, Sheet } from '../../ui';
import { answerText, entriesCsv, entrySource, questionLabel } from './formLogic';

type Filter = 'all' | 'pending' | 'approved' | 'waitlisted' | 'rejected';
const FILTERS: Filter[] = ['all', 'pending', 'approved', 'waitlisted', 'rejected'];

const STATUS_WORD: Record<TournamentRegistration['status'], string> = {
  pending: 'Pending',
  approved: 'Approved',
  waitlisted: 'Waitlisted',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const PAYMENT_WORD: Record<TournamentRegistration['paymentStatus'], string> = {
  not_required: 'Free',
  pending_receipt: 'No receipt yet',
  submitted: 'Receipt uploaded',
  verified: 'Payment verified',
  refunded: 'Refunded',
};

interface Viewing {
  title: string;
  url: string;
  isPdf: boolean;
}

function NricCell({
  tournamentId,
  registrationId,
  masked,
}: {
  tournamentId: string;
  registrationId: string;
  masked: string;
}) {
  const [full, setFull] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className="rf-nric">
      <span className="rf-nric__value">{full ?? masked}</span>
      <Button
        size="sm"
        variant="quiet"
        aria-label={full ? 'Hide NRIC number' : 'Show NRIC number'}
        onClick={async () => {
          if (full) {
            setFull(null);
            return;
          }
          setFailed(null);
          const res = await apiRevealRegistrationNric(tournamentId, registrationId);
          if (res.ok) setFull(res.data.nricNumber);
          else setFailed(res.error);
        }}
      >
        {full ? 'Hide' : 'Show'}
      </Button>
      {failed && <span className="rf-note rf-note--warn">{failed}</span>}
    </span>
  );
}

export function EntryQueue({
  tournamentId,
  tournamentName,
  registrations,
  form,
  categoryNames,
  entryFeeCents,
  duplicates,
  busyId,
  onRefresh,
  onApprove,
  onApproveAll,
  onWaitlist,
  onReject,
}: {
  tournamentId: string;
  tournamentName: string;
  registrations: TournamentRegistration[];
  /** The full form, hidden questions included, so old answers keep their labels. */
  form: RegistrationFormConfig | null;
  categoryNames: Record<string, string>;
  entryFeeCents: number | null | undefined;
  duplicates: Map<string, string>;
  busyId: string | null;
  onRefresh: () => void | Promise<void>;
  onApprove: (reg: TournamentRegistration) => void;
  onApproveAll: () => void;
  onWaitlist: (reg: TournamentRegistration) => void;
  onReject: (reg: TournamentRegistration) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(
    () => () => {
      if (viewing) URL.revokeObjectURL(viewing.url);
    },
    [viewing],
  );

  const shown = registrations.filter((r) => filter === 'all' || r.status === filter);
  const pending = registrations.filter((r) => r.status === 'pending').length;
  const privateCounts = useMemo(
    () => ({
      files: registrations.reduce(
        (n, r) => n + (r.files ?? []).filter((f) => f.field === AGE_PROOF_FIELD).length,
        0,
      ),
      nric: registrations.filter((r) => r.nricMasked).length,
    }),
    [registrations],
  );

  async function open(title: string, load: () => ReturnType<typeof apiFetchRegistrationFile>) {
    setError(null);
    const res = await load();
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setViewing({ title, url: URL.createObjectURL(res.blob), isPdf: res.blob.type === 'application/pdf' });
  }

  async function deleteAgeProofs() {
    setDeleting(true);
    setError(null);
    setNotice(null);
    const res = await apiDeleteRegistrationAgeProofs(tournamentId);
    setDeleting(false);
    setConfirmDelete(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onRefresh();
    setNotice(
      res.data.failed > 0
        ? `Deleted ${res.data.files} files and ${res.data.nricNumbers} NRIC numbers. ${res.data.failed} files could not be removed. Press the button again.`
        : `Deleted ${res.data.files} files and ${res.data.nricNumbers} NRIC numbers.`,
    );
  }

  function downloadCsv() {
    const blob = new Blob([`﻿${entriesCsv(registrations, form, categoryNames)}`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tournamentName.replace(/[^\w-]+/g, '-')}-entries.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="ui-root rf" data-surface="desk">
      <section className="ui-card rf-step" aria-labelledby="rf-step-entries">
        <header className="rf-step__head">
          <span className="rf-step__n" aria-hidden="true">4</span>
          <div className="rf-step__title">
            <h3 id="rf-step-entries">Entries ({registrations.length})</h3>
            <p>Approving adds the player to the roster.</p>
          </div>
          <div className="rf-step__actions">
            <Button size="sm" variant="quiet" onClick={() => void onRefresh()}>
              Refresh
            </Button>
            {registrations.length > 0 && (
              <Button size="sm" variant="quiet" onClick={downloadCsv}>
                <IconDownload /> Download CSV
              </Button>
            )}
            {pending > 0 && (
              <Button size="sm" variant="primary" disabled={busyId !== null} onClick={onApproveAll}>
                {busyId === '__batch__' ? 'Approving…' : `Approve all pending (${pending})`}
              </Button>
            )}
          </div>
        </header>

        {error && <p className="rf-note rf-note--warn" role="alert">{error}</p>}
        {notice && <p className="rf-note" role="status">{notice}</p>}

        {registrations.length > 0 && (
          <div className="rf-filters" role="group" aria-label="Filter entries">
            {FILTERS.map((st) => (
              <button
                key={st}
                type="button"
                className={`rf-filter${filter === st ? ' is-on' : ''}`}
                aria-pressed={filter === st}
                onClick={() => setFilter(st)}
              >
                {st === 'all' ? 'All' : STATUS_WORD[st]} (
                {st === 'all' ? registrations.length : registrations.filter((r) => r.status === st).length})
              </button>
            ))}
          </div>
        )}

        {registrations.length === 0 ? (
          <p className="rf-note">No entries yet. Accept entries above and share the link.</p>
        ) : (
          <ul className="rf-entries">
            {shown.map((r) => {
              const snap = r.playerSnapshot;
              const answers = Object.entries(r.customAnswers ?? {});
              const files = r.files ?? [];
              const category = r.selectedCategoryId ? categoryNames[r.selectedCategoryId] : null;
              return (
                <li key={r.id} className="rf-entry">
                  <div className="rf-entry__who">
                    <strong className="rf-entry__name">{snap.name}</strong>
                    <span className={`rf-status rf-status--${r.status}`}>{STATUS_WORD[r.status]}</span>
                    <span className="rf-entry__source">{entrySource(r)}</span>
                    {duplicates.has(r.id) && (
                      <p className="rf-note rf-note--warn">Possible duplicate: {duplicates.get(r.id)}</p>
                    )}
                    <p className="rf-entry__meta">
                      {[
                        snap.yearOfBirth ? `Born ${snap.yearOfBirth}` : null,
                        snap.gender,
                        category ?? 'Category: automatic',
                        snap.rating ? `Rating ${snap.rating}` : null,
                        snap.fideId ? `FIDE ${snap.fideId}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="rf-entry__meta">
                      {[snap.school, snap.club, snap.email, snap.phone].filter(Boolean).join(' · ')}
                    </p>
                  </div>

                  <dl className="rf-entry__facts">
                    {r.nricMasked && (
                      <div>
                        <dt>NRIC</dt>
                        <dd>
                          <NricCell tournamentId={tournamentId} registrationId={r.id} masked={r.nricMasked} />
                        </dd>
                      </div>
                    )}
                    {answers.map(([field, value]) => (
                      <div key={field}>
                        <dt>{questionLabel(form, field)}</dt>
                        <dd>{answerText(value)}</dd>
                      </div>
                    ))}
                    {files.map((f) => (
                      <div key={f.id}>
                        <dt>{questionLabel(form, f.field)}</dt>
                        <dd>
                          <Button
                            size="sm"
                            variant="quiet"
                            onClick={() =>
                              void open(`${questionLabel(form, f.field)}: ${snap.name}`, () =>
                                apiFetchRegistrationFile(tournamentId, r.id, f.id),
                              )
                            }
                          >
                            View file
                          </Button>
                        </dd>
                      </div>
                    ))}
                    {r.paymentStatus !== 'not_required' && (
                      <div>
                        <dt>Payment</dt>
                        <dd>
                          {PAYMENT_WORD[r.paymentStatus]}
                          {r.status !== 'approved' && needsPaymentConfirmation(r, entryFeeCents) && (
                            <span className="rf-note rf-note--warn"> No receipt uploaded</span>
                          )}
                          {r.hasReceipt && (
                            <Button
                              size="sm"
                              variant="quiet"
                              onClick={() =>
                                void open(`Payment receipt: ${snap.name}`, () =>
                                  apiFetchRegistrationReceipt(tournamentId, r.id),
                                )
                              }
                            >
                              View receipt
                            </Button>
                          )}
                        </dd>
                      </div>
                    )}
                  </dl>

                  <div className="rf-entry__actions">
                    {r.status !== 'approved' && (
                      <Button size="sm" variant="primary" disabled={busyId !== null} onClick={() => onApprove(r)}>
                        Approve
                      </Button>
                    )}
                    {r.status !== 'waitlisted' && r.status !== 'approved' && (
                      <Button size="sm" disabled={busyId !== null} onClick={() => onWaitlist(r)}>
                        Waitlist
                      </Button>
                    )}
                    {r.status !== 'rejected' && (
                      <Button size="sm" variant="quiet" disabled={busyId !== null} onClick={() => onReject(r)}>
                        Reject
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {(privateCounts.files > 0 || privateCounts.nric > 0) && (
          <div className="rf-danger">
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete age proofs for this event
            </Button>
          </div>
        )}
      </section>

      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete age proofs for this event?"
        variant="modal"
      >
        <p>
          This removes {privateCounts.files} age proof {privateCounts.files === 1 ? 'file' : 'files'} and{' '}
          {privateCounts.nric} NRIC {privateCounts.nric === 1 ? 'number' : 'numbers'}. It can’t be undone.
        </p>
        <p className="rf-note">Payment receipts, answers and other uploads stay.</p>
        <div className="rf-sheet-actions">
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" disabled={deleting} onClick={() => void deleteAgeProofs()}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Sheet>

      <Sheet open={viewing !== null} onClose={() => setViewing(null)} title={viewing?.title ?? 'File'} variant="modal">
        {viewing &&
          (viewing.isPdf ? (
            <a className="ui-btn" href={viewing.url} download="registration-file.pdf">
              <IconDownload /> Download PDF
            </a>
          ) : (
            <img className="rf-viewer" src={viewing.url} alt={viewing.title} />
          ))}
      </Sheet>
    </div>
  );
}
