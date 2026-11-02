import type {
  RegistrationCustomQuestion,
  RegistrationFormConfig,
  RegistrationQuestionType,
} from '@chess-alokas/shared';
import { REGISTRATION_FORM_LIMITS, bilingualLabel } from '@chess-alokas/shared';
import { Button, Field, IconPlus } from '../../ui';
import { QUESTION_TYPE_LABELS, looksLikeIdQuestion, moveQuestion, newQuestion } from './formLogic';

export type AnswerCounts = Record<string, { answers: number; options: Record<string, number> }>;

const SWITCHES: Array<{
  key: keyof Pick<
    RegistrationFormConfig,
    'collectSchool' | 'collectFideId' | 'collectPhone' | 'collectNric' | 'collectAgeProof' | 'malayLabels'
  >;
  label: string;
  hint?: string;
}> = [
  { key: 'collectSchool', label: 'School' },
  { key: 'collectFideId', label: 'FIDE ID' },
  { key: 'collectPhone', label: 'Contact number' },
  { key: 'collectNric', label: 'NRIC number', hint: 'Required when on. Private to your team.' },
  { key: 'collectAgeProof', label: 'Age proof upload', hint: 'Required when on. Private to your team.' },
  { key: 'malayLabels', label: 'Standard labels in Malay too', hint: 'Name / Nama, School / Sekolah' },
];

function QuestionRow({
  question,
  index,
  total,
  answers,
  onChange,
  onMove,
  onRemove,
}: {
  question: RegistrationCustomQuestion;
  index: number;
  total: number;
  answers: number;
  onChange: (patch: Partial<RegistrationCustomQuestion>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const number = index + 1;
  return (
    <li className="rf-question">
      <div className="rf-question__labels">
        <Field
          label={`Question ${number}, English`}
          value={question.label}
          maxLength={REGISTRATION_FORM_LIMITS.labelChars}
          required
          onChange={(e) => onChange({ label: e.target.value })}
        />
        <Field
          label="Malay"
          optional
          value={question.labelMs ?? ''}
          maxLength={REGISTRATION_FORM_LIMITS.labelChars}
          onChange={(e) => onChange({ labelMs: e.target.value })}
        />
      </div>
      {question.type === 'text' && looksLikeIdQuestion(question.label) && (
        <p className="rf-note rf-note--warn">
          Use the NRIC switch above instead. Answers here join the player’s record; that switch keeps the
          number private.
        </p>
      )}
      <div className="rf-question__type">
        <Field label="Answer type" hint={answers > 0 ? `Fixed: ${answers} answered` : undefined}>
          {(control) => (
            <select
              {...control}
              value={question.type}
              disabled={answers > 0}
              onChange={(e) => {
                const type = e.target.value as RegistrationQuestionType;
                onChange({ type, options: type === 'select' ? (question.options ?? []) : undefined });
              }}
            >
              {(Object.keys(QUESTION_TYPE_LABELS) as RegistrationQuestionType[]).map((t) => (
                <option key={t} value={t}>
                  {QUESTION_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <label className="rf-check">
          <input
            type="checkbox"
            checked={question.required}
            onChange={(e) => onChange({ required: e.target.checked })}
          />
          <span>Required</span>
        </label>
      </div>
      {question.type === 'select' && (
        <Field label="Options" hint="One per line">
          {(control) => (
            <textarea
              {...control}
              rows={Math.min(8, Math.max(3, (question.options?.length ?? 0) + 1))}
              value={(question.options ?? []).join('\n')}
              onChange={(e) => onChange({ options: e.target.value.split('\n') })}
            />
          )}
        </Field>
      )}
      {question.retiredOptions && question.retiredOptions.length > 0 && (
        <p className="rf-note">Off the form, kept for earlier answers: {question.retiredOptions.join(', ')}</p>
      )}
      <div className="rf-question__actions">
        <Button size="sm" variant="quiet" disabled={index === 0} aria-label={`Move question ${number} up`} onClick={() => onMove(-1)}>
          Up
        </Button>
        <Button
          size="sm"
          variant="quiet"
          disabled={index === total - 1}
          aria-label={`Move question ${number} down`}
          onClick={() => onMove(1)}
        >
          Down
        </Button>
        <Button size="sm" variant="quiet" aria-label={`${answers > 0 ? 'Hide' : 'Remove'} question ${number}`} onClick={onRemove}>
          {answers > 0 ? 'Hide' : 'Remove'}
        </Button>
      </div>
    </li>
  );
}

/** Switches for the standard fields and a short list of the organizer's own questions. */
export function FormBuilder({
  form,
  answerCounts,
  onChange,
}: {
  form: RegistrationFormConfig;
  answerCounts: AnswerCounts;
  onChange: (next: RegistrationFormConfig) => void;
}) {
  const questions = form.customQuestions ?? [];
  const visible = questions.filter((q) => !q.hidden);
  const hidden = questions.filter((q) => q.hidden);
  const setQuestions = (next: RegistrationCustomQuestion[]) => onChange({ ...form, customQuestions: next });
  const update = (id: string, patch: Partial<RegistrationCustomQuestion>) =>
    setQuestions(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  const answersOn = (id: string) => answerCounts[id]?.answers ?? 0;

  return (
    <div className="rf-builder">
      <p className="rf-note">Always asked: name (required), year of birth, gender, category, club, city, state, email, rating.</p>
      <fieldset className="rf-switches">
        <legend className="ui-field__label">Ask for</legend>
        {SWITCHES.map((s) => (
          <label key={s.key} className="rf-check">
            <input
              type="checkbox"
              checked={Boolean(form[s.key])}
              onChange={(e) => onChange({ ...form, [s.key]: e.target.checked })}
            />
            <span>
              {s.label}
              {s.hint && <span className="rf-check__hint">{s.hint}</span>}
            </span>
          </label>
        ))}
      </fieldset>

      <h4 className="rf-subhead">Your questions</h4>
      {visible.length === 0 && <p className="rf-note">None yet.</p>}
      <ol className="rf-questions">
        {visible.map((q, i) => (
          <QuestionRow
            key={q.id}
            question={q}
            index={i}
            total={visible.length}
            answers={answersOn(q.id)}
            onChange={(patch) => update(q.id, patch)}
            onMove={(direction) => setQuestions(moveQuestion(questions, q.id, direction))}
            onRemove={() =>
              setQuestions(
                answersOn(q.id) > 0
                  ? questions.map((other) => (other.id === q.id ? { ...other, hidden: true } : other))
                  : questions.filter((other) => other.id !== q.id),
              )
            }
          />
        ))}
      </ol>
      <Button
        size="sm"
        disabled={visible.length >= REGISTRATION_FORM_LIMITS.questions}
        onClick={() => setQuestions([...questions, newQuestion()])}
      >
        <IconPlus /> Add question
      </Button>

      {hidden.length > 0 && (
        <>
          <h4 className="rf-subhead">Hidden from new entries</h4>
          <ul className="rf-hidden">
            {hidden.map((q) => (
              <li key={q.id}>
                <span>
                  {bilingualLabel(q)}
                  <span className="rf-check__hint">
                    {answersOn(q.id)} {answersOn(q.id) === 1 ? 'answer' : 'answers'} kept
                  </span>
                </span>
                <Button size="sm" variant="quiet" onClick={() => update(q.id, { hidden: false })}>
                  Show again
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
