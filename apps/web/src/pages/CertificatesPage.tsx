import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import Papa from 'papaparse';
import { useAuth } from '../auth/AuthContext';
import {
  collectColumns,
  generateCertificateBatch,
  readTemplatePageSize,
  stampCertificate,
  type CertificateField,
  type CertificateLayout,
} from '@chess-alokas/certificates';
import {
  DEFAULT_CERT_EMAIL_BODY,
  DEFAULT_CERT_EMAIL_SUBJECT,
  DEFAULT_CERT_SERIAL_PAD,
  DEFAULT_CERT_SERIAL_PREFIX,
  certificateYear,
  formatCertificateSerial,
} from '@chess-alokas/shared';
import { db, nowIso, type LocalCertificateTemplate, type LocalTournament } from '../db/local';
import { MAX_PRIZE_PLACES, MIN_PRIZE_PLACES } from '../lib/prizePlaces';
import {
  apiIssueCertificates,
  apiListCertificates,
  apiReserveCertificateSerials,
} from '../api/client';
import CertificateDesignerCanvas from '../components/CertificateDesignerCanvas';
import { Surface } from '../ui/Surface';
import { Button, Field, IconDownload, IconSearch, PlayerName, buttonClass } from '../ui';
import { DesignerPanel, FONT_SIZE_MAX, FONT_SIZE_MIN } from './certificates/DesignerPanel';
import { EmailStep, emailedSummary } from './certificates/EmailStep';
import { PdfPreview } from './certificates/PdfPreview';
import { Steps, type StepInfo } from './certificates/Steps';
import { plural, type IssueLike, type PlayerInfo, type ReviewRow } from './certificates/reviewLogic';
import {
  buildTournamentRows,
  csvRows,
  issueFields,
  rowDetails,
  rowName,
  type CertMode,
  type CertRow,
} from './certificates/recipients';
import './certificates/certificates.css';

const STEP_KEYS = ['tournament', 'template', 'recipients', 'issue', 'email'] as const;
type StepKey = (typeof STEP_KEYS)[number];

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function downloadBlob(filename: string, data: Uint8Array, mime: string) {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const url = URL.createObjectURL(new Blob([copy], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Server and network errors in words an organizer can act on. */
function plainError(raw: string | undefined, what: string): string {
  const text = raw ?? '';
  if (/timed out|Failed to fetch|NetworkError|Not signed in|abort/i.test(text)) {
    return `Couldn't reach the server, so ${what}. Check your connection and try again.`;
  }
  if (/Tournament not found/i.test(text)) {
    return `The server doesn't have this tournament yet, so ${what}. Sync it first (Sync, top right), then try again.`;
  }
  return text ? `${text.replace(/\.$/, '')}. ${what[0]!.toUpperCase()}${what.slice(1)}.` : `Something went wrong, so ${what}.`;
}

const TYPE_OPTIONS: Array<{ mode: CertMode; title: string; text: string }> = [
  { mode: 'participation', title: 'Participation', text: 'One for every player in the tournament.' },
  { mode: 'winner', title: 'Winners', text: 'The top places, worked out from the standings.' },
  { mode: 'csv', title: 'From a CSV list', text: 'Any list with a name column, such as volunteers or arbiters.' },
];

export default function CertificatesPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tournamentId = searchParams.get('tournament') ?? '';
  const reservedSerialsRef = useRef<Map<string, string>>(new Map());
  /** Row ids seen before, so a newly added player can start ticked without re-ticking the unticked. */
  const knownRowIdsRef = useRef<Set<string>>(new Set());
  const ids = { search: useId(), csv: useId(), pdf: useId() };

  const tournaments = useLiveQuery(
    () =>
      db.tournaments
        .filter((t) => !t.deletedAt && (!user?.id || !t.ownerId || t.ownerId === user.id))
        .toArray()
        .then((list) => list.sort((a, b) => (b.date ?? b.updatedAt ?? '').localeCompare(a.date ?? a.updatedAt ?? ''))),
    [user?.id],
  );
  const tournament = useLiveQuery(() => (tournamentId ? db.tournaments.get(tournamentId) : undefined), [tournamentId]);
  const categories = useLiveQuery(
    () => (tournamentId ? db.categories.where('tournamentId').equals(tournamentId).filter((c) => !c.deletedAt).toArray() : []),
    [tournamentId],
  );
  const participants = useLiveQuery(
    () => (tournamentId ? db.participants.where('tournamentId').equals(tournamentId).filter((p) => !p.deletedAt).toArray() : []),
    [tournamentId],
  );
  const games = useLiveQuery(
    () => (tournamentId ? db.games.where('tournamentId').equals(tournamentId).filter((g) => !g.deletedAt).toArray() : []),
    [tournamentId],
  );
  const savedTemplates = useLiveQuery(
    () => db.certificateTemplates.toArray().then((all) => all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
    [],
  );

  const [step, setStep] = useState(tournamentId ? 1 : 0);
  const [mode, setMode] = useState<CertMode>('participation');
  const certType: 'participation' | 'winner' = mode === 'winner' ? 'winner' : 'participation';

  const [template, setTemplate] = useState<{ bytes: Uint8Array; name: string; savedId: string | null } | null>(null);
  const [layout, setLayout] = useState<CertificateLayout | null>(null);
  const [fields, setFields] = useState<CertificateField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [selectedColumn, setSelectedColumn] = useState('name');
  const [placeFontSize, setPlaceFontSize] = useState(22);
  const [templateNote, setTemplateNote] = useState<string | null>(null);

  const [rows, setRows] = useState<CertRow[]>([]);
  const [rowsProblem, setRowsProblem] = useState<string | null>(null);
  const [csvName, setCsvName] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [recipientQuery, setRecipientQuery] = useState('');

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [previewRowId, setPreviewRowId] = useState<string | null>(null);
  const [previewPdf, setPreviewPdf] = useState<Uint8Array | null>(null);

  const [subjectDraft, setSubjectDraft] = useState(DEFAULT_CERT_EMAIL_SUBJECT);
  const [bodyDraft, setBodyDraft] = useState(DEFAULT_CERT_EMAIL_BODY);
  const [prefixDraft, setPrefixDraft] = useState(DEFAULT_CERT_SERIAL_PREFIX);
  const [padDraft, setPadDraft] = useState(String(DEFAULT_CERT_SERIAL_PAD));
  const [issues, setIssues] = useState<IssueLike[]>([]);
  const [issuesError, setIssuesError] = useState<string | null>(null);

  /* ── Tournament ───────────────────────────────────────────────────────── */

  function chooseTournament(id: string) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('tournament', id);
    else next.delete('tournament');
    setSearchParams(next, { replace: true });
    if (mode === 'csv' && id) setMode('participation');
    setIssues([]);
    setError(null);
    setNotice(null);
  }

  useEffect(() => {
    if (!tournament) return;
    setSubjectDraft(tournament.certEmailSubject || DEFAULT_CERT_EMAIL_SUBJECT);
    setBodyDraft(tournament.certEmailBody || DEFAULT_CERT_EMAIL_BODY);
    setPrefixDraft(tournament.certSerialPrefix?.trim() || DEFAULT_CERT_SERIAL_PREFIX);
    setPadDraft(String(tournament.certSerialPad ?? DEFAULT_CERT_SERIAL_PAD));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament?.id]);

  const refreshIssues = useCallback(async () => {
    if (!tournamentId) {
      setIssues([]);
      return;
    }
    const listed = await apiListCertificates(tournamentId);
    if (listed.ok) {
      setIssues(listed.data.issues);
      setIssuesError(null);
    } else {
      setIssuesError(plainError(listed.error, "issued certificates can't be shown"));
    }
  }, [tournamentId]);
  useEffect(() => {
    void refreshIssues();
  }, [refreshIssues]);

  async function persistTournament(patch: Partial<LocalTournament>) {
    if (!tournamentId) return;
    await db.tournaments.update(tournamentId, { ...patch, updatedAt: nowIso(), dirty: 1 });
  }
  const saveEmailCopy = () =>
    persistTournament({
      certEmailSubject: subjectDraft.trim() || DEFAULT_CERT_EMAIL_SUBJECT,
      certEmailBody: bodyDraft.trim() || DEFAULT_CERT_EMAIL_BODY,
    });

  /* ── Recipients ───────────────────────────────────────────────────────── */

  useEffect(() => {
    reservedSerialsRef.current.clear();
  }, [tournamentId, mode]);

  useEffect(() => {
    if (mode === 'csv') return;
    if (!tournament || !participants || !categories || !games) {
      setRows([]);
      setRowsProblem(null);
      return;
    }
    const prefix = tournament.certSerialPrefix?.trim() || DEFAULT_CERT_SERIAL_PREFIX;
    const pad = tournament.certSerialPad ?? DEFAULT_CERT_SERIAL_PAD;
    const next = tournament.certSerialNext ?? 1;
    const year = certificateYear(tournament.date);
    let unreserved = 0;
    const built = buildTournamentRows({
      mode,
      tournament,
      participants,
      categories,
      games,
      serialFor: (id) => reservedSerialsRef.current.get(id) ?? formatCertificateSerial(prefix, next + unreserved++, pad, year),
    });
    setRows(built.rows);
    setRowsProblem(built.problem);
  }, [mode, tournament, participants, categories, games]);

  const rowIdsKey = rows.map((r) => r.id).join('|');
  useEffect(() => {
    const list = rowIdsKey ? rowIdsKey.split('|') : [];
    setSelectedIds((prev) => {
      // Keep what was unticked; anyone new (a late entry) starts ticked.
      const kept = list.filter((id) => prev.has(id));
      if (kept.length === 0) return new Set(list);
      return new Set([...kept, ...list.filter((id) => !prev.has(id) && !knownRowIdsRef.current.has(id))]);
    });
  }, [rowIdsKey]);

  useEffect(() => {
    knownRowIdsRef.current = new Set(rowIdsKey ? rowIdsKey.split('|') : []);
  }, [rowIdsKey]);

  const selectedRows = useMemo(() => rows.filter((r) => selectedIds.has(r.id)), [rows, selectedIds]);
  const shownRows = useMemo(() => {
    const q = recipientQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => [rowName(r), r.email ?? '', r.disambiguator ?? '', rowDetails(r)].some((v) => v.toLowerCase().includes(q)));
  }, [rows, recipientQuery]);
  const columns = useMemo(() => collectColumns(rows.map((r) => r.row)), [rows]);
  useEffect(() => {
    if (columns.length && !columns.includes(selectedColumn)) setSelectedColumn(columns.includes('name') ? 'name' : columns[0]!);
  }, [columns, selectedColumn]);
  const sample = (selectedRows[0] ?? rows[0])?.row;

  function onCsvFile(file: File) {
    setError(null);
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsed = csvRows(result.data, () => crypto.randomUUID());
        if (parsed.length === 0) {
          setError('That CSV has no rows. It needs a header row, then one row per person.');
          return;
        }
        setRows(parsed);
        setRowsProblem(null);
        setMode('csv');
        setCsvName(file.name);
        setNotice(`${plural(parsed.length, 'row')} loaded from ${file.name}.`);
      },
      error: (err) => setError(`That file couldn't be read as a CSV: ${err.message}`),
    });
  }

  /* ── Template ─────────────────────────────────────────────────────────── */

  async function loadTemplate(bytes: Uint8Array, name: string, savedId: string | null, savedLayout?: CertificateLayout) {
    setError(null);
    try {
      const size = await readTemplatePageSize(bytes);
      setTemplate({ bytes, name, savedId });
      setLayout({ pageWidth: size.pageWidth, pageHeight: size.pageHeight, fields: [] });
      setFields(savedLayout?.fields ?? []);
      setSelectedFieldId(null);
      setTemplateNote(null);
      setPreviewPdf(null);
    } catch (err) {
      setError(`That PDF couldn't be opened${err instanceof Error ? ` (${err.message})` : ''}. Try saving it again as a PDF.`);
    }
  }

  async function onTemplateFile(file: File) {
    if (file.type && file.type !== 'application/pdf') {
      setError('The template has to be a PDF. Export your design as PDF and upload that.');
      return;
    }
    await loadTemplate(new Uint8Array(await file.arrayBuffer()), file.name, null);
  }

  const savedForThis = (savedTemplates ?? []).filter(
    (t) => (t.tournamentId ?? '') === tournamentId && t.certType === certType,
  );
  const lastSaved: LocalCertificateTemplate | undefined = savedForThis[0];

  async function saveLayout() {
    if (!template || !layout) return;
    const id = template.savedId ?? crypto.randomUUID();
    await db.certificateTemplates.put({
      id,
      tournamentId: tournamentId || null,
      name: template.name,
      certType,
      pdfBase64: bytesToBase64(template.bytes),
      layoutJson: JSON.stringify({ ...layout, fields }),
      updatedAt: nowIso(),
      dirty: 1,
    });
    setTemplate({ ...template, savedId: id });
    setTemplateNote('Layout saved on this computer.');
  }

  function placeFieldAt(nx: number, ny: number, column = selectedColumn) {
    const id = crypto.randomUUID();
    setFields((prev) => [
      ...prev,
      {
        id,
        sourceColumn: column,
        x: Math.min(0.98, Math.max(0.02, nx)),
        y: Math.min(0.98, Math.max(0.02, ny)),
        width: 0.7,
        fontSize: placeFontSize,
        align: 'center',
        color: '#1a1208',
        font: 'Helvetica-Bold',
      },
    ]);
    setSelectedColumn(column);
    setSelectedFieldId(id);
    setPreviewPdf(null);
  }

  function setFieldFontSize(id: string, size: number) {
    const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size));
    setPlaceFontSize(next);
    setSelectedFieldId(id);
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, fontSize: next } : f)));
    setPreviewPdf(null);
  }

  function moveField(id: string, nx: number, ny: number) {
    setFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, x: Math.min(0.98, Math.max(0.02, nx)), y: Math.min(0.98, Math.max(0.02, ny)) } : f)),
    );
    setPreviewPdf(null);
  }

  /* ── Serials ──────────────────────────────────────────────────────────── */

  const padNumber = Math.min(8, Math.max(1, Number.parseInt(padDraft, 10) || DEFAULT_CERT_SERIAL_PAD));
  const serialPreview = formatCertificateSerial(
    prefixDraft,
    tournament?.certSerialNext ?? 1,
    padNumber,
    certificateYear(tournament?.date),
  );
  const saveSerials = () =>
    persistTournament({ certSerialPrefix: prefixDraft.trim() || DEFAULT_CERT_SERIAL_PREFIX, certSerialPad: padNumber });

  async function stampReservedSerials(source: CertRow[]): Promise<CertRow[]> {
    if (!tournamentId) return source;
    const unreserved = source.filter((r) => !reservedSerialsRef.current.has(r.id));
    if (unreserved.length > 0) {
      const reserved = await apiReserveCertificateSerials(tournamentId, unreserved.length);
      const serials =
        reserved.ok && reserved.data.serials.length === unreserved.length
          ? reserved.data.serials
          : // Offline, or a tournament the server hasn't seen: number them here from the settings.
            Array.from({ length: unreserved.length }, (_, i) =>
              formatCertificateSerial(
                tournament?.certSerialPrefix?.trim() || DEFAULT_CERT_SERIAL_PREFIX,
                (tournament?.certSerialNext ?? 1) + i,
                tournament?.certSerialPad ?? DEFAULT_CERT_SERIAL_PAD,
                certificateYear(tournament?.date),
              ),
            );
      unreserved.forEach((r, i) => reservedSerialsRef.current.set(r.id, serials[i]!));
      await persistTournament({ certSerialNext: (tournament?.certSerialNext ?? 1) + unreserved.length });
    }
    return source.map((r) => ({ ...r, row: { ...r.row, serial: reservedSerialsRef.current.get(r.id) ?? String(r.row.serial ?? '') } }));
  }

  /* ── Preview, issue, download ─────────────────────────────────────────── */

  const previewRow = rows.find((r) => r.id === previewRowId) ?? selectedRows[0] ?? null;
  const readyToMake = Boolean(template && layout && fields.length > 0 && selectedRows.length > 0);
  const makeBlocked = !template
    ? 'Upload a template first, in step 2.'
    : fields.length === 0
      ? 'Place at least one field on the template, in step 2.'
      : selectedRows.length === 0
        ? 'Choose at least one recipient, in step 3.'
        : null;

  async function drawPreview() {
    if (!template || !layout || !previewRow) return;
    try {
      setPreviewPdf(await stampCertificate(template.bytes, { ...layout, fields }, previewRow.row));
    } catch (err) {
      setError(`The preview couldn't be made${err instanceof Error ? `: ${err.message}` : ''}.`);
    }
  }

  async function exportPrint() {
    if (!readyToMake || !template || !layout) return;
    setBusy(`Making ${plural(selectedRows.length, 'certificate')} to print...`);
    setError(null);
    try {
      const stamped = await stampReservedSerials(selectedRows);
      const byId = new Map(stamped.map((r) => [r.id, r]));
      setRows((prev) => prev.map((r) => byId.get(r.id) ?? r));
      const batch = await generateCertificateBatch(
        template.bytes,
        { ...layout, fields },
        stamped.map((r) => ({ id: r.id, fileName: r.fileName, row: r.row })),
      );
      downloadBlob('certificates-print.pdf', batch.mergedPdf, 'application/pdf');
      downloadBlob('certificates.zip', batch.zipBytes, 'application/zip');
      setDownloaded(true);
      setNotice(`Downloaded ${plural(batch.individuals.length, 'certificate')}: one PDF to print, and a ZIP with a file for each person.`);
    } catch (err) {
      setError(`The print pack couldn't be made${err instanceof Error ? `: ${err.message}` : ''}.`);
    } finally {
      setBusy(null);
    }
  }

  async function issueOnline() {
    if (!readyToMake || !template || !layout || !tournamentId) return;
    setBusy(`Making ${plural(selectedRows.length, 'certificate')}...`);
    setError(null);
    setNotice(null);
    try {
      const stamped = await stampReservedSerials(selectedRows);
      const byId = new Map(stamped.map((r) => [r.id, r]));
      setRows((prev) => prev.map((r) => byId.get(r.id) ?? r));
      const batch = await generateCertificateBatch(
        template.bytes,
        { ...layout, fields },
        stamped.map((r) => ({ id: r.id, fileName: r.fileName, row: r.row })),
      );
      const items = batch.digital.map((d, i) => ({ ...issueFields(stamped[i]!, certType), pdfBase64: bytesToBase64(d.pdf) }));
      const res = await apiIssueCertificates(tournamentId, items, 5, (stored, total) =>
        setBusy(`Saving online: ${stored} of ${total} done...`),
      );
      if (!res.ok) {
        setError(plainError(res.error, 'not every certificate was issued'));
        return;
      }
      await refreshIssues();
      setNotice(
        `Issued ${plural(res.data.issued, 'certificate')}. Each has a serial number and is saved online${
          res.data.storageBackend === 'local' ? ' (on this server\'s disk)' : ''
        }. Players who are linked to an account can download theirs.`,
      );
    } catch (err) {
      setError(`The certificates couldn't be made${err instanceof Error ? `: ${err.message}` : ''}.`);
    } finally {
      setBusy(null);
    }
  }

  /* ── A new address for one player ─────────────────────────────────────── */

  const currentEmails = useMemo(
    () => new Map((participants ?? []).map((p) => [p.id, p.email ?? null])),
    [participants],
  );
  const reissueBlocked = !template || !layout || fields.length === 0
    ? 'load or design the template in step 2 first, so the certificate can be made again.'
    : null;

  /** One certificate again, for one player, with the address they have now and a new serial. */
  async function reissueOne(review: ReviewRow): Promise<string | null> {
    if (!template || !layout || !tournamentId) return 'Load the template in step 2 first.';
    const row = rows.find(
      (r) => r.participantId === review.participantId && (r.categoryId ?? null) === (review.categoryId ?? null),
    );
    if (!row) return `${review.name} isn't among this tournament's ${certType} recipients any more, so it can't be issued again here.`;
    // A new copy needs its own serial: serials are unique per tournament.
    reservedSerialsRef.current.delete(row.id);
    try {
      const [stamped] = await stampReservedSerials([row]);
      const batch = await generateCertificateBatch(template.bytes, { ...layout, fields }, [
        { id: stamped!.id, fileName: stamped!.fileName, row: stamped!.row },
      ]);
      const res = await apiIssueCertificates(tournamentId, [
        { ...issueFields(stamped!, certType), pdfBase64: bytesToBase64(batch.digital[0]!.pdf) },
      ]);
      if (!res.ok) return plainError(res.error, 'the certificate was not issued again');
      await refreshIssues();
      return null;
    } catch (err) {
      return `The certificate couldn't be made again${err instanceof Error ? `: ${err.message}` : ''}.`;
    }
  }

  /* ── Steps ────────────────────────────────────────────────────────────── */

  const issuedOfType = issues.filter((i) => i.type === certType);
  const emailed = emailedSummary(issues, certType);
  const players = useMemo(() => {
    const catName = new Map((categories ?? []).map((c) => [c.id, c.name]));
    return new Map<string, PlayerInfo>(
      (participants ?? []).map((p) => [
        p.id,
        { seed: p.seed, sections: (p.categoryIds ?? []).map((id) => catName.get(id)).filter(Boolean) as string[] },
      ]),
    );
  }, [participants, categories]);
  const categoryNames = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c.name])), [categories]);

  const typeTitle = TYPE_OPTIONS.find((o) => o.mode === mode)!.title;
  const steps: StepInfo[] = [
    {
      key: 'tournament',
      title: 'Tournament',
      summary: tournament ? `${tournament.name}, ${typeTitle.toLowerCase()}` : mode === 'csv' && csvName ? csvName : 'Not chosen',
      done: Boolean(tournament) || (mode === 'csv' && rows.length > 0),
    },
    {
      key: 'template',
      title: 'Template',
      summary: template ? `${plural(fields.length, 'field')} placed` : 'No template yet',
      done: Boolean(template && fields.length > 0),
    },
    {
      key: 'recipients',
      title: 'Recipients',
      summary: rows.length ? `${selectedRows.length} of ${rows.length} chosen` : 'None yet',
      done: selectedRows.length > 0,
    },
    {
      key: 'issue',
      title: 'Preview and issue',
      summary: emailed.total ? `${emailed.total} issued` : downloaded ? 'Downloaded' : 'Not issued yet',
      done: issuedOfType.length > 0 || downloaded,
    },
    {
      key: 'email',
      title: 'Email',
      summary: emailed.total ? `${emailed.sent} of ${emailed.total} sent` : 'Nothing sent yet',
      done: emailed.sent > 0,
    },
  ];
  const current: StepKey = STEP_KEYS[step]!;
  const go = (i: number) => {
    setStep(i);
    setError(null);
    setNotice(null);
    requestAnimationFrame(() => document.getElementById('cw-step-h')?.focus());
  };

  const STEP_HEAD: Record<StepKey, { title: string; lead: string }> = {
    tournament: {
      title: 'Choose the tournament',
      lead: 'Certificates take names, places and dates from the tournament. Then pick what kind to make.',
    },
    template: {
      title: 'Design the certificate',
      lead: 'Upload your certificate as a PDF, then put each detail where it belongs. What you see is what prints.',
    },
    recipients: {
      title: 'Choose who gets one',
      lead: 'Everyone ticked here is printed and issued. Untick anyone who shouldn\'t get a certificate.',
    },
    issue: {
      title: 'Check one, then issue',
      lead: 'Look at a finished certificate first. Then issue them online so they can be emailed, or download them to print.',
    },
    email: {
      title: 'Email certificates',
      lead: 'Check who gets one, untick anyone you don\'t want to send to, then send.',
    },
  };

  return (
    <Surface name="desk">
      <div className="cw">
        <header className="cw-head">
          <h1>Certificates</h1>
          <p>
            Make certificates for a tournament, print them, or email each player their own copy.
            {tournament && (
              <>
                {' '}
                For <Link to={`/tournaments/${tournament.id}`}>{tournament.name}</Link>.
              </>
            )}
          </p>
        </header>

        <Steps steps={steps} current={step} onGo={go} />

        <section className="cw-panel" aria-labelledby="cw-step-h">
          <div className="cw-panel__head">
            <p className="ui-label">
              Step {step + 1} of {steps.length}
            </p>
            <h2 id="cw-step-h" tabIndex={-1}>
              {STEP_HEAD[current].title}
            </h2>
            <p className="cw-lead">{STEP_HEAD[current].lead}</p>
          </div>

          {error && (
            <div className="cw-alert cw-alert--flag" role="alert">
              {error}
            </div>
          )}
          {notice && !error && (
            <div className="cw-alert cw-alert--go" role="status">
              {notice}
            </div>
          )}
          {busy && (
            <div className="cw-alert" role="status">
              {busy}
            </div>
          )}

          {current === 'tournament' && (
            <div className="cw-stack">
              {tournaments && tournaments.length === 0 ? (
                <div className="cw-empty">
                  <h3 className="cw-h3">No tournaments on this computer yet</h3>
                  <p>Create one first, or import a CSV list below to print certificates without a tournament.</p>
                  <Link className={buttonClass({ variant: 'primary' })} to="/tournaments/new">
                    New tournament
                  </Link>
                </div>
              ) : (
                <Field label="Tournament" hint="Your tournaments on this computer, newest first.">
                  {(c) => (
                    <select {...c} className={`${c.className} cw-input`} value={tournamentId} onChange={(e) => chooseTournament(e.target.value)}>
                      <option value="">Choose a tournament</option>
                      {(tournaments ?? []).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.date ? ` (${new Date(t.date).toLocaleDateString()})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}

              <fieldset className="cw-choice">
                <legend className="cw-h3">What kind of certificate?</legend>
                <div className="cw-choice__grid">
                  {TYPE_OPTIONS.map((o) => {
                    const off = o.mode !== 'csv' && !tournamentId;
                    return (
                      <label key={o.mode} className={`cw-option${mode === o.mode ? ' is-on' : ''}${off ? ' is-off' : ''}`}>
                        <input
                          type="radio"
                          name="cw-type"
                          value={o.mode}
                          checked={mode === o.mode}
                          disabled={off}
                          onChange={() => {
                            setMode(o.mode);
                            setPreviewPdf(null);
                            if (o.mode !== 'csv') setCsvName(null);
                          }}
                        />
                        <span className="cw-option__title">{o.title}</span>
                        <span className="cw-option__text">{off ? 'Choose a tournament first.' : o.text}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {mode === 'winner' && tournament && (
                <div className="cw-row-fields">
                  <Field
                    label="Places with a certificate"
                    hint={`From ${MIN_PRIZE_PLACES} to ${MAX_PRIZE_PLACES}. A section's own setting wins.`}
                    type="number"
                    inputMode="numeric"
                    min={MIN_PRIZE_PLACES}
                    max={MAX_PRIZE_PLACES}
                    defaultValue={tournament.prizePlaces ?? 3}
                    key={`places-${tournament.id}`}
                    onBlur={(e) => {
                      const v = Math.min(MAX_PRIZE_PLACES, Math.max(MIN_PRIZE_PLACES, Number.parseInt(e.target.value, 10) || 3));
                      e.target.value = String(v);
                      void persistTournament({ prizePlaces: v });
                    }}
                  />
                  <Field label="Places counted" hint="Per section gives each section its own winners.">
                    {(c) => (
                      <select
                        {...c}
                        className={`${c.className} cw-input`}
                        value={tournament.awardScope ?? 'per_category'}
                        onChange={(e) => void persistTournament({ awardScope: e.target.value as 'overall' | 'per_category' })}
                      >
                        <option value="per_category">Per section</option>
                        <option value="overall">Overall</option>
                      </select>
                    )}
                  </Field>
                </div>
              )}

              {mode === 'csv' && (
                <div className="cw-upload">
                  <label htmlFor={ids.csv} className={buttonClass({})}>
                    {csvName ? 'Choose another CSV' : 'Choose a CSV file'}
                  </label>
                  <input
                    id={ids.csv}
                    className="ui-vh"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onCsvFile(f);
                      e.target.value = '';
                    }}
                  />
                  <p className="cw-small">
                    First row: column names, including <code>name</code>. Add <code>email</code> to email them. A CSV list can be
                    printed without a tournament; issuing and email need one.
                  </p>
                </div>
              )}
            </div>
          )}

          {current === 'template' && (
            <div className="cw-stack">
              {!template ? (
                <div className="cw-empty cw-empty--upload">
                  <h3 className="cw-h3">Upload your certificate design</h3>
                  <p>A one-page PDF from Canva, Word or any design tool, with blank space where the names go.</p>
                  <div className="cw-actions">
                    <label htmlFor={ids.pdf} className={buttonClass({ variant: 'primary' })}>
                      Upload PDF
                    </label>
                    <input
                      id={ids.pdf}
                      className="ui-vh"
                      type="file"
                      accept="application/pdf"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void onTemplateFile(f);
                        e.target.value = '';
                      }}
                    />
                    {lastSaved && (
                      <Button
                        onClick={() =>
                          void loadTemplate(
                            base64ToBytes(lastSaved.pdfBase64),
                            lastSaved.name,
                            lastSaved.id,
                            JSON.parse(lastSaved.layoutJson) as CertificateLayout,
                          )
                        }
                      >
                        Use the layout saved {new Date(lastSaved.updatedAt).toLocaleDateString()}
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="cw-filebar">
                    <p>
                      <strong>{template.name}</strong>
                      {layout && (
                        <span className="cw-faint">
                          {' '}
                          {layout.pageWidth > layout.pageHeight ? 'Landscape' : 'Portrait'}, {Math.round(layout.pageWidth)} by{' '}
                          {Math.round(layout.pageHeight)} pt
                        </span>
                      )}
                    </p>
                    <div className="cw-actions">
                      <Button size="sm" onClick={() => void saveLayout()}>
                        Save layout
                      </Button>
                      <label htmlFor={ids.pdf} className={buttonClass({ size: 'sm', variant: 'quiet' })}>
                        Replace PDF
                      </label>
                      <input
                        id={ids.pdf}
                        className="ui-vh"
                        type="file"
                        accept="application/pdf"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void onTemplateFile(f);
                          e.target.value = '';
                        }}
                      />
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={() => {
                          setTemplate(null);
                          setLayout(null);
                          setFields([]);
                          setPreviewPdf(null);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                  {templateNote && (
                    <p className="cw-small ui-tone-go" role="status">
                      {templateNote}
                    </p>
                  )}
                  <div className="cw-designer">
                    <DesignerPanel
                      columns={columns}
                      sample={sample}
                      selectedColumn={selectedColumn}
                      onSelectColumn={setSelectedColumn}
                      fields={fields}
                      selectedFieldId={selectedFieldId}
                      onSelectField={setSelectedFieldId}
                      onRemoveField={(id) => {
                        setFields((prev) => prev.filter((f) => f.id !== id));
                        setSelectedFieldId((cur) => (cur === id ? null : cur));
                        setPreviewPdf(null);
                      }}
                      placeFontSize={placeFontSize}
                      onFontSize={(size) => {
                        const sel = fields.find((f) => f.id === selectedFieldId);
                        if (sel) setFieldFontSize(sel.id, size);
                        else setPlaceFontSize(size);
                      }}
                      onPlaceCentre={() => placeFieldAt(0.5, 0.5)}
                    />
                    {layout && (
                      <CertificateDesignerCanvas
                        templateBytes={template.bytes}
                        pageWidth={layout.pageWidth}
                        pageHeight={layout.pageHeight}
                        fields={fields}
                        sampleRow={sample}
                        selectedColumn={selectedColumn}
                        selectedFieldId={selectedFieldId}
                        placeFontSize={placeFontSize}
                        onPlace={placeFieldAt}
                        onMoveField={moveField}
                        onSelectColumn={setSelectedColumn}
                        onSelectField={setSelectedFieldId}
                        onFontSizeChange={setFieldFontSize}
                      />
                    )}
                  </div>
                </>
              )}

              {tournament && (
                <section className="ui-card cw-serials" aria-labelledby="cw-serials-h">
                  <h3 id="cw-serials-h" className="cw-h3">
                    Serial numbers
                  </h3>
                  <p className="cw-small">
                    Each certificate gets its own number, given out when you issue or download. Place the Serial field to print it.
                  </p>
                  <div className="cw-row-fields">
                    <Field label="Prefix" value={prefixDraft} maxLength={32} onChange={(e) => setPrefixDraft(e.target.value)} onBlur={() => void saveSerials()} />
                    <Field
                      label="Digits"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={8}
                      value={padDraft}
                      onChange={(e) => setPadDraft(e.target.value)}
                      onBlur={() => {
                        setPadDraft(String(padNumber));
                        void saveSerials();
                      }}
                    />
                    <div className="cw-serial-next">
                      <span className="ui-label">Next number</span>
                      <span className="ui-num">{serialPreview}</span>
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}

          {current === 'recipients' && (
            <div className="cw-stack">
              {rows.length === 0 ? (
                <div className="cw-empty">
                  <h3 className="cw-h3">No recipients yet</h3>
                  <p>
                    {rowsProblem ??
                      (tournament
                        ? 'This tournament has no players yet. Add players to the tournament first.'
                        : 'Choose a tournament in step 1, or import a CSV list there.')}
                  </p>
                  <Button onClick={() => go(0)}>Go to step 1</Button>
                </div>
              ) : (
                <>
                  {rowsProblem && <p className="cw-alert cw-alert--wait">{rowsProblem}</p>}
                  <div className="cw-review__tools">
                    <div className="cw-search">
                      <label htmlFor={ids.search} className="ui-vh">
                        Find a recipient
                      </label>
                      <IconSearch />
                      <input
                        id={ids.search}
                        className="ui-input cw-input"
                        type="search"
                        placeholder="Find a recipient"
                        value={recipientQuery}
                        onChange={(e) => setRecipientQuery(e.target.value)}
                      />
                    </div>
                    <p className="cw-review__line" aria-live="polite">
                      <strong>
                        {selectedRows.length} of {rows.length} chosen
                      </strong>
                    </p>
                    <div className="cw-review__bulk">
                      <Button size="sm" onClick={() => setSelectedIds(new Set(rows.map((r) => r.id)))}>
                        Select all
                      </Button>
                      <Button size="sm" variant="quiet" disabled={selectedRows.length === 0} onClick={() => setSelectedIds(new Set())}>
                        Select none
                      </Button>
                    </div>
                  </div>
                  <div className="cw-table-wrap">
                    <table className="cw-table cw-table--recipients">
                      <caption className="ui-vh">Recipients</caption>
                      <colgroup>
                        <col className="cw-col-check" />
                        <col className="cw-col-name" />
                        <col className="cw-col-email" />
                        <col className="cw-col-type" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th scope="col">
                            <span className="ui-vh">Chosen</span>
                          </th>
                          <th scope="col">Name</th>
                          <th scope="col">Email</th>
                          <th scope="col">{mode === 'winner' ? 'Section and place' : 'Section'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shownRows.map((r) => {
                          const on = selectedIds.has(r.id);
                          return (
                            <tr key={r.id} className={`cw-row${on ? ' is-on' : ''}`}>
                              <td className="cw-cell-check">
                                <input
                                  type="checkbox"
                                  className="cw-check"
                                  checked={on}
                                  aria-label={`Include ${rowName(r)}${r.disambiguator ? ` (${r.disambiguator})` : ''}`}
                                  onChange={() =>
                                    setSelectedIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(r.id)) next.delete(r.id);
                                      else next.add(r.id);
                                      return next;
                                    })
                                  }
                                />
                              </td>
                              <td className="cw-cell-name">
                                <PlayerName name={rowName(r)} disambiguator={r.disambiguator} />
                              </td>
                              <td className="cw-cell-email">
                                <span className="cw-label-sm" aria-hidden="true">
                                  Email
                                </span>
                                {r.email ? <span className="cw-email">{r.email}</span> : <span className="cw-faint">None</span>}
                              </td>
                              <td className="cw-cell-type">{rowDetails(r) || <span className="cw-faint">None</span>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {shownRows.length === 0 && <p className="cw-empty-row">No one matches "{recipientQuery}".</p>}
                  </div>
                </>
              )}
            </div>
          )}

          {current === 'issue' && (
            <div className="cw-stack">
              <div className="cw-issue">
                <section className="ui-card cw-issue__preview" aria-labelledby="cw-prev-h">
                  <h3 id="cw-prev-h" className="cw-h3">
                    Preview
                  </h3>
                  {makeBlocked && !previewPdf ? (
                    <p className="cw-small ui-tone-wait">{makeBlocked}</p>
                  ) : (
                    <>
                      <div className="cw-row-fields cw-row-fields--end">
                        <Field label="Show the certificate for">
                          {(c) => (
                            <select
                              {...c}
                              className={`${c.className} cw-input`}
                              value={previewRow?.id ?? ''}
                              onChange={(e) => {
                                setPreviewRowId(e.target.value);
                                setPreviewPdf(null);
                              }}
                            >
                              {selectedRows.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {rowName(r)}
                                  {r.disambiguator ? ` (${r.disambiguator})` : ''}
                                </option>
                              ))}
                            </select>
                          )}
                        </Field>
                        <Button onClick={() => void drawPreview()}>Show preview</Button>
                      </div>
                      <PdfPreview bytes={previewPdf} label={previewRow ? `Certificate for ${rowName(previewRow)}` : 'Certificate'} />
                    </>
                  )}
                </section>

                <div className="cw-issue__actions">
                  <section className="ui-card" aria-labelledby="cw-issue-h">
                    <h3 id="cw-issue-h" className="cw-h3">
                      Issue online
                    </h3>
                    <p className="cw-small">
                      Saves a PDF for each of the {plural(selectedRows.length, 'chosen player')} with a serial number, so you can
                      email them in step 5 and linked players can download theirs.
                    </p>
                    {issuedOfType.length > 0 && (
                      <p className="cw-small ui-tone-wait">
                        {plural(emailed.total, 'player')} already {emailed.total === 1 ? 'has' : 'have'} a {certType} certificate for
                        this tournament. Issuing again makes new copies with new numbers, and email sends the newest.
                      </p>
                    )}
                    <Button
                      variant="primary"
                      disabled={!readyToMake || !tournamentId || Boolean(busy)}
                      aria-describedby="cw-issue-why"
                      onClick={() => void issueOnline()}
                    >
                      Issue {plural(selectedRows.length, 'certificate')}
                    </Button>
                    {(makeBlocked || !tournamentId) && (
                      <p id="cw-issue-why" className="cw-small ui-tone-wait">
                        {makeBlocked ?? 'Issuing needs a tournament. Choose one in step 1, or download to print instead.'}
                      </p>
                    )}
                    {issuesError && <p className="cw-small ui-tone-wait">{issuesError}</p>}
                  </section>
                  <section className="ui-card" aria-labelledby="cw-print-h">
                    <h3 id="cw-print-h" className="cw-h3">
                      Download to print
                    </h3>
                    <p className="cw-small">One PDF with every certificate, and a ZIP with a file per person. Works offline.</p>
                    <Button disabled={!readyToMake || Boolean(busy)} aria-describedby="cw-print-why" onClick={() => void exportPrint()}>
                      <IconDownload /> Download {plural(selectedRows.length, 'certificate')}
                    </Button>
                    {makeBlocked && (
                      <p id="cw-print-why" className="cw-small ui-tone-wait">
                        {makeBlocked}
                      </p>
                    )}
                  </section>
                  {issuedOfType.length > 0 && (
                    <Button variant="quiet" onClick={() => go(4)}>
                      Next: email them
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {current === 'email' &&
            (!tournamentId || !tournament ? (
              <div className="cw-empty">
                <h3 className="cw-h3">Email needs a tournament</h3>
                <p>Certificates are emailed from a tournament, so the server can check who they go to.</p>
                <Button onClick={() => go(0)}>Go to step 1</Button>
              </div>
            ) : (
              <EmailStep
                tournamentId={tournamentId}
                tournamentName={tournament.name}
                certType={certType}
                issues={issues}
                refreshIssues={refreshIssues}
                players={players}
                categoryNames={categoryNames}
                subject={subjectDraft}
                body={bodyDraft}
                onSubject={setSubjectDraft}
                onBody={setBodyDraft}
                onSaveCopy={saveEmailCopy}
                ownEmail={user?.email ?? null}
                onGoToIssue={() => go(3)}
                currentEmails={currentEmails}
                onReissue={reissueOne}
                reissueBlocked={reissueBlocked}
              />
            ))}

          <nav className="cw-nav" aria-label="Step navigation">
            {step > 0 ? (
              <Button onClick={() => go(step - 1)}>Back: {steps[step - 1]!.title}</Button>
            ) : (
              <span />
            )}
            {step < steps.length - 1 && (
              <Button variant={steps[step]!.done && step < 3 ? 'primary' : 'default'} onClick={() => go(step + 1)}>
                Next: {steps[step + 1]!.title}
              </Button>
            )}
          </nav>
        </section>
      </div>
    </Surface>
  );
}
