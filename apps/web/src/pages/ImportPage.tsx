import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import Papa from 'papaparse';
import { matchesFilter } from '@chess-alokas/shared';
import { db, nowIso } from '../db/local';
import { getTournamentCapabilities, isMixedTournament } from '../lib/tournamentProgress';
import {
  categoryNameMatchesLabel,
  findAgeCategoryInRow,
  findNricInRow,
  isNumericAgeColumn,
  normalizeGender,
  resolveImportAge,
  resolveYearOfBirth,
} from '../lib/importParse';

interface RawRow {
  [key: string]: unknown;
}

interface MappedParticipant {
  name: string;
  age: number;
  gender?: string;
  rating?: number;
  club?: string;
  school?: string;
  city?: string;
  state?: string;
  country?: string;
  yearOfBirth?: number | null;
  email?: string;
  ageCategoryLabel?: string;
  customFields: Record<string, unknown>;
  [key: string]: unknown;
}

const REQUIRED_FIELDS = ['name'] as const;
const OPTIONAL_FIELDS = [
  'age',
  'gender',
  'rating',
  'school',
  'club',
  'city',
  'state',
  'country',
  'yearOfBirth',
  'email',
] as const;
const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS] as const;

const FIELD_LABELS: Record<(typeof ALL_FIELDS)[number], string> = {
  name: 'Name',
  age: 'Age',
  gender: 'Gender',
  rating: 'FIDE rating',
  school: 'School',
  club: 'Club (legacy)',
  city: 'City',
  state: 'State',
  country: 'Country',
  yearOfBirth: 'Year of birth',
  email: 'Email',
};

function findColumn(cols: string[], patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const hit = cols.find((c) => re.test(c));
    if (hit) return hit;
  }
  return undefined;
}

/** XLSX cells are often numbers; CSV is strings — normalize before trim/parse. */
function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return String(value).trim();
}

function parseRows(raw: RawRow[], mapping: Record<string, string>): MappedParticipant[] {
  return raw
    .filter((row) => {
      const nameCol = mapping['name'];
      return Boolean(nameCol && cellText(row[nameCol]));
    })
    .map((row) => {
      const nameCol = mapping['name'] ?? '';
      const ageCol = mapping['age'] ?? '';
      const name = cellText(row[nameCol]);
      const ageRaw = ageCol ? cellText(row[ageCol]) : '';
      const ageCategoryLabel = findAgeCategoryInRow(row, cellText);
      const nric = findNricInRow(row, cellText);
      const age = resolveImportAge({ ageRaw, ageCategoryLabel, nric });
      const genderCol = mapping['gender'];
      const gender = genderCol
        ? normalizeGender(cellText(row[genderCol])) || undefined
        : undefined;
      const ratingCol = mapping['rating'];
      const ratingRaw = ratingCol ? cellText(row[ratingCol]) : '';
      const rating = ratingRaw ? parseInt(ratingRaw, 10) || undefined : undefined;
      const schoolCol = mapping['school'];
      const school = schoolCol ? cellText(row[schoolCol]) || undefined : undefined;
      const clubCol = mapping['club'];
      const club = clubCol ? cellText(row[clubCol]) || undefined : undefined;
      const cityCol = mapping['city'];
      const city = cityCol ? cellText(row[cityCol]) || undefined : undefined;
      const stateCol = mapping['state'];
      const state = stateCol ? cellText(row[stateCol]) || undefined : undefined;
      const countryCol = mapping['country'];
      const countryRaw = countryCol ? cellText(row[countryCol]) : '';
      const country = countryRaw || 'Malaysia';
      const yobCol = mapping['yearOfBirth'];
      const yearOfBirth = resolveYearOfBirth({
        yearRaw: yobCol ? cellText(row[yobCol]) : '',
        nric,
      });
      const emailCol = mapping['email'];
      const email = emailCol ? cellText(row[emailCol]) || undefined : undefined;

      const customFields: Record<string, unknown> = {};
      for (const [col, val] of Object.entries(row)) {
        const isMapped = Object.values(mapping).includes(col);
        const text = cellText(val);
        if (!isMapped && text) {
          customFields[col] = text;
        }
      }

      return {
        name,
        age,
        gender,
        rating,
        school: school || club,
        club,
        city,
        state,
        country,
        yearOfBirth,
        email,
        ageCategoryLabel,
        customFields,
      };
    });
}

export default function ImportPage() {
  const { id: tournamentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const lateQuery = searchParams.get('late') === '1';

  const [dragging, setDragging] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<RawRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [lateConfirmed, setLateConfirmed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const caps =
    tournament && categories && participants && games
      ? getTournamentCapabilities(tournament, categories, participants, games)
      : null;

  const requiresLateWarning = Boolean(
    caps?.importRequiresLateWarning || lateQuery,
  );

  useEffect(() => {
    if (caps && !caps.canImport && tournamentId) {
      const t = window.setTimeout(() => {
        navigate(`/tournaments/${tournamentId}`, { replace: true });
      }, 2200);
      return () => window.clearTimeout(t);
    }
  }, [caps, tournamentId, navigate]);

  function autoDetectMapping(cols: string[]): Record<string, string> {
    const detected: Record<string, string> = {};

    const name = findColumn(cols, [/^name$/i, /full\s*name/i, /\bnama\b/i, /player\s*name/i]);
    if (name) detected.name = name;

    const gender = findColumn(cols, [/gender/i, /\bsex\b/i, /jantina/i, /m\/f/i]);
    if (gender) detected.gender = gender;

    const rating = findColumn(cols, [/fide/i, /\brating\b/i, /\belo\b/i, /\brtg\b/i]);
    if (rating) detected.rating = rating;

    const school = findColumn(cols, [/school/i, /sekolah/i, /academy/i]);
    if (school) detected.school = school;

    const club = findColumn(cols, [/\bclub\b/i, /\bteam\b/i, /federation/i]);
    if (club && club !== school) detected.club = club;

    const city = findColumn(cols, [/\bcity\b/i, /bandar/i, /town/i]);
    if (city) detected.city = city;

    const state = findColumn(cols, [/\bstate\b/i, /negeri/i, /province/i]);
    if (state) detected.state = state;

    const country = findColumn(cols, [/country/i, /negara/i]);
    if (country) detected.country = country;

    const yob = findColumn(cols, [/year\s*of\s*birth/i, /\byob\b/i, /birth\s*year/i, /tahun\s*lahir/i]);
    if (yob) detected.yearOfBirth = yob;

    const email = findColumn(cols, [/e-?mail/i]);
    if (email) detected.email = email;

    // Prefer a true numeric age column; never map "AGE CATEGORY" → age.
    const ageIdx = cols.findIndex((c) => isNumericAgeColumn(c));
    if (ageIdx !== -1 && cols[ageIdx] !== undefined) {
      detected.age = cols[ageIdx]!;
    }

    return detected;
  }

  function processFile(file: File) {
    setImportError(null);
    setImportedCount(null);

    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      import('xlsx')
        .then((XLSX) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) {
              setImportError('No sheets found');
              return;
            }
            const sheet = workbook.Sheets[sheetName]!;
            const json = (XLSX.utils.sheet_to_json(sheet, { defval: '' }) as unknown) as RawRow[];
            if (json.length === 0) {
              setImportError('Spreadsheet appears empty');
              return;
            }
            const cols = Object.keys(json[0] ?? {});
            setColumns(cols);
            setRawRows(json);
            setMapping(autoDetectMapping(cols));
          };
          reader.readAsArrayBuffer(file);
        })
        .catch(() => {
          setImportError('Could not load XLSX parser. Try a CSV file instead.');
        });
      return;
    }

    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        if (!results.data.length) {
          setImportError('CSV appears empty');
          return;
        }
        const cols = results.meta.fields ?? [];
        setColumns(cols);
        setRawRows(results.data);
        setMapping(autoDetectMapping(cols));
      },
      error(err) {
        setImportError(`Parse error: ${err.message}`);
      },
    });
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const preview = rawRows.length > 0 ? parseRows(rawRows.slice(0, 5), mapping) : [];
  const total = rawRows.length > 0 ? parseRows(rawRows, mapping).length : 0;

  async function handleImport() {
    if (!tournamentId || rawRows.length === 0) return;
    if (caps && !caps.canImport) {
      setImportError('This tournament is complete. Import is locked.');
      return;
    }
    if (requiresLateWarning && !lateConfirmed) {
      setImportError('Confirm that you understand late entries won’t join past rounds.');
      return;
    }

    setImporting(true);
    setImportError(null);

    try {
      const parsed = parseRows(rawRows, mapping);
      const now = nowIso();

      for (const p of parsed) {
        const pid = crypto.randomUUID();
        const catIds =
          categories
            ?.filter(
              (cat) =>
                matchesFilter(p, cat.filter) ||
                (p.ageCategoryLabel
                  ? categoryNameMatchesLabel(cat.name, p.ageCategoryLabel)
                  : false),
            )
            .map((cat) => cat.id) ?? [];

        await db.participants.put({
          id: pid,
          tournamentId,
          name: p.name,
          age: p.age,
          gender: p.gender ?? null,
          rating: p.rating ?? null,
          club: p.club ?? null,
          school: p.school ?? null,
          city: p.city ?? null,
          state: p.state ?? null,
          country: p.country ?? 'Malaysia',
          yearOfBirth: p.yearOfBirth ?? null,
          email: p.email ?? null,
          customFields: p.customFields,
          categoryIds: catIds,
          updatedAt: now,
          dirty: 1,
        });
      }

      setImportedCount(parsed.length);
      setTimeout(() => navigate(`/tournaments/${tournamentId}`), 1500);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  if (caps && !caps.canImport) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1>Import Players</h1>
          <Link to={`/tournaments/${tournamentId}`} className="btn btn-ghost">
            ← Back
          </Link>
        </div>
        <div className="stage-banner stage-banner-done">
          This tournament is complete. Player import is locked.
        </div>
        <p className="form-hint">Returning to the tournament…</p>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{requiresLateWarning ? 'Late Entry Import' : 'Import Players'}</h1>
        <button className="btn btn-ghost" onClick={() => navigate(-1)}>
          ← Back
        </button>
      </div>

      {requiresLateWarning && (
        <div className="stage-banner stage-banner-warn late-entry-panel">
          <strong>Round 1 has started.</strong>
          <p>
            New players will be appended only. They will not be paired into past rounds
            {tournament && isMixedTournament(tournament)
              ? ''
              : ' for their category'}
            . Use this only for genuine late registrations.
          </p>
          <label className="late-confirm">
            <input
              type="checkbox"
              checked={lateConfirmed}
              onChange={(e) => setLateConfirmed(e.target.checked)}
            />
            I understand these are late entries and won’t appear in finished rounds.
          </label>
        </div>
      )}

      {importedCount !== null ? (
        <div className="success-banner">
          ✓ Imported {importedCount} participants successfully!
        </div>
      ) : (
        <>
          {rawRows.length === 0 && (
            <div
              className={`drop-zone ${dragging ? 'dragging' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
            >
              <span className="drop-icon">📄</span>
              <p className="drop-title">Drop CSV or XLSX here</p>
              <p className="drop-hint">or click to browse</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
            </div>
          )}

          {importError && <div className="form-error">{importError}</div>}

          {rawRows.length > 0 && (
            <>
              <section className="mapping-section">
                <h3>Column Mapping</h3>
                <p className="form-hint">
                  Map your file&apos;s columns to participant fields. Name is required. Age and year of
                  birth can be inferred from NRIC. Country defaults to Malaysia.
                </p>
                <div className="mapping-grid">
                  {ALL_FIELDS.map((field) => (
                    <div key={field} className="mapping-row">
                      <label className="mapping-label">
                        {FIELD_LABELS[field]}
                        {REQUIRED_FIELDS.includes(field as never) && (
                          <span className="required-star">*</span>
                        )}
                      </label>
                      <select
                        className="input input-sm"
                        value={mapping[field] ?? ''}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [field]: e.target.value }))
                        }
                      >
                        <option value="">— skip —</option>
                        {columns.map((col) => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </section>

              {preview.length > 0 && (
                <section className="preview-section">
                  <h3>Preview (first {preview.length} rows)</h3>
                  <table className="data-table preview-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Age</th>
                        <th>Gender</th>
                        <th>Rating</th>
                        <th>Club</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((p, i) => (
                        <tr key={i}>
                          <td>{p.name || <em className="missing">missing</em>}</td>
                          <td>{p.age || <em className="missing">?</em>}</td>
                          <td>{p.gender ?? '—'}</td>
                          <td>{p.rating ?? '—'}</td>
                          <td>{p.club ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="form-hint">{total} rows total</p>
                </section>
              )}

              <div className="form-actions">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setRawRows([]);
                    setColumns([]);
                    setMapping({});
                  }}
                >
                  Clear
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={
                    importing ||
                    !mapping['name'] ||
                    !mapping['age'] ||
                    (requiresLateWarning && !lateConfirmed)
                  }
                >
                  {importing
                    ? 'Importing…'
                    : requiresLateWarning
                      ? `Import ${total} late entries`
                      : `Import ${total} Players`}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
