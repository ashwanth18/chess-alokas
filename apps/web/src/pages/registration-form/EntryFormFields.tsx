import { useId, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  AGE_PROOF_FIELD,
  bilingualLabel,
  standardLabel,
  type PublicRegistrationForm,
  type PublicRegistrationQuestion,
  type StandardFieldKey,
} from '@chess-alokas/shared';
import { Field, IconCheck, IconFile, IconUpload, buttonClass } from '../../ui';
import { UPLOAD_ACCEPT } from './formLogic';

export interface EntryFormValues {
  name: string;
  yearOfBirth: string;
  gender: string;
  categoryId: string;
  fideId: string;
  rating: string;
  school: string;
  club: string;
  city: string;
  state: string;
  email: string;
  phone: string;
  nricNumber: string;
  answers: Record<string, string | boolean>;
}

export const EMPTY_ENTRY_FORM: EntryFormValues = {
  name: '',
  yearOfBirth: '',
  gender: '',
  categoryId: '',
  fideId: '',
  rating: '',
  school: '',
  club: '',
  city: '',
  state: '',
  email: '',
  phone: '',
  nricNumber: '',
  answers: {},
};

/** A file chosen on this device. Field is `ageProof`, a question id, or `receipt`. */
export interface ChosenFile {
  dataUrl: string;
  name: string;
}

export type SectionKey = 'player' | 'contact' | 'questions' | 'documents' | 'payment';

export interface SectionInfo {
  key: SectionKey;
  title: string;
  /** Every required answer is in, and at least one answer is given. */
  done: boolean;
}

const filled = (v: unknown) => (typeof v === 'string' ? v.trim() !== '' : v === true);

/** The sections this form has, in order, and which are complete. Review isn't one: it has no answers. */
export function entrySections(
  form: PublicRegistrationForm,
  values: EntryFormValues,
  files: Record<string, ChosenFile>,
  hasFee: boolean,
): SectionInfo[] {
  const answers = form.questions.filter((q) => q.type !== 'file');
  const docs = [
    ...(form.collectAgeProof ? [{ id: AGE_PROOF_FIELD, required: true }] : []),
    ...form.questions.filter((q) => q.type === 'file').map((q) => ({ id: q.id, required: q.required })),
  ];
  const complete = (items: Array<{ required: boolean; given: boolean }>) =>
    items.every((i) => !i.required || i.given) && items.some((i) => i.given);

  const out: SectionInfo[] = [
    {
      key: 'player',
      title: 'Player',
      done: filled(values.name) && (!form.collectNric || filled(values.nricNumber)),
    },
    { key: 'contact', title: 'Contact', done: filled(values.email) || filled(values.phone) },
  ];
  if (answers.length > 0) {
    out.push({
      key: 'questions',
      title: 'Event questions',
      done: complete(answers.map((q) => ({ required: q.required, given: filled(values.answers[q.id]) }))),
    });
  }
  if (docs.length > 0) {
    out.push({
      key: 'documents',
      title: 'Documents',
      done: complete(docs.map((d) => ({ required: d.required, given: Boolean(files[d.id]) }))),
    });
  }
  if (hasFee) out.push({ key: 'payment', title: 'Payment', done: Boolean(files.receipt) });
  return out;
}

/** One titled part of the form, numbered, with a mark once it is complete. */
export function FormSection({
  id,
  n,
  title,
  done,
  children,
}: {
  id: string;
  n: number;
  title: string;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="ui-card rg-section" id={id} aria-labelledby={`${id}-h`}>
      <header className="rg-section__head">
        <span className={`rg-section__n${done ? ' is-done' : ''}`} aria-hidden="true">
          {done ? <IconCheck size={14} /> : n}
        </span>
        <h2 id={`${id}-h`}>{title}</h2>
        {done && <span className="ui-vh">, complete</span>}
      </header>
      {children}
    </section>
  );
}

const isImage = (file: ChosenFile) => file.dataUrl.startsWith('data:image/');

/** A drop zone that is a real file input underneath, so click, keyboard, drop and validation all work. */
export function FileDrop({
  label,
  required,
  hint,
  file,
  onFile,
}: {
  label: ReactNode;
  required: boolean;
  hint: ReactNode;
  file?: ChosenFile;
  onFile: (file: File | null) => void;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const optional = !required && <span className="ui-field__optional"> optional</span>;
  return (
    <div className="ui-field rg-file">
      {file ? (
        <p className="ui-field__label">
          {label}
          {optional}
        </p>
      ) : (
        <label className="ui-field__label" htmlFor={id}>
          {label}
          {optional}
        </label>
      )}
      <span className="ui-field__hint" id={`${id}-hint`}>
        {hint}
      </span>
      {file ? (
        <div className="rg-file__chosen">
          {isImage(file) ? (
            <img className="rg-file__thumb" src={file.dataUrl} alt="" />
          ) : (
            <span className="rg-file__thumb rg-file__thumb--doc" aria-hidden="true">
              <IconFile size={24} />
            </span>
          )}
          <span className="rg-file__name">
            {file.name}
            <span className="rg-file__state">
              <IconCheck size={14} /> Attached
            </span>
          </span>
          <button
            type="button"
            className={buttonClass({ size: 'sm', variant: 'quiet' })}
            aria-label={`Remove ${file.name}`}
            onClick={() => onFile(null)}
          >
            Remove
          </button>
        </div>
      ) : (
        <div
          className={`rg-drop${over ? ' is-over' : ''}`}
          onDragEnter={() => setOver(true)}
          onDragLeave={() => setOver(false)}
          onDrop={() => setOver(false)}
        >
          <input
            id={id}
            type="file"
            accept={UPLOAD_ACCEPT}
            required={required}
            aria-describedby={`${id}-hint`}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onFile(e.target.files?.[0] ?? null)}
          />
          <span className="rg-drop__icon" aria-hidden="true">
            <IconUpload size={20} />
          </span>
          <span className="rg-drop__text">
            <span>
              <strong>Choose a file</strong> or drop it here
            </span>
            <span className="rg-drop__types">PNG, JPEG, WebP or PDF, up to 5 MB</span>
          </span>
        </div>
      )}
    </div>
  );
}

const PRIVATE_FILE = 'Only the organizer can open it.';

/**
 * The questions a player, or whoever registers them, answers, in titled sections. The same component
 * draws the real page and the organizer's preview, so what an organizer sees is what players get.
 * Payment and the review come after these, in RegistrationView.
 */
export function EntryFormFields({
  form,
  categories,
  values,
  onChange,
  files = {},
  onFile,
  schoolOptions = [],
  sections,
  idPrefix,
  lead,
}: {
  form: PublicRegistrationForm;
  categories: Array<{ id: string; name: string }>;
  values: EntryFormValues;
  onChange: (patch: Partial<EntryFormValues>) => void;
  files?: Record<string, ChosenFile>;
  onFile: (field: string, file: File | null) => void;
  schoolOptions?: string[];
  /** From entrySections. Worked out here when not given. */
  sections?: SectionInfo[];
  idPrefix?: string;
  /** Above the player fields: saved players, or a sign-in line. */
  lead?: ReactNode;
}) {
  const malay = form.malayLabels;
  const autoId = useId();
  const prefix = idPrefix ?? autoId.replace(/:/g, '');
  const schoolsId = `${prefix}-schools`;
  const categoryName = `${prefix}-category`;
  const label = (field: StandardFieldKey) => standardLabel(field, malay);
  const text = (field: keyof EntryFormValues) => ({
    value: values[field] as string,
    onChange: (e: ChangeEvent<HTMLInputElement>) => onChange({ [field]: e.target.value }),
  });
  const setAnswer = (id: string, value: string | boolean) =>
    onChange({ answers: { ...values.answers, [id]: value } });
  const list = sections ?? entrySections(form, values, files, false);
  const section = (key: SectionKey) => {
    const i = list.findIndex((s) => s.key === key);
    return i < 0 ? null : { id: `${prefix}-${key}`, n: i + 1, title: list[i]!.title, done: list[i]!.done };
  };

  const answerQuestions = form.questions.filter((q) => q.type !== 'file');
  const fileQuestions = form.questions.filter((q) => q.type === 'file');

  const question = (q: PublicRegistrationQuestion) => {
    const name = bilingualLabel(q);
    if (q.type === 'checkbox') {
      return (
        <label key={q.id} className="rg-checkcard rg-span">
          <input
            type="checkbox"
            required={q.required}
            checked={values.answers[q.id] === true}
            onChange={(e) => setAnswer(q.id, e.target.checked)}
          />
          <span>
            {name}
            {!q.required && <span className="ui-field__optional"> optional</span>}
          </span>
        </label>
      );
    }
    if (q.type === 'select' && q.options?.length) {
      return (
        <Field key={q.id} label={name} optional={!q.required}>
          {(control) => (
            <select
              {...control}
              required={q.required}
              value={String(values.answers[q.id] ?? '')}
              onChange={(e) => setAnswer(q.id, e.target.value)}
            >
              <option value="">Choose</option>
              {q.options!.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )}
        </Field>
      );
    }
    return (
      <Field
        key={q.id}
        label={name}
        optional={!q.required}
        required={q.required}
        maxLength={1000}
        value={String(values.answers[q.id] ?? '')}
        onChange={(e) => setAnswer(q.id, e.target.value)}
      />
    );
  };

  const player = section('player')!;
  const contact = section('contact')!;
  const asked = section('questions');
  const docs = section('documents');

  return (
    <>
      <FormSection {...player}>
        {lead}
        <div className="rg-grid">
          <div className="rg-span">
            <Field
              label={label(form.collectNric ? 'nameAsInNric' : 'name')}
              required
              autoComplete="off"
              {...text('name')}
            />
          </div>
          <Field
            label={label('yearOfBirth')}
            optional
            type="number"
            inputMode="numeric"
            min={1920}
            max={new Date().getFullYear()}
            {...text('yearOfBirth')}
          />
          <Field label={label('gender')} optional>
            {(control) => (
              <select {...control} value={values.gender} onChange={(e) => onChange({ gender: e.target.value })}>
                <option value="">Choose</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            )}
          </Field>

          {form.collectNric && (
            <div className="rg-span">
              <Field
                label={label('nric')}
                hint="12 digits, or a passport number. Only the organizer sees it."
                required
                autoComplete="off"
                inputMode="text"
                maxLength={40}
                {...text('nricNumber')}
              />
            </div>
          )}

          {categories.length > 0 && (
            <fieldset className="rg-choices rg-span">
              <legend className="ui-field__label">{label('category')}</legend>
              <div className="rg-choices__grid">
                {categories.map((c) => (
                  <label key={c.id} className={`rg-choice${values.categoryId === c.id ? ' is-on' : ''}`}>
                    <input
                      type="radio"
                      name={categoryName}
                      value={c.id}
                      checked={values.categoryId === c.id}
                      onChange={() => onChange({ categoryId: c.id })}
                    />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {form.collectSchool && (
            <div>
              <Field label={label('school')} optional list={schoolsId} autoComplete="off" {...text('school')} />
              <datalist id={schoolsId}>
                {schoolOptions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
          )}
          {form.collectFideId && (
            <Field label={label('fideId')} optional type="number" inputMode="numeric" {...text('fideId')} />
          )}

          <details className="rg-more rg-span">
            <summary>More details (optional)</summary>
            <div className="rg-grid">
              <Field label={label('club')} optional {...text('club')} />
              <Field label={label('rating')} optional type="number" inputMode="numeric" {...text('rating')} />
              <Field label={label('city')} optional {...text('city')} />
              <Field label={label('state')} optional {...text('state')} />
            </div>
          </details>
        </div>
      </FormSection>

      <FormSection {...contact}>
        <div className="rg-grid">
          <Field label={label('email')} optional type="email" autoComplete="email" {...text('email')} />
          {form.collectPhone && (
            <Field label={label('phone')} optional type="tel" autoComplete="tel" {...text('phone')} />
          )}
        </div>
      </FormSection>

      {asked && (
        <FormSection {...asked}>
          <div className="rg-grid">{answerQuestions.map(question)}</div>
        </FormSection>
      )}

      {docs && (
        <FormSection {...docs}>
          <div className="rg-grid">
            {form.collectAgeProof && (
              <FileDrop
                label={label('ageProof')}
                required
                hint={PRIVATE_FILE}
                file={files[AGE_PROOF_FIELD]}
                onFile={(file) => onFile(AGE_PROOF_FIELD, file)}
              />
            )}
            {fileQuestions.map((q) => (
              <FileDrop
                key={q.id}
                label={bilingualLabel(q)}
                required={q.required}
                hint={PRIVATE_FILE}
                file={files[q.id]}
                onFile={(file) => onFile(q.id, file)}
              />
            ))}
          </div>
        </FormSection>
      )}
    </>
  );
}
