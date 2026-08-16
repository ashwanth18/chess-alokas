import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import Papa from 'papaparse';
import { computeStandings, computeSectionStandings } from '@chess-alokas/pairing-engine';
import {
  collectColumns,
  generateCertificateBatch,
  participantToRow,
  readTemplatePageSize,
  winnerToRow,
  winnersFromStandings,
  type CertificateField,
  type CertificateLayout,
  type CertificateRow,
} from '@chess-alokas/certificates';
import type { GameResult } from '@chess-alokas/shared';
import {
  DEFAULT_CERT_EMAIL_BODY,
  DEFAULT_CERT_EMAIL_SUBJECT,
  DEFAULT_CERT_SERIAL_PAD,
  DEFAULT_CERT_SERIAL_PREFIX,
  certBodyToHtml,
  certificateYear,
  certTypeLabel,
  formatCertificateSerial,
  renderCertTemplate,
} from '@chess-alokas/shared';
import { db, nowIso, type LocalTournament } from '../db/local';
import NumberField from '../components/NumberField';
import {
  certificateColumnLabel,
  certificateColumnSample,
} from '../lib/certificateColumns';
import {
  MIN_PRIZE_PLACES,
  MAX_PRIZE_PLACES,
} from '../lib/prizePlaces';
import {
  apiIssueCertificates,
  apiEmailCertificates,
  apiEmailCertificateTest,
  apiListCertificates,
  apiReserveCertificateSerials,
} from '../api/client';
import { isMixedTournament } from '../lib/tournamentProgress';
import CertificateDesignerCanvas from '../components/CertificateDesignerCanvas';

type CertMode = 'participation' | 'winner' | 'csv';

type CertRow = { id: string; fileName: string; row: CertificateRow; email?: string };

type ListedIssue = {
  id: string;
  tournamentId: string;
  participantId?: string | null;
  categoryId?: string | null;
  recipientName: string;
  recipientEmail?: string | null;
  type: 'participation' | 'winner';
  status: string;
  serial?: string | null;
  error?: string | null;
  emailedAt?: string | null;
  createdAt: string;
};

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 72;

type EmailResultRow = {
  id: string;
  name: string;
  email: string | null;
  status: string;
  error?: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function downloadBlob(filename: string, data: Uint8Array, mime: string) {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const blob = new Blob([copy], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function cellText(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function looksLikeEmail(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function pendingTargets(issues: ListedIssue[], resend: boolean): ListedIssue[] {
  if (resend) return issues.filter((i) => i.status !== 'pending');
  return issues.filter((i) => i.status === 'stored' || i.status === 'failed');
}

function certRowParticipantId(id: string): string {
  return id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
}

function certRowCategoryId(id: string): string | null {
  return id.includes(':') ? id.slice(0, id.indexOf(':')) : null;
}

function issueMatchesRow(issue: ListedIssue, row: CertRow): boolean {
  const pid = certRowParticipantId(row.id);
  const catId = certRowCategoryId(row.id);
  const uuid = /^[0-9a-f-]{36}$/i.test(pid);
  if (uuid && issue.participantId === pid) {
    if (catId && issue.categoryId) return issue.categoryId === catId;
    return true;
  }
  const name = String(row.row.name ?? row.fileName).trim().toLowerCase();
  const email = (row.email ?? '').trim().toLowerCase();
  const issueName = issue.recipientName.trim().toLowerCase();
  const issueEmail = (issue.recipientEmail ?? '').trim().toLowerCase();
  if (email && issueEmail && email === issueEmail) {
    return !name || !issueName || name === issueName;
  }
  return Boolean(name && issueName && name === issueName && !email && !issueEmail);
}

function issuesForSelectedRows(issues: ListedIssue[], selected: CertRow[]): ListedIssue[] {
  return issues.filter((issue) => selected.some((row) => issueMatchesRow(issue, row)));
}

function recipientExtra(row: CertificateRow): string {
  const parts = [cellText(row.category), cellText(row.place)].filter(Boolean);
  return parts.join(' · ');
}

const FONT_PRESETS = [
  { label: 'Small', size: 14 },
  { label: 'Medium', size: 22 },
  { label: 'Large', size: 36 },
  { label: 'Title', size: 48 },
] as const;

function FontSizeControl({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (size: number) => void;
  label: string;
}) {
  const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, value));
  return (
    <div className="cert-font-control">
      <div className="cert-font-control-top">
        <span>{label}</span>
        <span className="cert-font-pt">{clamped} pt</span>
      </div>
      <div className="cert-font-control-row">
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => onChange(Math.max(FONT_SIZE_MIN, clamped - 2))}
        >
          −
        </button>
        <input
          type="range"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          value={clamped}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => onChange(Math.min(FONT_SIZE_MAX, clamped + 2))}
        >
          +
        </button>
      </div>
      <div className="cert-font-presets">
        {FONT_PRESETS.map((p) => (
          <button
            key={p.size}
            type="button"
            className={`btn btn-sm ${clamped === p.size ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => onChange(p.size)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CertificatesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tournamentId = searchParams.get('tournament') ?? '';
  const [highlightTournamentPicker, setHighlightTournamentPicker] = useState(false);

  const tournaments = useLiveQuery(
    () =>
      db.tournaments
        .filter((t) => !t.deletedAt)
        .toArray()
        .then((list) =>
          list.sort((a, b) => (b.date ?? b.updatedAt ?? '').localeCompare(a.date ?? a.updatedAt ?? '')),
        ),
    [],
  );

  const tournament = useLiveQuery(
    () => (tournamentId ? db.tournaments.get(tournamentId) : undefined),
    [tournamentId],
  );
  const categories = useLiveQuery(
    () =>
      tournamentId
        ? db.categories
            .where('tournamentId')
            .equals(tournamentId)
            .filter((c) => !c.deletedAt)
            .toArray()
        : [],
    [tournamentId],
  );
  const participants = useLiveQuery(
    () =>
      tournamentId
        ? db.participants
            .where('tournamentId')
            .equals(tournamentId)
            .filter((p) => !p.deletedAt)
            .toArray()
        : [],
    [tournamentId],
  );
  const games = useLiveQuery(
    () =>
      tournamentId
        ? db.games
            .where('tournamentId')
            .equals(tournamentId)
            .filter((g) => !g.deletedAt)
            .toArray()
        : [],
    [tournamentId],
  );

  const [mode, setMode] = useState<CertMode>(tournamentId ? 'participation' : 'csv');
  const [templateBytes, setTemplateBytes] = useState<Uint8Array | null>(null);
  const [layout, setLayout] = useState<CertificateLayout | null>(null);
  const [fields, setFields] = useState<CertificateField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [rows, setRows] = useState<CertRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedColumn, setSelectedColumn] = useState('name');
  const [placeFontSize, setPlaceFontSize] = useState(22);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuedSummary, setIssuedSummary] = useState<string | null>(null);

  const [subjectDraft, setSubjectDraft] = useState(DEFAULT_CERT_EMAIL_SUBJECT);
  const [bodyDraft, setBodyDraft] = useState(DEFAULT_CERT_EMAIL_BODY);
  const [prefixDraft, setPrefixDraft] = useState(DEFAULT_CERT_SERIAL_PREFIX);
  const [padDraft, setPadDraft] = useState<number | null>(DEFAULT_CERT_SERIAL_PAD);
  const [testTo, setTestTo] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [sendTyped, setSendTyped] = useState('');
  const [resendEmailed, setResendEmailed] = useState(false);
  const [mailIssueIds, setMailIssueIds] = useState<Set<string>>(() => new Set());
  const [issues, setIssues] = useState<ListedIssue[]>([]);
  const [emailResults, setEmailResults] = useState<EmailResultRow[] | null>(null);

  function linkTournament(id: string) {
    const next = new URLSearchParams(searchParams);
    if (id) {
      next.set('tournament', id);
      setMode((m) => (m === 'csv' ? 'participation' : m));
    } else {
      next.delete('tournament');
      setMode('csv');
      setRows([]);
      setSelectedIds(new Set());
      setMessage(null);
      setIssuedSummary(null);
    }
    setSearchParams(next, { replace: true });
    setHighlightTournamentPicker(false);
    setError(null);
    setEmailResults(null);
    setIssues([]);
    setConfirmOpen(false);
  }

  const columns = useMemo(() => collectColumns(rows.map((r) => r.row)), [rows]);

  const rowIdsKey = rows.map((r) => r.id).join('|');
  useEffect(() => {
    const ids = rowIdsKey ? rowIdsKey.split('|') : [];
    setSelectedIds((prev) => {
      const kept = ids.filter((id) => prev.has(id));
      const added = ids.filter((id) => !prev.has(id));
      if (kept.length > 0) return new Set([...kept, ...added]);
      return new Set(ids);
    });
  }, [rowIdsKey]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selectedIds.has(r.id)),
    [rows, selectedIds],
  );
  const allRecipientsSelected = rows.length > 0 && selectedRows.length === rows.length;

  useEffect(() => {
    if (columns.length && !columns.includes(selectedColumn)) {
      setSelectedColumn(columns[0] ?? 'name');
    }
  }, [columns, selectedColumn]);

  useEffect(() => {
    if (!tournament) return;
    setSubjectDraft(tournament.certEmailSubject || DEFAULT_CERT_EMAIL_SUBJECT);
    setBodyDraft(tournament.certEmailBody || DEFAULT_CERT_EMAIL_BODY);
    setPrefixDraft(tournament.certSerialPrefix?.trim() || DEFAULT_CERT_SERIAL_PREFIX);
    setPadDraft(tournament.certSerialPad ?? DEFAULT_CERT_SERIAL_PAD);
  }, [tournament?.id]);

  const refreshIssues = useCallback(async () => {
    if (!tournamentId) {
      setIssues([]);
      return;
    }
    const listed = await apiListCertificates(tournamentId);
    if (listed.ok) setIssues(listed.data.issues);
  }, [tournamentId]);

  useEffect(() => {
    void refreshIssues();
  }, [refreshIssues]);

  const serialPreview = useMemo(() => {
    const pad = padDraft ?? DEFAULT_CERT_SERIAL_PAD;
    const year = certificateYear(tournament?.date);
    const next = tournament?.certSerialNext ?? 1;
    return formatCertificateSerial(prefixDraft, next, pad, year);
  }, [prefixDraft, padDraft, tournament?.date, tournament?.certSerialNext]);

  const rebuildTournamentRows = useCallback(() => {
    if (!tournament || !participants) return;
    const mix = isMixedTournament(tournament);
    const topN = tournament.prizePlaces ?? 3;
    const scope = tournament.awardScope ?? 'per_category';
    const dateStr = tournament.date
      ? new Date(tournament.date).toLocaleDateString()
      : '';
    const prefix = tournament.certSerialPrefix?.trim() || DEFAULT_CERT_SERIAL_PREFIX;
    const pad = tournament.certSerialPad ?? DEFAULT_CERT_SERIAL_PAD;
    const next = tournament.certSerialNext ?? 1;
    const year = certificateYear(tournament.date);
    const previewSerial = (i: number) => formatCertificateSerial(prefix, next + i, pad, year);

    if (mode === 'participation') {
      setRows(
        participants.map((p, i) => {
          const catNames = (categories ?? [])
            .filter((c) => p.categoryIds?.includes(c.id))
            .map((c) => c.name)
            .join(', ');
          return {
            id: p.id,
            fileName: p.name,
            email: p.email ?? undefined,
            row: participantToRow(p, {
              tournament: tournament.name,
              date: dateStr,
              category: catNames,
              serial: previewSerial(i),
            }),
          };
        }),
      );
      return;
    }

    if (mode === 'winner' && games) {
      const nextRows: CertRow[] = [];
      let serialIndex = 0;
      const enginePlayers = participants.map((p) => ({
        id: p.id,
        name: p.name,
        rating: p.rating ?? undefined,
        seed: p.seed,
      }));
      const allPast = games
        .filter((g) => g.result !== 'pending')
        .map((g) => ({
          round: g.round,
          whiteId: g.whiteId ?? null,
          blackId: g.blackId ?? null,
          result: g.result as GameResult,
          isBye: g.isBye,
        }));

      const standingsOpts = {
        tiebreakOrder: (tournament.tiebreakOrder as import('@chess-alokas/shared').TiebreakKey[] | null) ?? null,
        sharedPlaces: tournament.sharedPlaces ?? true,
      };

      if (scope === 'overall' || !(categories?.length)) {
        try {
          const standings = computeStandings(enginePlayers, allPast, standingsOpts);
          for (const s of winnersFromStandings(standings, topN)) {
            const p = participants.find((x) => x.id === s.id);
            nextRows.push({
              id: s.id,
              fileName: `${s.rank}_${s.name}`,
              email: p?.email ?? undefined,
              row: winnerToRow(s, {
                tournament: tournament.name,
                date: dateStr,
                category: 'Overall',
                serial: previewSerial(serialIndex++),
              }),
            });
          }
        } catch {
          /* ignore */
        }
      } else {
        for (const cat of categories) {
          const catPlayers = participants.filter((p) => p.categoryIds?.includes(cat.id));
          const catTop = cat.prizePlaces ?? topN;
          try {
            const standings = mix
              ? computeSectionStandings(
                  enginePlayers,
                  allPast,
                  new Set(catPlayers.map((p) => p.id)),
                  standingsOpts,
                )
              : computeStandings(
                  catPlayers.map((p) => ({
                    id: p.id,
                    name: p.name,
                    rating: p.rating ?? undefined,
                    seed: p.seed,
                  })),
                  games
                    .filter((g) => g.categoryId === cat.id && g.result !== 'pending')
                    .map((g) => ({
                      round: g.round,
                      whiteId: g.whiteId ?? null,
                      blackId: g.blackId ?? null,
                      result: g.result as GameResult,
                      isBye: g.isBye,
                    })),
                  standingsOpts,
                );
            for (const s of winnersFromStandings(standings, catTop)) {
              const p = participants.find((x) => x.id === s.id);
              nextRows.push({
                id: `${cat.id}:${s.id}`,
                fileName: `${cat.name}_${s.rank}_${s.name}`,
                email: p?.email ?? undefined,
                row: winnerToRow(s, {
                  tournament: tournament.name,
                  date: dateStr,
                  category: cat.name,
                  serial: previewSerial(serialIndex++),
                }),
              });
            }
          } catch {
            /* ignore */
          }
        }
      }
      setRows(nextRows);
    }
  }, [tournament, participants, categories, games, mode]);

  useEffect(() => {
    if (mode === 'csv') return;
    rebuildTournamentRows();
  }, [mode, rebuildTournamentRows]);

  async function persistTournament(patch: Partial<LocalTournament>) {
    if (!tournamentId) return;
    await db.tournaments.update(tournamentId, {
      ...patch,
      updatedAt: nowIso(),
      dirty: 1,
    });
  }

  async function persistEmailCopy() {
    await persistTournament({
      certEmailSubject: subjectDraft.trim() || DEFAULT_CERT_EMAIL_SUBJECT,
      certEmailBody: bodyDraft.trim() || DEFAULT_CERT_EMAIL_BODY,
    });
  }

  async function persistSerialSettings(prefix: string, pad: number | null) {
    const nextPad = pad ?? DEFAULT_CERT_SERIAL_PAD;
    await persistTournament({
      certSerialPrefix: prefix.trim() || DEFAULT_CERT_SERIAL_PREFIX,
      certSerialPad: nextPad,
    });
  }

  async function stampReservedSerials(source: CertRow[]): Promise<CertRow[]> {
    if (!tournamentId) return source;
    const reserved = await apiReserveCertificateSerials(tournamentId, source.length);
    if (!reserved.ok) {
      throw new Error(reserved.error ?? 'Could not reserve certificate serials');
    }
    const serials = reserved.data.serials;
    if (serials.length !== source.length) {
      throw new Error('Serial reservation returned the wrong count');
    }
    const currentNext = tournament?.certSerialNext ?? 1;
    await persistTournament({ certSerialNext: currentNext + source.length });
    return source.map((r, i) => ({
      ...r,
      row: { ...r.row, serial: serials[i]! },
    }));
  }

  async function onTemplateFile(file: File) {
    setError(null);
    const buf = new Uint8Array(await file.arrayBuffer());
    try {
      const size = await readTemplatePageSize(buf);
      setTemplateBytes(buf);
      setLayout({
        pageWidth: size.pageWidth,
        pageHeight: size.pageHeight,
        fields: [],
      });
      setFields([]);
      setSelectedFieldId(null);
      setMessage(`Template loaded (${Math.round(size.pageWidth)}×${Math.round(size.pageHeight)} pt)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read PDF');
    }
  }

  function clearTemplate() {
    setTemplateBytes(null);
    setLayout(null);
    setFields([]);
    setSelectedFieldId(null);
    setMessage(null);
    setError(null);
  }

  function onCsvFile(file: File) {
    setError(null);
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const parsed = result.data
          .map((raw, i) => {
            const row: CertificateRow = {};
            for (const [k, v] of Object.entries(raw)) {
              const key = k.trim();
              if (!key) continue;
              row[key] = cellText(v);
            }
            const name = String(row['name'] ?? row['Name'] ?? `row-${i + 1}`);
            return {
              id: crypto.randomUUID(),
              fileName: name,
              email: String(row['email'] ?? row['Email'] ?? '') || undefined,
              row,
            };
          })
          .filter((r) => Object.values(r.row).some((v) => String(v ?? '').trim()));
        setRows(parsed);
        setMode('csv');
        setMessage(`Loaded ${parsed.length} rows from CSV`);
      },
      error: (err) => setError(err.message),
    });
  }

  function placeFieldAt(nx: number, ny: number, column = selectedColumn) {
    const id = crypto.randomUUID();
    const field: CertificateField = {
      id,
      sourceColumn: column,
      x: Math.min(0.98, Math.max(0.02, nx)),
      y: Math.min(0.98, Math.max(0.02, ny)),
      width: 0.7,
      fontSize: placeFontSize,
      align: 'center',
      color: '#1a1208',
      font: 'Helvetica-Bold',
    };
    setSelectedColumn(column);
    setSelectedFieldId(id);
    setFields((prev) => [...prev, field]);
  }

  function setFieldFontSize(id: string, fontSize: number) {
    const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, fontSize));
    setPlaceFontSize(next);
    setSelectedFieldId(id);
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, fontSize: next } : f)));
  }

  function moveField(id: string, nx: number, ny: number) {
    setFields((prev) =>
      prev.map((f) =>
        f.id === id
          ? {
              ...f,
              x: Math.min(0.98, Math.max(0.02, nx)),
              y: Math.min(0.98, Math.max(0.02, ny)),
            }
          : f,
      ),
    );
  }

  async function saveLayoutLocal() {
    if (!templateBytes || !layout) return;
    const full: CertificateLayout = { ...layout, fields };
    await db.certificateTemplates.put({
      id: crypto.randomUUID(),
      tournamentId: tournamentId || null,
      name: `${mode} template`,
      certType: mode === 'winner' ? 'winner' : 'participation',
      pdfBase64: bytesToBase64(templateBytes),
      layoutJson: JSON.stringify(full),
      updatedAt: nowIso(),
      dirty: 1,
    });
    setMessage('Layout saved locally');
  }

  async function exportPhysical() {
    if (!templateBytes || !layout || rows.length === 0) {
      setError('Need a template, fields, and at least one recipient');
      return;
    }
    if (selectedRows.length === 0) {
      setError('Pick at least one recipient');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const stamped = await stampReservedSerials(selectedRows);
      const stampedById = new Map(stamped.map((r) => [r.id, r]));
      setRows((prev) => prev.map((r) => stampedById.get(r.id) ?? r));
      const full: CertificateLayout = { ...layout, fields };
      const batch = await generateCertificateBatch(
        templateBytes,
        full,
        stamped.map((r) => ({ id: r.id, fileName: r.fileName, row: r.row })),
      );
      downloadBlob('certificates-merged.pdf', batch.mergedPdf, 'application/pdf');
      downloadBlob('certificates.zip', batch.zipBytes, 'application/zip');
      setMessage(`Exported ${batch.individuals.length} certificates (merged PDF + ZIP)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  async function issueDigital() {
    if (!tournamentId) {
      setHighlightTournamentPicker(true);
      setError('Choose which tournament these certificates belong to before issuing.');
      return;
    }
    if (!templateBytes || !layout || rows.length === 0) {
      setError('Need a template, fields, and recipients');
      return;
    }
    if (selectedRows.length === 0) {
      setError('Pick at least one recipient');
      return;
    }
    setBusy(true);
    setError(null);
    setIssuedSummary(null);
    try {
      const stamped = await stampReservedSerials(selectedRows);
      const stampedById = new Map(stamped.map((r) => [r.id, r]));
      setRows((prev) => prev.map((r) => stampedById.get(r.id) ?? r));
      const full: CertificateLayout = { ...layout, fields };
      const batch = await generateCertificateBatch(
        templateBytes,
        full,
        stamped.map((r) => ({ id: r.id, fileName: r.fileName, row: r.row })),
      );

      const items = batch.digital.map((d, i) => {
        const src = stamped[i]!;
        const participantId = certRowParticipantId(src.id);
        const categoryId = certRowCategoryId(src.id);
        return {
          participantId: /^[0-9a-f-]{36}$/i.test(participantId) ? participantId : null,
          categoryId: categoryId && /^[0-9a-f-]{36}$/i.test(categoryId) ? categoryId : null,
          type: (mode === 'winner' ? 'winner' : 'participation') as 'participation' | 'winner',
          rank: typeof src.row.rank === 'number' ? src.row.rank : Number(src.row.rank) || null,
          recipientEmail: src.email || null,
          recipientName: String(src.row.name ?? src.fileName),
          serial: String(src.row.serial ?? '') || null,
          pdfBase64: bytesToBase64(d.pdf),
        };
      });

      const issueRes = await apiIssueCertificates(tournamentId, items);
      if (!issueRes.ok) {
        throw new Error(issueRes.error ?? 'Issue failed');
      }

      const where =
        issueRes.data.storageBackend === 'supabase'
          ? 'Supabase Storage'
          : 'local disk (set SUPABASE_SECRET_KEY for cloud)';
      const summary = `Stored ${issueRes.data.issued} digital certificates to ${where}. Email is a separate step.`;
      setIssuedSummary(summary);
      setMessage(summary);
      await refreshIssues();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Digital issue failed');
    } finally {
      setBusy(false);
    }
  }

  const selectedIssues = useMemo(
    () => issuesForSelectedRows(issues, selectedRows),
    [issues, selectedRows],
  );
  const confirmPool = useMemo(
    () => pendingTargets(selectedIssues, resendEmailed),
    [selectedIssues, resendEmailed],
  );
  const willMail = useMemo(
    () =>
      confirmPool.filter(
        (i) => looksLikeEmail(i.recipientEmail) && mailIssueIds.has(i.id),
      ),
    [confirmPool, mailIssueIds],
  );
  const skipped = useMemo(
    () => confirmPool.filter((i) => !looksLikeEmail(i.recipientEmail)),
    [confirmPool],
  );
  const mailCandidates = useMemo(
    () => confirmPool.filter((i) => looksLikeEmail(i.recipientEmail)),
    [confirmPool],
  );
  const statusRows = useMemo(() => {
    if (emailResults) {
      return emailResults.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        status: r.status,
        error: r.error,
        serial: issues.find((i) => i.id === r.id)?.serial ?? null,
      }));
    }
    return issues.map((i) => ({
      id: i.id,
      name: i.recipientName,
      email: i.recipientEmail ?? null,
      status: i.status,
      error: i.error ?? undefined,
      serial: i.serial ?? null,
    }));
  }, [emailResults, issues]);

  const previewVars = useMemo(() => {
    const first = willMail[0];
    return {
      playerName: first?.recipientName || 'Player name',
      tournament: tournament?.name || 'Tournament',
      certType: certTypeLabel(first?.type || (mode === 'winner' ? 'winner' : 'participation')),
      serial: first?.serial?.trim() || serialPreview,
    };
  }, [willMail, tournament?.name, mode, serialPreview]);

  const previewSubject = renderCertTemplate(subjectDraft, previewVars);
  const previewHtml = certBodyToHtml(renderCertTemplate(bodyDraft, previewVars));

  async function openEmailConfirm() {
    if (!tournamentId) {
      setHighlightTournamentPicker(true);
      setError('Choose a tournament before emailing certificates.');
      return;
    }
    if (selectedRows.length === 0) {
      setError('Pick at least one recipient');
      return;
    }
    setError(null);
    await persistEmailCopy();
    const listed = await apiListCertificates(tournamentId);
    if (!listed.ok) {
      setError(listed.error ?? 'Could not load issued certificates');
      return;
    }
    setIssues(listed.data.issues);
    const matched = issuesForSelectedRows(listed.data.issues, selectedRows);
    if (matched.length === 0) {
      setError('Issue digital for the selected people first.');
      return;
    }
    const initialMail = pendingTargets(matched, false).filter((i) =>
      looksLikeEmail(i.recipientEmail),
    );
    setMailIssueIds(new Set(initialMail.map((i) => i.id)));
    setConfirmChecked(false);
    setSendTyped('');
    setResendEmailed(false);
    setConfirmOpen(true);
  }

  async function confirmEmailPending() {
    if (!tournamentId) return;
    if (sendTyped !== 'SEND' || !confirmChecked || willMail.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await persistEmailCopy();
      const emailRes = await apiEmailCertificates(tournamentId, {
        issueIds: willMail.map((i) => i.id),
        resend: resendEmailed,
        subject: subjectDraft.trim() || DEFAULT_CERT_EMAIL_SUBJECT,
        body: bodyDraft.trim() || DEFAULT_CERT_EMAIL_BODY,
      });
      if (!emailRes.ok) {
        throw new Error(emailRes.error ?? 'Email failed');
      }
      setEmailResults(emailRes.data.results);
      setIssuedSummary(`Emailed ${emailRes.data.sent}, failed ${emailRes.data.failed}`);
      setMessage(`Emailed ${emailRes.data.sent}, failed ${emailRes.data.failed}`);
      setConfirmOpen(false);
      await refreshIssues();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email failed');
    } finally {
      setBusy(false);
    }
  }

  async function sendTestEmail() {
    if (!tournamentId) {
      setHighlightTournamentPicker(true);
      setError('Choose a tournament before sending a test email.');
      return;
    }
    if (!looksLikeEmail(testTo)) {
      setError('Enter a valid test email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await persistEmailCopy();
      const res = await apiEmailCertificateTest(tournamentId, {
        to: testTo.trim(),
        subject: subjectDraft.trim() || DEFAULT_CERT_EMAIL_SUBJECT,
        body: bodyDraft.trim() || DEFAULT_CERT_EMAIL_BODY,
      });
      if (!res.ok) {
        throw new Error(res.error ?? 'Test email failed');
      }
      setMessage(
        res.data.attachedPdf
          ? `Test email sent to ${res.data.to} (sample PDF attached).`
          : `Test email sent to ${res.data.to} (no stored PDF to attach yet).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test email failed');
    } finally {
      setBusy(false);
    }
  }

  async function updateAwardSettings(prizePlaces: number, awardScope: 'overall' | 'per_category') {
    if (!tournamentId || !tournament) return;
    await persistTournament({ prizePlaces, awardScope });
  }

  const sample = (selectedRows[0] ?? rows[0])?.row;
  const selectedField = fields.find((f) => f.id === selectedFieldId) ?? null;
  const canSendConfirm =
    confirmChecked && sendTyped === 'SEND' && willMail.length > 0 && !busy;

  return (
    <div className="page-container certificates-page">
      <div className="page-header">
        <div>
          <h1>Certificates</h1>
          <p className="page-subtitle">
            Upload a PDF template, place fields, then print or email digital copies.
            {tournament && (
              <>
                {' '}
                Linked to <Link to={`/tournaments/${tournament.id}`}>{tournament.name}</Link>
              </>
            )}
          </p>
        </div>
      </div>

      <div
        className={`cert-tournament-link ${highlightTournamentPicker ? 'needs-attention' : ''}`}
      >
        <label>
          Tournament for digital issue
          <select
            className="input"
            value={tournamentId}
            onChange={(e) => linkTournament(e.target.value)}
          >
            <option value="">Select tournament…</option>
            {(tournaments ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.date ? ` (${new Date(t.date).toLocaleDateString()})` : ''}
              </option>
            ))}
          </select>
        </label>
        {tournamentId && tournament && (
          <span className="form-hint">
            ID: <code>{tournament.id}</code>
          </span>
        )}
        {!tournamentId && (
          <span className="form-hint">
            Required before Issue digital or Email selected. With a tournament selected, participants
            load automatically — CSV is only for external lists.
          </span>
        )}
        {tournamentId && (
          <span className="form-hint">
            Recipients come from this tournament (Participation / Winners). CSV import is optional.
          </span>
        )}
      </div>

      <div className="cert-toolbar">
        <label className="btn btn-outline btn-sm">
          Upload PDF template
          <input
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onTemplateFile(f);
              e.target.value = '';
            }}
          />
        </label>
        {templateBytes && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearTemplate}>
            Remove template
          </button>
        )}
        <label className="btn btn-outline btn-sm">
          Import CSV
          <input
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onCsvFile(f);
            }}
          />
        </label>
        {tournamentId && (
          <div className="cert-mode-tabs">
            {(['participation', 'winner'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`cat-tab ${mode === m ? 'active' : ''}`}
                onClick={() => setMode(m)}
              >
                {m === 'participation' ? 'Participation' : 'Winners'}
              </button>
            ))}
          </div>
        )}
      </div>

      {tournament && (
        <div className="cert-settings">
          <NumberField
            className="cert-topn-field"
            label="Top N"
            inputClassName="input input-sm"
            value={tournament.prizePlaces ?? 3}
            onChange={(n) => {
              if (n == null) return;
              void updateAwardSettings(n, tournament.awardScope ?? 'per_category');
            }}
            min={MIN_PRIZE_PLACES}
            max={MAX_PRIZE_PLACES}
            required
          />
          <label>
            Award scope
            <select
              className="input input-sm"
              value={tournament.awardScope ?? 'per_category'}
              onChange={(e) =>
                void updateAwardSettings(
                  tournament.prizePlaces ?? 3,
                  e.target.value as 'overall' | 'per_category',
                )
              }
            >
              <option value="per_category">Per category</option>
              <option value="overall">Overall</option>
            </select>
          </label>
          <span className="form-hint">
            {selectedRows.length} of {rows.length} selected
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <section className="cert-recipients">
          <div className="cert-recipients-head">
            <h3>Recipients</h3>
            <span className="form-hint">
              Download, issue, and email use the checked people only.
            </span>
          </div>
          <div className="cert-recipients-scroll">
            <table className="cert-results-table cert-recipients-table">
              <thead>
                <tr>
                  <th className="cert-check-col">
                    <input
                      type="checkbox"
                      checked={allRecipientsSelected}
                      ref={(el) => {
                        if (el) {
                          el.indeterminate =
                            selectedRows.length > 0 && !allRecipientsSelected;
                        }
                      }}
                      onChange={() => {
                        setSelectedIds(
                          allRecipientsSelected
                            ? new Set()
                            : new Set(rows.map((r) => r.id)),
                        );
                      }}
                      aria-label="Select all recipients"
                    />
                  </th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const extra = recipientExtra(r.row);
                  return (
                    <tr key={r.id} className={selectedIds.has(r.id) ? 'is-selected' : ''}>
                      <td className="cert-check-col">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => {
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.id)) next.delete(r.id);
                              else next.add(r.id);
                              return next;
                            });
                          }}
                          aria-label={`Select ${String(r.row.name ?? r.fileName)}`}
                        />
                      </td>
                      <td>{String(r.row.name ?? r.fileName)}</td>
                      <td>{r.email || '—'}</td>
                      <td>{extra || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tournament && (
        <div className="cert-compose">
          <div className="cert-compose-col">
            <h3>Certificate serials</h3>
            <p className="form-hint">
              Unique per tournament. Pattern <code>{'{prefix}/{seq}/{year}'}</code>. Assigned when
              you issue or print — not when emailing.
            </p>
            <div className="cert-serial-row">
              <label>
                Prefix
                <input
                  className="input input-sm"
                  value={prefixDraft}
                  maxLength={32}
                  onChange={(e) => setPrefixDraft(e.target.value)}
                  onBlur={() => void persistSerialSettings(prefixDraft, padDraft)}
                />
              </label>
              <NumberField
                label="Digits"
                inputClassName="input input-sm"
                value={padDraft}
                onChange={(n) => {
                  setPadDraft(n);
                  if (n != null) void persistSerialSettings(prefixDraft, n);
                }}
                min={1}
                max={8}
                required
              />
              <div className="cert-serial-preview">
                <span className="form-hint">Next serial</span>
                <code>{serialPreview}</code>
              </div>
            </div>
          </div>
          <div className="cert-compose-col">
            <h3>Email copy</h3>
            <p className="form-hint">
              Merge tags: <code>{'{{playerName}}'}</code> <code>{'{{tournament}}'}</code>{' '}
              <code>{'{{certType}}'}</code> <code>{'{{serial}}'}</code>
            </p>
            <label>
              Subject
              <input
                className="input"
                value={subjectDraft}
                onChange={(e) => setSubjectDraft(e.target.value)}
                onBlur={() => void persistEmailCopy()}
              />
            </label>
            <label>
              Body
              <textarea
                className="input cert-email-body"
                rows={8}
                value={bodyDraft}
                onChange={(e) => setBodyDraft(e.target.value)}
                onBlur={() => void persistEmailCopy()}
              />
            </label>
            <div className="cert-test-send">
              <input
                className="input"
                type="email"
                placeholder="Test address"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-outline"
                disabled={busy || !tournamentId}
                onClick={() => void sendTestEmail()}
              >
                Send test
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="cert-workspace">
        <aside className="cert-sidebar">
          <h3>Data columns</h3>
          <p className="cert-sidebar-lead">
            Set the text size, then drag a column onto the certificate. The sample on the page
            matches the printed size.
          </p>
          <FontSizeControl
            label={
              selectedField
                ? `${certificateColumnLabel(selectedField.sourceColumn)} size`
                : 'Size for next field'
            }
            value={selectedField?.fontSize ?? placeFontSize}
            onChange={(size) => {
              if (selectedField) setFieldFontSize(selectedField.id, size);
              else setPlaceFontSize(size);
            }}
          />
          <div className="cert-column-list" role="listbox" aria-label="Certificate data columns">
            {columns.length === 0 && (
              <p className="cert-sidebar-lead">
                Load a tournament or import a CSV to see available columns.
              </p>
            )}
            {columns.map((col) => {
              const example = certificateColumnSample(col, sample);
              return (
                <button
                  key={col}
                  type="button"
                  role="option"
                  aria-selected={selectedColumn === col}
                  className={`cert-col-item ${selectedColumn === col ? 'active' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', col);
                    setSelectedColumn(col);
                  }}
                  onClick={() => setSelectedColumn(col)}
                >
                  <span className="cert-col-title">{certificateColumnLabel(col)}</span>
                  <span className="cert-col-key">{col}</span>
                  <span className="cert-col-sample">
                    {example ? (
                      <>
                        Example: <em>{example}</em>
                      </>
                    ) : (
                      'No sample value yet'
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <h3>Placed on template</h3>
          <ul className="cert-field-list">
            {fields.length === 0 && (
              <li className="cert-field-empty">No fields placed yet</li>
            )}
            {fields.map((f) => (
              <li
                key={f.id}
                className={selectedFieldId === f.id ? 'is-selected' : ''}
                onClick={() => setSelectedFieldId(f.id)}
              >
                <span>
                  <span className="cert-field-name">{certificateColumnLabel(f.sourceColumn)}</span>
                  <span className="cert-field-key">
                    {f.sourceColumn} · {f.fontSize} pt
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFields((prev) => prev.filter((x) => x.id !== f.id));
                    setSelectedFieldId((cur) => (cur === f.id ? null : cur));
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <div className="cert-actions">
            <button type="button" className="btn btn-outline" disabled={!templateBytes} onClick={() => void saveLayoutLocal()}>
              Save layout
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                busy ||
                !templateBytes ||
                fields.length === 0 ||
                selectedRows.length === 0
              }
              onClick={() => void exportPhysical()}
            >
              Download print pack ({selectedRows.length})
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={
                busy ||
                !templateBytes ||
                fields.length === 0 ||
                selectedRows.length === 0
              }
              onClick={() => void issueDigital()}
            >
              Issue digital ({selectedRows.length})
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !tournamentId || selectedRows.length === 0}
              onClick={() => void openEmailConfirm()}
            >
              Email selected ({selectedRows.length})
            </button>
          </div>
          {message && <p className="form-hint">{message}</p>}
          {issuedSummary && <p className="form-hint">{issuedSummary}</p>}
          {error && <div className="form-error">{error}</div>}
        </aside>

        <div className="cert-canvas-wrap">
          {!templateBytes || !layout ? (
            <div className="empty-state">
              <p>Upload a PDF certificate template to begin.</p>
            </div>
          ) : (
            <CertificateDesignerCanvas
              templateBytes={templateBytes}
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
      </div>

      {statusRows.length > 0 && (
        <section className="cert-results">
          <h3>Issue status</h3>
          <div className="cert-results-scroll">
            <table className="cert-results-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Serial</th>
                  <th>Status</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {statusRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.email || '—'}</td>
                    <td>
                      <code>{row.serial || '—'}</code>
                    </td>
                    <td>{row.status}</td>
                    <td>{row.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {confirmOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => !busy && setConfirmOpen(false)}
        >
          <div
            className="modal-card cert-email-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cert-email-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="cert-email-title">Email selected certificates</h2>
            <p className="form-hint">
              This sends {willMail.length} email{willMail.length === 1 ? '' : 's'} with PDF
              attachments. It will not run until you confirm below.
            </p>

            <h3 className="settings-subtitle">Will be mailed ({willMail.length})</h3>
            <ul className="cert-mail-list">
              {mailCandidates.length === 0 && <li>No recipients with a valid email.</li>}
              {mailCandidates.map((i) => (
                <li key={i.id}>
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={mailIssueIds.has(i.id)}
                      onChange={() => {
                        setMailIssueIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(i.id)) next.delete(i.id);
                          else next.add(i.id);
                          return next;
                        });
                      }}
                    />
                    {i.recipientName} — {i.recipientEmail}
                    {i.serial ? ` (${i.serial})` : ''}
                  </label>
                </li>
              ))}
            </ul>

            <h3 className="settings-subtitle">Skipped, missing email ({skipped.length})</h3>
            <ul className="cert-mail-list">
              {skipped.length === 0 && <li>None</li>}
              {skipped.map((i) => (
                <li key={i.id}>{i.recipientName}</li>
              ))}
            </ul>

            <h3 className="settings-subtitle">Preview (first recipient)</h3>
            <p className="cert-email-preview-subject">
              <strong>Subject:</strong> {previewSubject}
            </p>
            <div
              className="cert-email-preview"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />

            <label className="settings-check">
              <input
                type="checkbox"
                checked={resendEmailed}
                onChange={(e) => {
                  const nextResend = e.target.checked;
                  setResendEmailed(nextResend);
                  const pool = pendingTargets(selectedIssues, nextResend);
                  setMailIssueIds(
                    new Set(
                      pool
                        .filter((i) => looksLikeEmail(i.recipientEmail))
                        .map((i) => i.id),
                    ),
                  );
                }}
              />
              Also resend certificates already marked emailed
            </label>

            <label className="settings-check">
              <input
                type="checkbox"
                checked={confirmChecked}
                onChange={(e) => setConfirmChecked(e.target.checked)}
              />
              Email {willMail.length} player{willMail.length === 1 ? '' : 's'} now
            </label>

            <label>
              Type SEND to confirm
              <input
                className="input"
                value={sendTyped}
                autoComplete="off"
                onChange={(e) => setSendTyped(e.target.value)}
              />
            </label>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canSendConfirm}
                onClick={() => void confirmEmailPending()}
              >
                {busy ? 'Sending…' : 'Send emails'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
