import { useId, type ChangeEvent, type ReactNode } from 'react';
import {
  AGE_PROOF_FIELD,
  bilingualLabel,
  standardLabel,
  type PublicRegistrationForm,
  type PublicRegistrationQuestion,
  type StandardFieldKey,
} from '@chess-alokas/shared';
import { Field } from '../../ui';
import { UPLOAD_ACCEPT } from './formLogic';

export interface ParentFormValues {
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

export const EMPTY_PARENT_FORM: ParentFormValues = {
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

function FileRow({
  label,
  required,
  attached,
  onFile,
}: {
  label: ReactNode;
  required: boolean;
  attached?: string;
  onFile: (file: File | null) => void;
}) {
  return (
    <Field
      label={label}
      optional={!required}
      hint={attached ? `Attached: ${attached}` : 'PNG, JPEG, WebP or PDF, up to 5 MB. Only the organizer can open it.'}
    >
      {(control) => (
        <input
          {...control}
          type="file"
          accept={UPLOAD_ACCEPT}
          required={required && !attached}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onFile(e.target.files?.[0] ?? null)}
        />
      )}
    </Field>
  );
}

/**
 * The questions a parent answers. The same component draws the real form and the organizer's preview,
 * so what an organizer sees is what a parent gets.
 */
export function ParentFormFields({
  form,
  categories,
  values,
  onChange,
  fileNames = {},
  onFile,
  schoolOptions = [],
}: {
  form: PublicRegistrationForm;
  categories: Array<{ id: string; name: string }>;
  values: ParentFormValues;
  onChange: (patch: Partial<ParentFormValues>) => void;
  /** Field to attached file name. Field is `ageProof` or a question id. */
  fileNames?: Record<string, string>;
  onFile: (field: string, file: File | null) => void;
  schoolOptions?: string[];
}) {
  const malay = form.malayLabels;
  const schoolsId = useId();
  const label = (field: StandardFieldKey) => standardLabel(field, malay);
  const text = (field: keyof ParentFormValues) => ({
    value: values[field] as string,
    onChange: (e: ChangeEvent<HTMLInputElement>) => onChange({ [field]: e.target.value }),
  });
  const setAnswer = (id: string, value: string | boolean) =>
    onChange({ answers: { ...values.answers, [id]: value } });

  const question = (q: PublicRegistrationQuestion) => {
    const name = bilingualLabel(q);
    if (q.type === 'file') {
      return (
        <FileRow
          key={q.id}
          label={name}
          required={q.required}
          attached={fileNames[q.id]}
          onFile={(file) => onFile(q.id, file)}
        />
      );
    }
    if (q.type === 'checkbox') {
      return (
        <label key={q.id} className="rf-check rf-check--form">
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

  return (
    <>
      <Field
        label={label(form.collectNric ? 'nameAsInNric' : 'name')}
        required
        autoComplete="off"
        {...text('name')}
      />
      <div className="rf-pair">
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
      </div>

      {form.collectNric && (
        <Field
          label={label('nric')}
          hint="12 digits, or a passport number. Only the organizer sees it."
          required
          autoComplete="off"
          inputMode="text"
          maxLength={40}
          {...text('nricNumber')}
        />
      )}

      {categories.length > 0 && (
        <Field label={label('category')}>
          {(control) => (
            <select
              {...control}
              value={values.categoryId}
              onChange={(e) => onChange({ categoryId: e.target.value })}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      {form.collectSchool && (
        <>
          <Field label={label('school')} optional list={schoolsId} autoComplete="off" {...text('school')} />
          <datalist id={schoolsId}>
            {schoolOptions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </>
      )}
      <div className="rf-pair">
        <Field label={label('email')} optional type="email" autoComplete="email" {...text('email')} />
        {form.collectPhone && (
          <Field label={label('phone')} optional type="tel" autoComplete="tel" {...text('phone')} />
        )}
      </div>
      {form.collectFideId && (
        <Field label={label('fideId')} optional type="number" inputMode="numeric" {...text('fideId')} />
      )}

      {form.collectAgeProof && (
        <FileRow
          label={label('ageProof')}
          required
          attached={fileNames[AGE_PROOF_FIELD]}
          onFile={(file) => onFile(AGE_PROOF_FIELD, file)}
        />
      )}

      {form.questions.map(question)}

      <details className="rf-more">
        <summary>More details (optional)</summary>
        <div className="rf-pair">
          <Field label={label('club')} optional {...text('club')} />
          <Field label={label('rating')} optional type="number" inputMode="numeric" {...text('rating')} />
        </div>
        <div className="rf-pair">
          <Field label={label('city')} optional {...text('city')} />
          <Field label={label('state')} optional {...text('state')} />
        </div>
      </details>
    </>
  );
}
