import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { ColumnMapping } from '@chess-alokas/shared';

export interface ParsedParticipantRow {
  name: string;
  age: number;
  gender: string | null;
  rating: number | null;
  club: string | null;
  customFields: Record<string, unknown>;
}

/**
 * Parse a CSV or XLSX buffer into participant rows using the given column mapping.
 * Columns not referenced by the mapping are collected into `customFields`.
 */
export function parseParticipantsFile(
  buffer: Buffer,
  filename: string,
  mapping: ColumnMapping,
): ParsedParticipantRow[] {
  const rawRows = readRawRows(buffer, filename);
  return rawRows
    .map((row) => mapRow(row, mapping))
    .filter((row): row is ParsedParticipantRow => row !== null);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readRawRows(buffer: Buffer, filename: string): Record<string, unknown>[] {
  const ext = filename.toLowerCase().split('.').pop() ?? '';

  if (ext === 'csv' || ext === 'txt') {
    const text = buffer.toString('utf-8');
    const result = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });
    if (result.errors.length > 0) {
      const first = result.errors[0];
      throw new Error(`CSV parse error: ${first?.message ?? 'unknown'}`);
    }
    return result.data;
  }

  if (ext === 'xlsx' || ext === 'xls' || ext === 'ods') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('Spreadsheet has no sheets');
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
      raw: false,
    });
  }

  throw new Error(`Unsupported file format: .${ext}`);
}

function mapRow(
  row: Record<string, unknown>,
  mapping: ColumnMapping,
): ParsedParticipantRow | null {
  const name = str(row[mapping.name]).trim();
  if (!name) return null; // skip rows with no name

  const ageRaw = row[mapping.age];
  const age = Math.max(0, Math.round(Number(ageRaw)));
  if (isNaN(age)) return null;

  const gender = mapping.gender ? str(row[mapping.gender]).trim() || null : null;

  const rating =
    mapping.rating && row[mapping.rating] !== '' && row[mapping.rating] != null
      ? toIntOrNull(row[mapping.rating])
      : null;

  const club =
    mapping.club ? str(row[mapping.club]).trim() || null : null;

  // Gather all non-mapped columns into customFields
  const mappedCols = new Set(
    [mapping.name, mapping.age, mapping.gender, mapping.rating, mapping.club].filter(
      (v): v is string => v != null && v !== '',
    ),
  );
  const customFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!mappedCols.has(key)) {
      customFields[key] = value;
    }
  }

  return { name, age, gender, rating, club, customFields };
}

function str(v: unknown): string {
  if (v == null) return '';
  return String(v);
}

function toIntOrNull(v: unknown): number | null {
  const n = Number(v);
  if (isNaN(n)) return null;
  return Math.round(n);
}
