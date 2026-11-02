import {
  AGE_PROOF_FIELD,
  bilingualLabel,
  publicRegistrationForm,
  type PublicRegistrationForm,
  type RegistrationCustomQuestion,
  type RegistrationFormConfig,
  type RegistrationQuestionType,
  type TournamentRegistration,
} from '@chess-alokas/shared';

export const QUESTION_TYPE_LABELS: Record<RegistrationQuestionType, string> = {
  text: 'Short answer',
  select: 'Dropdown',
  checkbox: 'Checkbox',
  file: 'File upload',
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf';

export function newQuestion(type: RegistrationQuestionType = 'text'): RegistrationCustomQuestion {
  return {
    id: `q_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    label: '',
    labelMs: null,
    type,
    required: false,
    ...(type === 'select' ? { options: [] } : {}),
  };
}

/** Moves a question past its nearest visible neighbour, so hidden ones don't swallow a click. */
export function moveQuestion(
  questions: RegistrationCustomQuestion[],
  id: string,
  direction: -1 | 1,
): RegistrationCustomQuestion[] {
  const next = [...questions];
  const from = next.findIndex((q) => q.id === id);
  if (from < 0) return questions;
  let to = from + direction;
  while (to >= 0 && to < next.length && next[to]!.hidden) to += direction;
  if (to < 0 || to >= next.length) return questions;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** A text question asking for an ID number would put it on the roster, in the open. */
export function looksLikeIdQuestion(label: string): boolean {
  return /\b(nric|i\/?c|mykad|mykid|passport|pasport|kad pengenalan)\b/i.test(label);
}

/** A one-line account of the form, for the organizer who has no need to open the editor. */
export function formSummary(form: RegistrationFormConfig): string {
  const always = ['Name', 'Year of birth', 'Gender', 'Category', 'Email'];
  const extra = [
    form.collectSchool ? 'School' : null,
    form.collectFideId ? 'FIDE ID' : null,
    form.collectPhone ? 'Contact number' : null,
    form.collectNric ? 'NRIC number' : null,
    form.collectAgeProof ? 'Age proof' : null,
  ].filter(Boolean);
  const questions = (form.customQuestions ?? []).filter((q) => !q.hidden).length;
  const own = questions === 0 ? '' : questions === 1 ? ', 1 question of yours' : `, ${questions} questions of yours`;
  return `${[...always, ...extra].join(', ')}${own}.`;
}

/** The form as saved on a tournament row or sent to a parent, in the shape the form renders. */
export function asPublicForm(
  form: RegistrationFormConfig | PublicRegistrationForm | null | undefined,
): PublicRegistrationForm {
  if (form && 'questions' in form && Array.isArray(form.questions)) return form;
  return publicRegistrationForm((form ?? {}) as RegistrationFormConfig);
}

export function registrationLink(slugOrId: string, isDesktop: boolean, origin: string): string {
  const base = isDesktop ? 'https://chess-manager.alokas.com' : origin;
  return `${base}/register/${encodeURIComponent(slugOrId)}`;
}

export function whatsappHref(eventName: string, link: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${eventName}: register here ${link}`)}`;
}

/** For `<input type="datetime-local">`, in the organizer's own time zone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A label for an answer in the queue. Hidden questions are included, so old answers still read. */
export function questionLabel(form: RegistrationFormConfig | null | undefined, field: string): string {
  if (field === AGE_PROOF_FIELD) return 'Age proof';
  const q = form?.customQuestions?.find((c) => c.id === field);
  return q ? bilingualLabel(q) : 'Answer to a removed question';
}

export function answerText(value: unknown): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (value === null || value === undefined) return '';
  return String(value);
}

/** Where an entry came from, as far as the row can say. An app and a signed-in browser look alike. */
export function entrySource(reg: Pick<TournamentRegistration, 'submittedByUserId'>): string {
  return reg.submittedByUserId ? 'Signed-in account' : 'Link, no account';
}

/** A spreadsheet runs a cell starting with these as a formula. */
function csvCell(raw: unknown): string {
  let text = answerText(raw);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Every entry with its answers. NRIC numbers and file contents stay out: an export goes wherever
 * the organizer's laptop sends it. It only says whether a file was attached.
 */
export function entriesCsv(
  registrations: TournamentRegistration[],
  form: RegistrationFormConfig | null | undefined,
  categoryNames: Record<string, string>,
): string {
  const questions = form?.customQuestions ?? [];
  const answerQuestions = questions.filter((q) => q.type !== 'file');
  const fileQuestions = questions.filter((q) => q.type === 'file');
  const head = [
    'Submitted',
    'Name',
    'Status',
    'Payment',
    'Category',
    'Year of birth',
    'Gender',
    'School',
    'Club',
    'City',
    'State',
    'Email',
    'Contact number',
    'FIDE ID',
    'Rating',
    ...answerQuestions.map(bilingualLabel),
    ...(form?.collectAgeProof ? ['Age proof attached'] : []),
    ...fileQuestions.map((q) => `${bilingualLabel(q)} (attached)`),
  ];
  const rows = registrations.map((r) => {
    const s = r.playerSnapshot;
    const attached = (field: string) => (r.files?.some((f) => f.field === field) ? 'Yes' : 'No');
    return [
      r.createdAt,
      s.name,
      r.status,
      r.paymentStatus,
      r.selectedCategoryId ? (categoryNames[r.selectedCategoryId] ?? '') : '',
      s.yearOfBirth,
      s.gender,
      s.school,
      s.club,
      s.city,
      s.state,
      s.email,
      s.phone,
      s.fideId,
      s.rating,
      ...answerQuestions.map((q) => r.customAnswers?.[q.id]),
      ...(form?.collectAgeProof ? [attached(AGE_PROOF_FIELD)] : []),
      ...fileQuestions.map((q) => attached(q.id)),
    ];
  });
  return [head, ...rows].map((cells) => cells.map(csvCell).join(',')).join('\r\n');
}

/** Reads a file for upload, refusing what the server would refuse anyway. */
export function readUpload(file: File): Promise<{ dataUrl: string } | { error: string }> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return Promise.resolve({ error: 'That file is over 5 MB. Choose a smaller one.' });
  }
  if (!UPLOAD_ACCEPT.split(',').includes(file.type)) {
    return Promise.resolve({ error: 'Use a PNG, JPEG, WebP or PDF file.' });
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(
        typeof reader.result === 'string'
          ? { dataUrl: reader.result }
          : { error: 'That file could not be read.' },
      );
    reader.onerror = () => resolve({ error: 'That file could not be read.' });
    reader.readAsDataURL(file);
  });
}
