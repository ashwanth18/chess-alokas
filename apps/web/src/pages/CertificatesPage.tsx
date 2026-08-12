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
import { db, nowIso } from '../db/local';
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
  apiListCertificates,
} from '../api/client';
import { isMixedTournament } from '../lib/tournamentProgress';
import CertificateDesignerCanvas from '../components/CertificateDesignerCanvas';

type CertMode = 'participation' | 'winner' | 'csv';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
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
  const [rows, setRows] = useState<Array<{ id: string; fileName: string; row: CertificateRow; email?: string }>>([]);
  const [selectedColumn, setSelectedColumn] = useState('name');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuedSummary, setIssuedSummary] = useState<string | null>(null);

  function linkTournament(id: string) {
    const next = new URLSearchParams(searchParams);
    if (id) {
      next.set('tournament', id);
      // Tournament data drives recipients — no CSV needed.
      setMode((m) => (m === 'csv' ? 'participation' : m));
    } else {
      next.delete('tournament');
      setMode('csv');
      setRows([]);
      setMessage(null);
      setIssuedSummary(null);
    }
    setSearchParams(next, { replace: true });
    setHighlightTournamentPicker(false);
    setError(null);
  }

  const columns = useMemo(() => collectColumns(rows.map((r) => r.row)), [rows]);

  useEffect(() => {
    if (columns.length && !columns.includes(selectedColumn)) {
      setSelectedColumn(columns[0] ?? 'name');
    }
  }, [columns, selectedColumn]);

  const rebuildTournamentRows = useCallback(() => {
    if (!tournament || !participants) return;
    const mix = isMixedTournament(tournament);
    const topN = tournament.prizePlaces ?? 3;
    const scope = tournament.awardScope ?? 'per_category';
    const dateStr = tournament.date
      ? new Date(tournament.date).toLocaleDateString()
      : '';

    if (mode === 'participation') {
      setRows(
        participants.map((p) => {
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
            }),
          };
        }),
      );
      return;
    }

    if (mode === 'winner' && games) {
      const next: typeof rows = [];
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
            next.push({
              id: s.id,
              fileName: `${s.rank}_${s.name}`,
              email: p?.email ?? undefined,
              row: winnerToRow(s, {
                tournament: tournament.name,
                date: dateStr,
                category: 'Overall',
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
              next.push({
                id: `${cat.id}:${s.id}`,
                fileName: `${cat.name}_${s.rank}_${s.name}`,
                email: p?.email ?? undefined,
                row: winnerToRow(s, {
                  tournament: tournament.name,
                  date: dateStr,
                  category: cat.name,
                }),
              });
            }
          } catch {
            /* ignore */
          }
        }
      }
      setRows(next);
    }
  }, [tournament, participants, categories, games, mode]);

  useEffect(() => {
    if (mode === 'csv') return;
    rebuildTournamentRows();
  }, [mode, rebuildTournamentRows]);

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
      setMessage(`Template loaded (${Math.round(size.pageWidth)}×${Math.round(size.pageHeight)} pt)`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read PDF');
    }
  }

  function clearTemplate() {
    setTemplateBytes(null);
    setLayout(null);
    setFields([]);
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
      fontSize: 22,
      align: 'center',
      color: '#1a1208',
      font: 'Helvetica-Bold',
    };
    setSelectedColumn(column);
    setFields((prev) => [...prev, field]);
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
    setBusy(true);
    setError(null);
    try {
      const full: CertificateLayout = { ...layout, fields };
      const batch = await generateCertificateBatch(
        templateBytes,
        full,
        rows.map((r) => ({ id: r.id, fileName: r.fileName, row: r.row })),
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

  async function issueDigitalAndEmail(alsoEmail: boolean) {
    if (!tournamentId) {
      setHighlightTournamentPicker(true);
      setError('Choose which tournament these certificates belong to before issuing.');
      return;
    }
    if (!templateBytes || !layout || rows.length === 0) {
      setError('Need a template, fields, and recipients');
      return;
    }
    setBusy(true);
    setError(null);
    setIssuedSummary(null);
    try {
      const full: CertificateLayout = { ...layout, fields };
      const batch = await generateCertificateBatch(
        templateBytes,
        full,
        rows.map((r) => ({ id: r.id, fileName: r.fileName, row: r.row })),
      );

      const items = batch.digital.map((d, i) => {
        const src = rows[i]!;
        const participantId = src.id.includes(':') ? src.id.split(':')[1]! : src.id;
        return {
          participantId: /^[0-9a-f-]{36}$/i.test(participantId) ? participantId : null,
          type: (mode === 'winner' ? 'winner' : 'participation') as 'participation' | 'winner',
          rank: typeof src.row.rank === 'number' ? src.row.rank : Number(src.row.rank) || null,
          recipientEmail: src.email || null,
          recipientName: String(src.row.name ?? src.fileName),
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
      let summary = `Stored ${issueRes.data.issued} digital certificates to ${where}`;
      if (alsoEmail) {
        const emailRes = await apiEmailCertificates(tournamentId, { allPending: true });
        if (!emailRes.ok) {
          throw new Error(emailRes.error ?? 'Email failed');
        }
        summary += ` · emailed ${emailRes.data.sent}, failed ${emailRes.data.failed}`;
      }
      setIssuedSummary(summary);
      setMessage(summary);
      await apiListCertificates(tournamentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Digital issue failed');
    } finally {
      setBusy(false);
    }
  }

  async function updateAwardSettings(prizePlaces: number, awardScope: 'overall' | 'per_category') {
    if (!tournamentId || !tournament) return;
    await db.tournaments.update(tournamentId, {
      prizePlaces,
      awardScope,
      updatedAt: nowIso(),
      dirty: 1,
    });
  }

  const sample = rows[0]?.row;

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
            Required before Issue digital / Issue + email. With a tournament selected, participants
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
          <span className="form-hint">{rows.length} recipient(s)</span>
        </div>
      )}

      <div className="cert-workspace">
        <aside className="cert-sidebar">
          <h3>Data columns</h3>
          <p className="cert-sidebar-lead">
            Pick a column below, then click the certificate to place it. Selected column is
            highlighted.
          </p>
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
              <li key={f.id}>
                <span>
                  <span className="cert-field-name">{certificateColumnLabel(f.sourceColumn)}</span>
                  <span className="cert-field-key">{f.sourceColumn}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFields((prev) => prev.filter((x) => x.id !== f.id))}
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
              disabled={busy || !templateBytes || fields.length === 0 || rows.length === 0}
              onClick={() => void exportPhysical()}
            >
              Download print pack
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={busy || !templateBytes || fields.length === 0 || rows.length === 0}
              onClick={() => void issueDigitalAndEmail(false)}
            >
              Issue digital
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !templateBytes || fields.length === 0 || rows.length === 0}
              onClick={() => void issueDigitalAndEmail(true)}
            >
              Issue + email
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
              onPlace={placeFieldAt}
              onMoveField={moveField}
              onSelectColumn={setSelectedColumn}
            />
          )}
        </div>
      </div>
    </div>
  );
}
