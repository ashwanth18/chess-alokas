import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  certBodyToHtml,
  certTypeLabel,
  isSendableEmail,
  renderCertTemplate,
} from '@chess-alokas/shared';
import {
  apiCertificateEmailQuota,
  apiEmailCertificateTest,
  apiEmailCertificates,
  apiFetchCertificatePdf,
  type CertificateEmailQuota,
} from '../../api/client';
import { Button, Field, Marker, PlayerName, Sheet } from '../../ui';
import { EmailReview } from './EmailReview';
import { PdfPreview } from './PdfPreview';
import {
  OUTCOME_LABEL,
  buildReviewRows,
  outcomeCounts,
  outcomeLine,
  plural,
  summarize,
  tickReducer,
  type CertType,
  type IssueLike,
  type PlayerInfo,
  type ReviewRow,
  type SendOutcome,
} from './reviewLogic';

/** Sent in batches so a big list shows progress and one slow reply can't time out everything. */
const BATCH = 10;

const n = (x: number) => x.toLocaleString();

export function EmailStep({
  tournamentId,
  tournamentName,
  certType,
  issues,
  refreshIssues,
  players,
  categoryNames,
  subject,
  body,
  onSubject,
  onBody,
  onSaveCopy,
  ownEmail,
  onGoToIssue,
  currentEmails,
  onReissue,
  reissueBlocked,
}: {
  tournamentId: string;
  tournamentName: string;
  certType: CertType;
  issues: IssueLike[];
  refreshIssues: () => Promise<void>;
  players: Map<string, PlayerInfo>;
  categoryNames: Map<string, string>;
  subject: string;
  body: string;
  onSubject: (s: string) => void;
  onBody: (s: string) => void;
  onSaveCopy: () => Promise<void>;
  ownEmail: string | null;
  onGoToIssue: () => void;
  currentEmails: Map<string, string | null | undefined>;
  /** Issues this player's certificate again with their current address. Returns an error, or null. */
  onReissue: (row: ReviewRow) => Promise<string | null>;
  reissueBlocked: string | null;
}) {
  const rows = useMemo(
    () => buildReviewRows(issues, { type: certType, players, categoryNames, currentEmails }),
    [issues, certType, players, categoryNames, currentEmails],
  );
  // Ticks go back to the defaults whenever who-can-be-sent-what changes, such as after a send, but
  // anyone the organizer unticked stays unticked: a second Send must never reach them by surprise.
  const unticked = useRef<Set<string>>(new Set());
  const rowsKey = rows.map((r) => `${r.issueId}:${r.status}`).join('|');
  const [ticked, setTicked] = useState<Set<string>>(() => tickReducer(new Set(), { type: 'reset', rows }));
  useEffect(() => {
    setTicked(tickReducer(new Set(), { type: 'reset', rows, keepOut: unticked.current }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsKey]);
  const toggle = (id: string) =>
    setTicked((t) => {
      const next = tickReducer(t, { type: 'toggle', id, rows });
      if (next.has(id)) unticked.current.delete(id);
      else unticked.current.add(id);
      return next;
    });
  const setMany = (ids: string[], on: boolean) =>
    setTicked((t) => {
      for (const id of ids) {
        if (on) unticked.current.delete(id);
        else unticked.current.add(id);
      }
      return tickReducer(t, { type: 'set', ids, on, rows });
    });
  const summary = summarize(rows, ticked);

  const [quota, setQuota] = useState<CertificateEmailQuota | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const loadQuota = useCallback(async () => {
    setQuotaError(null);
    const res = await apiCertificateEmailQuota(tournamentId);
    if (res.ok) setQuota(res.data);
    else {
      setQuota(null);
      setQuotaError(res.error);
    }
  }, [tournamentId]);
  useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<SendOutcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [testTo, setTestTo] = useState(ownEmail ?? '');
  const [testMsg, setTestMsg] = useState<{ tone: 'go' | 'flag'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const firstTicked = rows.find((r) => ticked.has(r.issueId)) ?? rows[0] ?? null;
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewRow = rows.find((r) => r.issueId === previewId) ?? firstTicked;
  const [pdf, setPdf] = useState<{ id: string; bytes: Uint8Array | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!previewRow) return;
    let cancelled = false;
    setPdf({ id: previewRow.issueId, bytes: null, error: null });
    void apiFetchCertificatePdf(previewRow.issueId).then((res) => {
      if (cancelled) return;
      setPdf({ id: previewRow.issueId, bytes: res.ok ? res.data : null, error: res.ok ? null : res.error });
    });
    return () => {
      cancelled = true;
    };
  }, [previewRow?.issueId]);

  const vars = {
    playerName: previewRow?.name ?? 'Player name',
    tournament: tournamentName,
    certType: certTypeLabel(certType),
    serial: previewRow?.serial ?? 'CERT/001/2026',
  };
  const previewSubject = renderCertTemplate(subject, vars);
  const previewHtml = certBodyToHtml(renderCertTemplate(body, vars));

  const sending = progress !== null;

  /** Why Send is off, in words. Null when it's on. */
  function blockedBecause(count: number): string | null {
    if (sending) return null;
    if (count === 0) return 'Tick at least one player to send.';
    if (quotaError) return `Can't check today's email limit: ${quotaError}. Nothing can be sent until the server answers.`;
    if (!quota) return "Checking today's email limit...";
    if (quota.demo) return null;
    if (!quota.emailConfigured) return "Email isn't set up on this server yet, so nothing can be sent. Contact support.";
    if (!quota.canSend) return quota.reason ?? 'Email is not available for this tournament.';
    if (quota.remaining !== null && count > quota.remaining) {
      return `Only ${n(quota.remaining)} emails are left today. Untick ${n(count - quota.remaining)}, or send the rest tomorrow.`;
    }
    return null;
  }
  const blocked = blockedBecause(summary.willSend);

  const [reissuing, setReissuing] = useState<string | null>(null);
  async function reissueToNewAddress(row: ReviewRow) {
    if (reissuing) return;
    setReissuing(row.issueId);
    setError(null);
    const problem = await onReissue(row);
    setReissuing(null);
    if (problem) setError(problem);
  }

  /** Set synchronously, so a double click can't start a second send before React re-renders. */
  const sendingRef = useRef(false);

  async function send(ids: string[]) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setConfirmIds(null);
    setError(null);
    setOutcomes(null);
    setProgress({ done: 0, total: ids.length });
    // Saving the message locally must never leave the send locked; the server gets it in the body anyway.
    await onSaveCopy().catch(() => undefined);
    const byId = new Map(rows.map((r) => [r.issueId, r]));
    const done: SendOutcome[] = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const res = await apiEmailCertificates(tournamentId, {
        issueIds: chunk,
        resend: chunk.some((id) => ['sent', 'sending'].includes(byId.get(id)?.status ?? '')),
        subject,
        body,
      });
      if (!res.ok) {
        // Stop here: the rest weren't tried, and saying so is better than guessing.
        for (const id of ids.slice(i)) {
          const r = byId.get(id);
          done.push({ issueId: id, name: r?.name ?? '', email: r?.email ?? null, status: 'skipped', error: `Not tried: ${res.error}` });
        }
        setError(`Sending stopped: ${res.error}`);
        break;
      }
      for (const r of res.data.results) {
        done.push({ issueId: r.id, name: r.name, email: r.email, status: r.status, error: r.error });
      }
      setProgress({ done: Math.min(ids.length, i + chunk.length), total: ids.length });
    }
    // Failures first: they are what needs a person.
    const rank = { failed: 0, skipped: 1, simulated: 2, emailed: 3 } as const;
    setOutcomes([...done].sort((x, y) => rank[x.status] - rank[y.status]));
    setProgress(null);
    await Promise.all([refreshIssues(), loadQuota()]);
    sendingRef.current = false;
  }

  async function sendTest() {
    setTestMsg(null);
    if (!isSendableEmail(testTo)) {
      setTestMsg({ tone: 'flag', text: 'Enter a full email address for the test.' });
      return;
    }
    setTesting(true);
    await onSaveCopy();
    const res = await apiEmailCertificateTest(tournamentId, {
      to: testTo.trim(),
      subject,
      body,
      issueId: previewRow?.issueId,
    });
    setTesting(false);
    if (!res.ok) setTestMsg({ tone: 'flag', text: `Test not sent: ${res.error}` });
    else if (res.data.simulated) setTestMsg({ tone: 'go', text: res.data.message ?? 'Demo: no email was sent.' });
    else
      setTestMsg({
        tone: 'go',
        text: `Test sent to ${res.data.to}${res.data.attachedPdf ? ', with a certificate attached' : ''}.`,
      });
  }

  if (rows.length === 0) {
    return (
      <div className="cw-empty">
        <h3 className="cw-h3">Nothing to email yet</h3>
        <p>
          Email sends certificates that have been issued online. No {certTypeLabel(certType)} certificates are
          issued for this tournament yet.
        </p>
        <Button variant="primary" onClick={onGoToIssue}>
          Go to step 4, Issue
        </Button>
      </div>
    );
  }

  const failedIds = outcomes?.filter((o) => o.status === 'failed').map((o) => o.issueId) ?? [];
  const counts = outcomes ? outcomeCounts(outcomes) : null;
  const confirmRows = confirmIds ? rows.filter((r) => confirmIds.includes(r.issueId)) : [];
  const confirmSummary = confirmIds ? summarize(rows, new Set(confirmIds)) : null;
  const confirmBlocked = confirmIds ? blockedBecause(confirmIds.length) : null;

  return (
    <div className="cw-email">
      {outcomes && counts && (
        <section className="ui-card cw-results" aria-labelledby="cw-results-h">
          <div className="cw-results__head">
            <h3 id="cw-results-h" className="cw-h3">
              Last send
            </h3>
            <p role="status" className={counts.failed ? 'ui-tone-wait' : 'ui-tone-go'}>
              {outcomeLine(outcomes)}
            </p>
          </div>
          <div className="cw-table-wrap">
            <table className="cw-table cw-table--results">
              <caption className="ui-vh">Result for each recipient</caption>
              <colgroup>
                <col className="cw-col-name" />
                <col className="cw-col-email" />
                <col className="cw-col-status" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Email</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {outcomes.map((o) => {
                  const row = rows.find((r) => r.issueId === o.issueId);
                  return (
                    <tr key={o.issueId} className="cw-row" data-outcome={o.status}>
                      <td className="cw-cell-name">
                        <PlayerName name={o.name || row?.name || ''} disambiguator={row?.disambiguator} />
                      </td>
                      <td className="cw-cell-email">
                        <span className="cw-email">{o.email ?? 'None'}</span>
                      </td>
                      <td className="cw-cell-status">
                        <span
                          className={`cw-status ui-tone-${o.status === 'emailed' ? 'go' : o.status === 'failed' ? 'flag' : 'plain'}`}
                        >
                          <Marker hollow={o.status !== 'emailed'} />
                          {OUTCOME_LABEL[o.status]}
                        </span>
                        {o.error && <span className="cw-small">{o.error}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="cw-actions">
            {failedIds.length > 0 && (
              <Button variant="primary" onClick={() => setConfirmIds(failedIds)}>
                Retry {plural(failedIds.length, 'failed email')}
              </Button>
            )}
            <Button variant="quiet" onClick={() => setOutcomes(null)}>
              Close results
            </Button>
          </div>
        </section>
      )}

      <div className="cw-email__top">
        <section className="ui-card cw-message" aria-labelledby="cw-message-h">
          <h3 id="cw-message-h" className="cw-h3">
            Message
          </h3>
          <Field label="Subject" value={subject} onChange={(e) => onSubject(e.target.value)} onBlur={() => void onSaveCopy()} />
          <Field
            label="Body"
            hint={
              <>
                Each player's details go in where you write <code>{'{{playerName}}'}</code>,{' '}
                <code>{'{{tournament}}'}</code>, <code>{'{{certType}}'}</code> or <code>{'{{serial}}'}</code>. Their
                certificate is attached as a PDF.
              </>
            }
          >
            {(c) => (
              <textarea {...c} className={`${c.className} cw-body`} rows={8} value={body} onChange={(e) => onBody(e.target.value)} onBlur={() => void onSaveCopy()} />
            )}
          </Field>
          <div className="cw-test">
            <Field
              label="Send a test first"
              optional
              hint="Goes to your own sign-in address, marked TEST."
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
            <Button disabled={testing || sending} onClick={() => void sendTest()}>
              {testing ? 'Sending test...' : 'Send test'}
            </Button>
          </div>
          {testMsg && (
            <p role="status" className={`cw-small ui-tone-${testMsg.tone}`}>
              {testMsg.text}
            </p>
          )}
        </section>

        <section className="ui-card cw-look" aria-labelledby="cw-look-h">
          <div className="cw-look__head">
            <h3 id="cw-look-h" className="cw-h3">
              What they get
            </h3>
            <label className="cw-inline-field">
              <span>Preview for</span>
              <select
                className="ui-input cw-input"
                value={previewRow?.issueId ?? ''}
                onChange={(e) => setPreviewId(e.target.value)}
              >
                {rows.map((r) => (
                  <option key={r.issueId} value={r.issueId}>
                    {r.name}
                    {r.disambiguator ? ` (${r.disambiguator})` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="cw-mail" aria-label="Email preview">
            <p className="cw-mail__meta">
              <span className="cw-faint">To</span> {previewRow?.email ?? 'No address'}
            </p>
            <p className="cw-mail__meta">
              <span className="cw-faint">Subject</span> <strong>{previewSubject}</strong>
            </p>
            <div className="cw-mail__body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
          {pdf?.error ? (
            <p className="cw-small ui-tone-wait">Can't show the attached certificate: {pdf.error}</p>
          ) : (
            <PdfPreview bytes={pdf?.bytes ?? null} label={`Attached: ${previewRow?.name ?? ''}.pdf`} />
          )}
        </section>
      </div>

      <section className="cw-who" aria-labelledby="cw-who-h">
        <h3 id="cw-who-h" className="cw-h3">
          Who gets it
        </h3>
        <p className="cw-small">
          Ticked players get their own certificate. Players already sent one, or with no usable address, start unticked.
        </p>
        <EmailReview
          rows={rows}
          ticked={ticked}
          disabled={sending}
          onToggle={toggle}
          onSetMany={setMany}
          onUseNewAddress={(row) => void reissueToNewAddress(row)}
          reissueBlocked={reissueBlocked}
          reissuing={reissuing}
        />
      </section>

      <div className="cw-sendbar" role="region" aria-label="Send">
        <div className="cw-sendbar__text">
          <p>
            <strong>{plural(summary.willSend, 'email')}</strong> ready to send
          </p>
          <p className="cw-small" data-testid="quota-line">
            {quotaError
              ? `Email limit unknown: ${quotaError}`
              : !quota
                ? "Checking today's email limit..."
                : quota.demo
                  ? 'Demo tournament: nothing will really be sent.'
                  : quota.limit === null
                    ? 'No daily limit on this computer.'
                    : `${n(quota.remaining ?? 0)} of ${n(quota.limit)} emails left today.`}
            {quotaError && (
              <>
                {' '}
                <button type="button" className="cw-link" onClick={() => void loadQuota()}>
                  Try again
                </button>
              </>
            )}
          </p>
          {progress && (
            <p role="status" className="cw-small">
              Sending: {progress.done} of {progress.total} done. Keep this page open.
            </p>
          )}
          {blocked && (
            <p className="cw-small ui-tone-wait" id="cw-send-why">
              {blocked}
            </p>
          )}
          {error && (
            <p role="alert" className="cw-small ui-tone-flag">
              {error}
            </p>
          )}
        </div>
        <Button
          variant="primary"
          size="lg"
          disabled={Boolean(blocked) || sending}
          aria-describedby={blocked ? 'cw-send-why' : undefined}
          onClick={() => setConfirmIds(rows.filter((r) => ticked.has(r.issueId) && r.selectable).map((r) => r.issueId))}
        >
          {sending ? 'Sending...' : `Send ${plural(summary.willSend, 'email')}`}
        </Button>
      </div>

      <Sheet
        open={confirmIds !== null}
        onClose={() => setConfirmIds(null)}
        variant="modal"
        title={confirmIds ? `Send ${plural(confirmIds.length, 'email')} now?` : ''}
      >
        {confirmSummary && confirmIds && (
          <div className="cw-confirm">
            <ul className="cw-confirm__list">
              <li>
                {plural(confirmIds.length, 'player')} each get their own {certTypeLabel(certType)} certificate as a PDF
                {confirmSummary.addresses !== confirmIds.length
                  ? `, at ${plural(confirmSummary.addresses, 'address', 'addresses')} (some share one)`
                  : ''}
                .
              </li>
              {confirmSummary.resends > 0 && (
                <li className="ui-tone-wait">{plural(confirmSummary.resends, 'player')} were sent one before and will get it again.</li>
              )}
              {quota && !quota.demo && quota.remaining !== null && (
                <li>
                  This uses {n(confirmIds.length)} of the {n(quota.remaining)} emails left today.
                </li>
              )}
              {quota?.demo && <li>This is a demo tournament, so nothing will really be sent.</li>}
              <li>Sent emails can't be called back.</li>
            </ul>
            {confirmRows.length <= 5 && (
              <p className="cw-small">To: {confirmRows.map((r) => r.name).join(', ')}.</p>
            )}
            {confirmBlocked && <p className="cw-small ui-tone-wait">{confirmBlocked}</p>}
            <div className="cw-actions cw-actions--end">
              <Button variant="quiet" onClick={() => setConfirmIds(null)}>
                Go back
              </Button>
              <Button variant="primary" disabled={Boolean(confirmBlocked) || sending} onClick={() => void send(confirmIds)}>
                Send {plural(confirmIds.length, 'email')}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/** Kept small for the stepper: how many of this type have been emailed. */
export function emailedSummary(issues: IssueLike[], certType: CertType): { sent: number; total: number } {
  const rows = buildReviewRows(issues, { type: certType });
  return { sent: rows.filter((r) => r.status === 'sent').length, total: rows.length };
}
