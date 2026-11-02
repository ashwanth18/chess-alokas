import type {
  PublicRegistrationForm,
  RegistrationCustomQuestion,
  RegistrationFormConfig,
} from './types.js';

/** The field name of the standard age proof upload among an entry's private files. */
export const AGE_PROOF_FIELD = 'ageProof';

export const REGISTRATION_FORM_LIMITS = {
  /** Questions on the form. Hidden ones don't count. */
  questions: 30,
  /** File questions on the form, on top of age proof and the payment receipt. */
  fileQuestions: 3,
  labelChars: 200,
  options: 50,
  optionChars: 100,
  textAnswerChars: 1000,
} as const;

/** "T-shirt size / Saiz baju", or the English alone when there's no Malay label. */
export function bilingualLabel(q: { label: string; labelMs?: string | null }): string {
  const malay = q.labelMs?.trim();
  return malay ? `${q.label} / ${malay}` : q.label;
}

/** Standard labels. Malay appears only when the organizer switches it on. */
export const STANDARD_FIELD_LABELS = {
  name: { label: 'Full name', labelMs: 'Nama penuh' },
  nameAsInNric: { label: 'Name (as in NRIC)', labelMs: 'Nama (seperti dalam NRIC)' },
  yearOfBirth: { label: 'Year of birth', labelMs: 'Tahun lahir' },
  gender: { label: 'Gender', labelMs: 'Jantina' },
  category: { label: 'Category', labelMs: 'Kategori' },
  fideId: { label: 'FIDE ID', labelMs: 'ID FIDE' },
  rating: { label: 'Rating', labelMs: 'Mata rating' },
  school: { label: 'School', labelMs: 'Sekolah' },
  club: { label: 'Club or academy', labelMs: 'Kelab atau akademi' },
  city: { label: 'City', labelMs: 'Bandar' },
  state: { label: 'State', labelMs: 'Negeri' },
  email: { label: 'Email', labelMs: 'E-mel' },
  phone: { label: 'Contact number', labelMs: 'No. telefon' },
  nric: { label: 'NRIC number', labelMs: 'No. kad pengenalan' },
  ageProof: {
    label: 'Age proof (NRIC or birth certificate)',
    labelMs: 'Bukti umur (kad pengenalan atau sijil lahir)',
  },
} as const;

export type StandardFieldKey = keyof typeof STANDARD_FIELD_LABELS;

export function standardLabel(field: StandardFieldKey, malay: boolean): string {
  const entry = STANDARD_FIELD_LABELS[field];
  return malay ? bilingualLabel(entry) : entry.label;
}

/** Numbers are stored as typed by the parent, so this needs only the last four characters. */
export function maskNric(value: string | null | undefined): string | null {
  const clean = value?.trim();
  if (!clean) return null;
  return `******-**-${clean.replace(/[^0-9A-Za-z]/g, '').slice(-4)}`;
}

/**
 * 12 digits become YYMMDD-PB-####. A passport number is kept as typed, because children without an
 * NRIC still play. Returns null for anything that can't be either.
 */
export function normalizeNric(raw: string): string | null {
  const trimmed = raw.trim().toUpperCase();
  const digits = trimmed.replace(/[\s-]/g, '');
  if (/^\d{12}$/.test(digits)) {
    return `${digits.slice(0, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
  }
  return /^[A-Z0-9][A-Z0-9 -]{4,18}[A-Z0-9]$/.test(trimmed) ? trimmed : null;
}

const ID_COLUMN = /(^|[^a-z])(nric|ic|i\/c|mykad|mykid|passport|pasport|kad pengenalan|identification|no\.?\s*kp)([^a-z]|$)/i;
const NOT_AN_ID_COLUMN = /phone|tel|contact|whatsapp|mobile|\bhp\b/i;
const NRIC_SHAPE = /^\d{6}[-\s]?\d{2}[-\s]?\d{4}$/;

/**
 * Roster custom fields keep a masked copy of anything that looks like an ID number: by its column
 * name, or by its shape. Imported spreadsheets carry them, and rosters reach more people than entries.
 */
export function maskNricFields(fields: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    const looksLikeId =
      text !== '' && !NOT_AN_ID_COLUMN.test(key) && (ID_COLUMN.test(key) || NRIC_SHAPE.test(text));
    out[key] = looksLikeId ? maskNric(text) : value;
  }
  return out;
}

/** What public pages and the apps get: no hidden questions, no retired options. */
export function publicRegistrationForm(config: RegistrationFormConfig): PublicRegistrationForm {
  const visible = (config.customQuestions ?? []).filter((q) => !q.hidden);
  return {
    collectSchool: config.collectSchool ?? true,
    collectFideId: config.collectFideId ?? true,
    collectPhone: config.collectPhone ?? true,
    collectNric: config.collectNric ?? false,
    collectAgeProof: config.collectAgeProof ?? false,
    malayLabels: config.malayLabels ?? false,
    questions: visible.map((q) => ({
      id: q.id,
      label: q.label,
      labelMs: q.labelMs?.trim() || null,
      type: q.type,
      required: q.required,
      ...(q.type === 'select' ? { options: q.options ?? [] } : {}),
    })),
    customQuestions: visible.flatMap((q) =>
      q.type === 'text' || q.type === 'select'
        ? [
            {
              id: q.id,
              label: bilingualLabel(q),
              type: q.type,
              required: q.required,
              ...(q.type === 'select' ? { options: q.options ?? [] } : {}),
            },
          ]
        : [],
    ),
  };
}

/** Answers on one question, and on each dropdown option, among the entries given. */
export function countRegistrationAnswers(
  questions: RegistrationCustomQuestion[],
  registrations: Array<{
    customAnswers?: Record<string, unknown> | null;
    privateFiles?: Array<{ field: string }> | null;
  }>,
): Record<string, { answers: number; options: Record<string, number> }> {
  const counts: Record<string, { answers: number; options: Record<string, number> }> = {};
  for (const q of questions) counts[q.id] = { answers: 0, options: {} };
  for (const reg of registrations) {
    for (const q of questions) {
      const entry = counts[q.id]!;
      if (q.type === 'file') {
        if (reg.privateFiles?.some((f) => f.field === q.id)) entry.answers += 1;
        continue;
      }
      const answer = reg.customAnswers?.[q.id];
      if (answer === undefined || answer === null || answer === '') continue;
      entry.answers += 1;
      if (typeof answer === 'string') entry.options[answer] = (entry.options[answer] ?? 0) + 1;
    }
  }
  return counts;
}
