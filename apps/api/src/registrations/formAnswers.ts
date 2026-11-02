import {
  AGE_PROOF_FIELD,
  REGISTRATION_FORM_LIMITS,
  RegistrationQuestionTypeSchema,
  bilingualLabel,
  countRegistrationAnswers,
  normalizeNric,
  standardLabel,
  type RegistrationCustomQuestion,
  type RegistrationFormConfig,
} from '@chess-alokas/shared';
import { z } from 'zod';
import { MAX_RECEIPT_BYTES, decodeReceiptDataUrl, type DecodedReceipt } from './receipts.js';

const MAX_MB = Math.floor(MAX_RECEIPT_BYTES / (1024 * 1024));

/** Older app builds have no upload or NRIC box, so a parent must be told what to do next. */
const OLD_APP_HINT = 'If your app doesn’t ask for this, update it or register on the event’s web link.';

const FILE_RULE = `must be a PNG, JPEG, WebP or PDF file of at most ${MAX_MB} MB.`;

/** Question ids become object keys on entries and participants, next to these. */
const RESERVED_QUESTION_IDS = new Set(['__proto__', 'constructor', 'prototype', 'checkedIn', 'phone']);

const questionId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'Question ids may use letters, numbers, - and _')
  .refine((id) => !RESERVED_QUESTION_IDS.has(id), 'That question id is reserved');

const optionalLabel = z
  .string()
  .trim()
  .max(REGISTRATION_FORM_LIMITS.labelChars)
  .nullable()
  .optional();

/** What an organizer may save. Reads stay on the looser shared schema, so old rows always load. */
export const RegistrationFormInputSchema = z
  .object({
    collectSchool: z.boolean().default(true),
    collectFideId: z.boolean().default(true),
    collectPhone: z.boolean().default(true),
    collectNric: z.boolean().default(false),
    collectAgeProof: z.boolean().default(false),
    malayLabels: z.boolean().default(false),
    customQuestions: z
      .array(
        z.object({
          id: questionId,
          label: z.string().trim().min(1).max(REGISTRATION_FORM_LIMITS.labelChars),
          labelMs: optionalLabel,
          type: RegistrationQuestionTypeSchema.default('text'),
          required: z.boolean().default(false),
          options: z
            .array(z.string().trim().min(1).max(REGISTRATION_FORM_LIMITS.optionChars))
            .max(REGISTRATION_FORM_LIMITS.options)
            .optional(),
          hidden: z.boolean().optional(),
        }),
      )
      .max(REGISTRATION_FORM_LIMITS.questions * 3)
      .default([]),
  })
  .superRefine((form, ctx) => {
    const seen = new Set<string>();
    const visible = form.customQuestions.filter((q) => !q.hidden);
    form.customQuestions.forEach((q, i) => {
      if (seen.has(q.id)) {
        ctx.addIssue({ code: 'custom', path: ['customQuestions', i, 'id'], message: 'Duplicate question id' });
      }
      seen.add(q.id);
      if (q.type === 'select' && !q.hidden && !q.options?.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['customQuestions', i, 'options'],
          message: `“${q.label}” needs at least one option.`,
        });
      }
    });
    if (visible.length > REGISTRATION_FORM_LIMITS.questions) {
      ctx.addIssue({
        code: 'custom',
        path: ['customQuestions'],
        message: `A form can have at most ${REGISTRATION_FORM_LIMITS.questions} questions.`,
      });
    }
    if (visible.filter((q) => q.type === 'file').length > REGISTRATION_FORM_LIMITS.fileQuestions) {
      ctx.addIssue({
        code: 'custom',
        path: ['customQuestions'],
        message: `A form can have at most ${REGISTRATION_FORM_LIMITS.fileQuestions} file upload questions.`,
      });
    }
  });

export class FormChangeRefused extends Error {}

/**
 * Applies an organizer's edit without destroying anything entries depend on: a removed question with
 * answers is hidden, a removed dropdown option with answers is retired, and neither can be undone by
 * changing a question's type under its answers.
 */
export function mergeRegistrationForm(
  previous: RegistrationFormConfig,
  next: z.output<typeof RegistrationFormInputSchema>,
  registrations: Parameters<typeof countRegistrationAnswers>[1],
): RegistrationFormConfig {
  const before = previous.customQuestions ?? [];
  const counts = countRegistrationAnswers(before, registrations);
  const beforeById = new Map(before.map((q) => [q.id, q]));
  const incomingIds = new Set(next.customQuestions.map((q) => q.id));

  const merged: RegistrationCustomQuestion[] = next.customQuestions.map((q) => {
    const prior = beforeById.get(q.id);
    const answered = counts[q.id]?.answers ?? 0;
    if (prior && prior.type !== q.type && answered > 0) {
      throw new FormChangeRefused(
        `“${prior.label}” already has answers, so its type can’t change. Add a new question instead.`,
      );
    }
    const options = q.type === 'select' ? [...new Set(q.options ?? [])] : undefined;
    const retired =
      q.type === 'select' && prior?.type === 'select'
        ? [
            ...new Set([
              ...(prior.retiredOptions ?? []),
              ...(prior.options ?? []).filter((o) => (counts[q.id]?.options[o] ?? 0) > 0),
            ]),
          ].filter((o) => !options?.includes(o))
        : [];
    return {
      id: q.id,
      label: q.label,
      labelMs: q.labelMs?.trim() || null,
      type: q.type,
      required: q.required,
      ...(options ? { options } : {}),
      ...(retired.length ? { retiredOptions: retired } : {}),
      ...(q.hidden ? { hidden: true } : {}),
    };
  });

  for (const q of before) {
    if (!incomingIds.has(q.id) && (counts[q.id]?.answers ?? 0) > 0) {
      merged.push({ ...q, hidden: true });
    }
  }

  return {
    collectSchool: next.collectSchool,
    collectFideId: next.collectFideId,
    collectPhone: next.collectPhone,
    collectNric: next.collectNric,
    collectAgeProof: next.collectAgeProof,
    malayLabels: next.malayLabels,
    customQuestions: merged,
  };
}

export interface RegistrationAnswerInput {
  customAnswers?: Record<string, unknown>;
  /** Question id to data URL, for file questions. */
  customFiles?: Record<string, unknown>;
  nricNumber?: string | null;
  ageProofDataUrl?: string | null;
}

export interface CheckedRegistrationAnswers {
  answers: Record<string, unknown>;
  nricNumber: string | null;
  files: Array<{ field: string; file: DecodedReceipt }>;
}

export class RegistrationAnswerError extends Error {}

function readText(q: RegistrationCustomQuestion, raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'number') return String(raw);
  if (typeof raw !== 'string') {
    throw new RegistrationAnswerError(`The answer to “${bilingualLabel(q)}” should be text.`);
  }
  return raw.trim();
}

/** A checkbox answer. App builds that predate checkboxes can't send one at all. */
function readCheckbox(q: RegistrationCustomQuestion, raw: unknown): boolean | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    if (/^(true|yes|ya|on|1)$/i.test(raw.trim())) return true;
    if (/^(false|no|tidak|off|0)$/i.test(raw.trim())) return false;
  }
  throw new RegistrationAnswerError(`The answer to “${bilingualLabel(q)}” should be a tick or no tick.`);
}

/**
 * The server's own check of an entry against the form. Answers to questions that aren't on the form
 * are dropped, never stored: a parent with a form open from before an edit shouldn't lose their entry
 * over a question the organizer has since removed. Anything the form still needs is refused, with text
 * a parent can act on, because the apps show this message as it is.
 */
export function checkRegistrationAnswers(
  form: RegistrationFormConfig,
  input: RegistrationAnswerInput,
): CheckedRegistrationAnswers {
  const answers: Record<string, unknown> = {};
  const files: CheckedRegistrationAnswers['files'] = [];
  const rawAnswers = input.customAnswers ?? {};
  const rawFiles = input.customFiles ?? {};

  for (const q of form.customQuestions ?? []) {
    if (q.hidden) continue;
    const name = bilingualLabel(q);
    const raw = Object.prototype.hasOwnProperty.call(rawAnswers, q.id) ? rawAnswers[q.id] : undefined;

    if (q.type === 'file') {
      const data = Object.prototype.hasOwnProperty.call(rawFiles, q.id) ? rawFiles[q.id] : undefined;
      if (data === undefined || data === null || data === '') {
        if (q.required) throw new RegistrationAnswerError(`Please attach “${name}”. ${OLD_APP_HINT}`);
        continue;
      }
      const file = typeof data === 'string' ? decodeReceiptDataUrl(data) : null;
      if (!file) throw new RegistrationAnswerError(`“${name}” ${FILE_RULE}`);
      files.push({ field: q.id, file });
      continue;
    }

    if (q.type === 'checkbox') {
      const ticked = readCheckbox(q, raw);
      if (q.required && ticked !== true) {
        throw new RegistrationAnswerError(`Please tick “${name}”. ${OLD_APP_HINT}`);
      }
      if (ticked !== null) answers[q.id] = ticked;
      continue;
    }

    const text = readText(q, raw);
    if (!text) {
      if (q.required) throw new RegistrationAnswerError(`Please answer “${name}”.`);
      continue;
    }
    if (q.type === 'select' && q.options?.length) {
      // A retired option was on the form when this parent opened it.
      if (!q.options.includes(text) && !q.retiredOptions?.includes(text)) {
        throw new RegistrationAnswerError(`“${text}” isn’t an option for “${name}”. Please choose again.`);
      }
    } else if (text.length > REGISTRATION_FORM_LIMITS.textAnswerChars) {
      throw new RegistrationAnswerError(
        `The answer to “${name}” is too long. Use at most ${REGISTRATION_FORM_LIMITS.textAnswerChars} characters.`,
      );
    }
    answers[q.id] = text;
  }

  let nricNumber: string | null = null;
  if (form.collectNric) {
    const typed = input.nricNumber?.trim();
    if (!typed) {
      throw new RegistrationAnswerError(
        `${standardLabel('nric', false)} is required for this event. ${OLD_APP_HINT}`,
      );
    }
    nricNumber = normalizeNric(typed);
    if (!nricNumber) {
      throw new RegistrationAnswerError(
        'That NRIC number doesn’t look right. Use 12 digits, or a passport number.',
      );
    }
  }

  if (form.collectAgeProof) {
    const data = input.ageProofDataUrl?.trim();
    if (!data) {
      throw new RegistrationAnswerError(
        `Please attach age proof (NRIC or birth certificate). ${OLD_APP_HINT}`,
      );
    }
    const file = decodeReceiptDataUrl(data);
    if (!file) throw new RegistrationAnswerError(`Age proof ${FILE_RULE}`);
    files.push({ field: AGE_PROOF_FIELD, file });
  }

  return { answers, nricNumber, files };
}
