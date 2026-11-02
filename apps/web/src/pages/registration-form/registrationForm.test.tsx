import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REGISTRATION_FORM_CONFIG,
  maskNric,
  normalizeNric,
  publicRegistrationForm,
  type RegistrationCustomQuestion,
  type RegistrationFormConfig,
  type TournamentRegistration,
} from '@chess-alokas/shared';
import { MemoryRouter } from 'react-router-dom';
import { FormBuilder } from './FormBuilder';
import {
  EntrySent,
  EventHeader,
  RegistrationClosed,
  RegistrationForm,
  availability,
  deadlineText,
  formatEventDate,
  formatFee,
  type RegistrationEvent,
} from './RegistrationView';
import { EMPTY_ENTRY_FORM, EntryFormFields, entrySections } from './EntryFormFields';
import {
  answerText,
  asPublicForm,
  entriesCsv,
  entrySource,
  formSummary,
  fromLocalInput,
  looksLikeIdQuestion,
  moveQuestion,
  newQuestion,
  questionLabel,
  registrationLink,
  toLocalInput,
  whatsappHref,
} from './formLogic';

const question = (over: Partial<RegistrationCustomQuestion>): RegistrationCustomQuestion => ({
  id: 'q1',
  label: 'T-shirt size',
  type: 'text',
  required: false,
  ...over,
});

const entry = (over: Partial<TournamentRegistration> = {}): TournamentRegistration => ({
  id: '11111111-1111-4111-8111-111111111111',
  tournamentId: '22222222-2222-4222-8222-222222222222',
  playerSnapshot: { name: 'Tan Zugzwang' },
  customAnswers: {},
  paymentStatus: 'not_required',
  amountCents: 0,
  status: 'pending',
  createdAt: '2026-11-02T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
  ...over,
});

const FULL_FORM: RegistrationFormConfig = {
  ...DEFAULT_REGISTRATION_FORM_CONFIG,
  collectNric: true,
  collectAgeProof: true,
  malayLabels: true,
  customQuestions: [
    question({ id: 'shirt', labelMs: 'Saiz baju', type: 'select', required: true, options: ['S', 'M'], retiredOptions: ['XL'] }),
    question({ id: 'photo', label: 'Photo permission', type: 'checkbox' }),
    question({ id: 'letter', label: 'School letter', type: 'file', required: true }),
    question({ id: 'gone', label: 'Old question', hidden: true }),
  ],
};

const entryForm = (form: RegistrationFormConfig) =>
  renderToStaticMarkup(
    <EntryFormFields
      form={publicRegistrationForm(form)}
      categories={[{ id: 'c1', name: 'Under 12' }]}
      values={EMPTY_ENTRY_FORM}
      onChange={() => undefined}
      onFile={() => undefined}
    />,
  );

describe('the entry form', () => {
  it('asks only what is switched on', () => {
    const plain = entryForm({ ...DEFAULT_REGISTRATION_FORM_CONFIG, collectSchool: false, collectPhone: false, collectFideId: false });
    expect(plain).toContain('Full name');
    expect(plain).not.toContain('School');
    expect(plain).not.toContain('Contact number');
    expect(plain).not.toContain('FIDE ID');
    expect(plain).not.toContain('NRIC');
    expect(plain).not.toContain('type="file"');
  });

  it('draws every question type, both languages, and leaves hidden questions out', () => {
    const html = entryForm(FULL_FORM);
    expect(html).toContain('T-shirt size / Saiz baju');
    expect(html).toContain('<select');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('School letter');
    expect((html.match(/type="file"/g) ?? []).length).toBe(2);
    expect(html).not.toContain('Old question');
    expect(html).not.toContain('XL');
  });

  it('labels the standard fields in Malay only when switched on, and hints at NRIC on the name', () => {
    const html = entryForm(FULL_FORM);
    expect(html).toContain('Name (as in NRIC) / Nama (seperti dalam NRIC)');
    expect(html).toContain('NRIC number / No. kad pengenalan');
    expect(html).toContain('Age proof (NRIC or birth certificate)');
    const english = entryForm({ ...FULL_FORM, malayLabels: false });
    expect(english).toContain('Name (as in NRIC)');
    expect(english).not.toContain('Nama');
  });

  it('covers every column of the organizer’s real Google Form', () => {
    const html = entryForm(FULL_FORM);
    for (const column of ['Name', 'NRIC number', 'Gender', 'Category', 'School', 'Contact number', 'Email', 'Age proof']) {
      expect(html).toContain(column);
    }
  });

  it('accepts the same files the server does', () => {
    expect(entryForm(FULL_FORM)).toContain('accept="image/png,image/jpeg,image/webp,application/pdf"');
  });
});

describe('the builder', () => {
  const build = (form: RegistrationFormConfig, answers = 0) =>
    renderToStaticMarkup(
      <FormBuilder
        form={form}
        answerCounts={Object.fromEntries(form.customQuestions.map((q) => [q.id, { answers, options: {} }]))}
        onChange={() => undefined}
      />,
    );

  it('offers NRIC and age proof switched off by default, and says what they mean', () => {
    const html = build(DEFAULT_REGISTRATION_FORM_CONFIG);
    expect(html).toContain('NRIC number');
    expect(html).toContain('Age proof upload');
    expect(html).toContain('Required when on. Private to your team.');
    expect(html).toContain('None yet.');
    expect((html.match(/checked=""/g) ?? []).length).toBe(3);
  });

  it('says Hide rather than Remove once a question has answers, and fixes its type', () => {
    const answered = build({ ...DEFAULT_REGISTRATION_FORM_CONFIG, customQuestions: [question({})] }, 2);
    expect(answered).toContain('Hide');
    expect(answered).toContain('Fixed: 2 answered');
    expect(answered).not.toContain('>Remove<');
    const fresh = build({ ...DEFAULT_REGISTRATION_FORM_CONFIG, customQuestions: [question({})] }, 0);
    expect(fresh).toContain('>Remove<');
  });

  it('lists hidden questions with what was kept', () => {
    const html = build({ ...DEFAULT_REGISTRATION_FORM_CONFIG, customQuestions: [question({ hidden: true })] }, 3);
    expect(html).toContain('Hidden from new entries');
    expect(html).toContain('3 answers kept');
    expect(html).toContain('Show again');
  });

  it('steers an ID number away from a text question', () => {
    const html = build({ ...DEFAULT_REGISTRATION_FORM_CONFIG, customQuestions: [question({ label: 'NRIC no' })] });
    expect(html).toContain('Use the NRIC switch above instead');
    expect(looksLikeIdQuestion('Pasport')).toBe(true);
    expect(looksLikeIdQuestion('Kad pengenalan')).toBe(true);
    expect(looksLikeIdQuestion('Picture of your school')).toBe(false);
    expect(looksLikeIdQuestion('Topic')).toBe(false);
  });
});

describe('form helpers', () => {
  it('moves past hidden questions', () => {
    const list = [question({ id: 'a' }), question({ id: 'b', hidden: true }), question({ id: 'c' })];
    expect(moveQuestion(list, 'c', -1).map((q) => q.id)).toEqual(['c', 'a', 'b']);
    expect(moveQuestion(list, 'a', -1)).toBe(list);
  });

  it('makes ids the server accepts, and a dropdown starts with no options', () => {
    expect(newQuestion().id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(newQuestion('select').options).toEqual([]);
  });

  it('sums up the form in one line', () => {
    expect(formSummary(FULL_FORM)).toContain('NRIC number, Age proof, 3 questions of yours');
    expect(formSummary(DEFAULT_REGISTRATION_FORM_CONFIG)).not.toContain('NRIC');
  });

  it('reads an older event payload that only has customQuestions', () => {
    const form = asPublicForm({ collectSchool: true, collectFideId: true, collectPhone: true, customQuestions: [] } as unknown as RegistrationFormConfig);
    expect(form.questions).toEqual([]);
    expect(form.collectNric).toBe(false);
  });

  it('builds a link that needs nothing installed, and a WhatsApp message with it', () => {
    expect(registrationLink('kl-open', false, 'http://localhost:5173')).toBe('http://localhost:5173/register/kl-open');
    expect(registrationLink('kl-open', true, 'file://')).toBe('https://chess-manager.alokas.com/register/kl-open');
    const href = whatsappHref('KL Open', 'https://x.test/register/kl-open');
    expect(href).toContain('https://wa.me/?text=');
    expect(decodeURIComponent(href)).toContain('KL Open: register here https://x.test/register/kl-open');
  });

  it('round-trips a deadline through the organizer’s local time', () => {
    const iso = '2026-12-01T10:30:00.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(fromLocalInput('')).toBeNull();
    expect(toLocalInput(null)).toBe('');
  });

  it('keeps labels for hidden questions and says plainly when one is truly gone', () => {
    expect(questionLabel(FULL_FORM, 'gone')).toBe('Old question');
    expect(questionLabel(FULL_FORM, 'ageProof')).toBe('Age proof');
    expect(questionLabel(FULL_FORM, 'nope')).toBe('Answer to a removed question');
    expect(answerText(true)).toBe('Yes');
    expect(answerText(false)).toBe('No');
  });

  it('labels where an entry came from as far as the data can say', () => {
    expect(entrySource({ submittedByUserId: null })).toBe('Link, no account');
    expect(entrySource({ submittedByUserId: 'u' })).toBe('Signed-in account');
  });

  it('masks and normalizes an NRIC', () => {
    expect(maskNric('140305-14-5678')).toBe('******-**-5678');
    expect(maskNric(null)).toBeNull();
    expect(normalizeNric('140305145678')).toBe('140305-14-5678');
    expect(normalizeNric(' 140305 14 5678 ')).toBe('140305-14-5678');
    expect(normalizeNric('a1234567')).toBe('A1234567');
    expect(normalizeNric('12')).toBeNull();
    expect(normalizeNric('<script>')).toBeNull();
  });
});

describe('the entries CSV', () => {
  const csv = (regs: TournamentRegistration[]) => entriesCsv(regs, FULL_FORM, { c1: 'Under 12' });

  it('has the answers, says whether files were attached, and leaves NRIC out', () => {
    const out = csv([
      entry({
        selectedCategoryId: 'c1',
        customAnswers: { shirt: 'M', photo: true, gone: 'kept' },
        nricMasked: '******-**-5678',
        nricNumber: '140305-14-5678',
        files: [{ id: '33333333-3333-4333-8333-333333333333', field: 'ageProof', contentType: 'image/png', bytes: 1 }],
      }),
    ]);
    expect(out).toContain('T-shirt size / Saiz baju');
    expect(out).toContain('Under 12');
    expect(out).toContain('Yes');
    expect(out).toContain('kept');
    expect(out).toContain('Age proof attached');
    expect(out).toContain('School letter (attached)');
    expect(out).not.toMatch(/NRIC/i);
    expect(out).not.toContain('5678');
  });

  it('defuses spreadsheet formulas and quotes commas', () => {
    const out = csv([entry({ playerSnapshot: { name: '=HYPERLINK("x")', school: 'SK A, B' } })]);
    expect(out).toContain(`"'=HYPERLINK(""x"")"`);
    expect(out).toContain('"SK A, B"');
  });
});

describe('nothing private reaches the page source', () => {
  it('the queue never asks for the full number until someone presses Show', () => {
    const source = readFileSync(new URL('./EntryQueue.tsx', import.meta.url), 'utf8');
    expect(source).toContain('apiRevealRegistrationNric');
    expect(source).not.toContain('nricNumber:');
    expect(source).not.toMatch(/console\.|trackPageView/);
  });

  it('uses tokens, no emoji and no chess glyphs in what it adds', () => {
    const files = ['./registrationForm.css', './RegistrationSetup.tsx', './EntryQueue.tsx', './FormBuilder.tsx', './EntryFormFields.tsx', './RegistrationView.tsx', './registerPage.css', './ShareLink.tsx', '../EventRegistrationPage.tsx'];
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/[♔-♟]|\p{Extended_Pictographic}/u);
    }
    for (const file of ['./registrationForm.css', './registerPage.css']) {
      const css = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(css, file).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|!important|text-overflow/i);
    }
  });

  it('speaks to players, not parents, outside the consent notice', () => {
    for (const file of ['./RegistrationSetup.tsx', './EntryFormFields.tsx', './RegistrationView.tsx', '../EventRegistrationPage.tsx']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/\bparents?\b/i);
    }
  });
});

const EVENT: RegistrationEvent = {
  name: 'Imaginary Bay Junior Rapid',
  organizationName: 'Pretend Heights Chess Academy',
  date: '2026-08-22',
  style: 'swiss',
  rounds: 5,
  timeControl: '15+5',
  venueName: 'Dewan Tiada Di Peta',
  venueAddress: '12 Jalan Pretend',
  city: 'Imaginary Bay',
  state: 'Selangor',
  latitude: null,
  longitude: null,
  entryFeeCents: 3000,
  currency: 'MYR',
  registrationOpen: true,
  registrationDeadline: '2026-12-14T15:59:00.000Z',
  maxParticipants: 64,
  registeredCount: 8,
  descriptionMd: null,
  rulesMd: null,
  paymentInstructions: 'DuitNow to Pretend Heights',
  paymentQrUrl: null,
  publicToken: 'tok',
};
const NOW = new Date('2026-12-09T04:00:00.000Z').getTime();

describe('the public registration page', () => {
  const page = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

  it('formats the fee, the date and the deadline the way players read them', () => {
    expect(formatFee(3000)).toBe('RM 30');
    expect(formatFee(3050)).toBe('RM 30.50');
    expect(formatFee(0)).toBe('Free');
    expect(formatFee(2000, 'SGD')).toBe('SGD 20');
    expect(formatEventDate('2026-08-22')).toBe('Sat, 22 Aug 2026');
    const soon = deadlineText(EVENT.registrationDeadline!, NOW);
    expect(soon.text).toMatch(/^Closes 14 Dec, \d\d:\d\d · 5 days left$/);
    expect(soon.urgent).toBe(false);
    const close = deadlineText(EVENT.registrationDeadline!, NOW + 3 * 86_400_000);
    expect(close.text).toContain('2 days left');
    expect(close.urgent).toBe(true);
    expect(deadlineText(EVENT.registrationDeadline!, NOW + 10 * 86_400_000)).toMatchObject({ passed: true, text: 'Closed 14 Dec' });
  });

  it('knows when entries are open, full or closed', () => {
    expect(availability(EVENT, NOW)).toBe('open');
    expect(availability({ ...EVENT, registeredCount: 64 }, NOW)).toBe('full');
    expect(availability({ ...EVENT, registrationOpen: false }, NOW)).toBe('closed');
    expect(availability(EVENT, NOW + 10 * 86_400_000)).toBe('closed');
  });

  it('puts the event at the top: entry fee, places, deadline and directions', () => {
    const html = page(<EventHeader event={EVENT} now={NOW} />);
    expect(html).toContain('Entry RM 30');
    expect(html).toContain('8 confirmed · 64 places');
    expect(html).toContain('5 days left');
    expect(html).toContain('Directions');
    expect(html).toContain('Open for entries');
    expect(page(<EventHeader event={{ ...EVENT, entryFeeCents: 0 }} now={NOW} />)).toContain('>Free<');
    expect(page(<EventHeader event={EVENT} now={NOW + 3 * 86_400_000} />)).toContain('rg-urgent');
  });

  it('splits a long form into sections and marks the ones that are done', () => {
    const form = publicRegistrationForm(FULL_FORM);
    const empty = entrySections(form, EMPTY_ENTRY_FORM, {}, true);
    expect(empty.map((s) => s.title)).toEqual(['Player', 'Contact', 'Event questions', 'Documents', 'Payment']);
    expect(empty.every((s) => !s.done)).toBe(true);
    const named = entrySections(form, { ...EMPTY_ENTRY_FORM, name: 'Tan Zugzwang', nricNumber: '140305145678' }, {}, true);
    expect(named[0]!.done).toBe(true);
    const plain = entrySections(publicRegistrationForm(DEFAULT_REGISTRATION_FORM_CONFIG), EMPTY_ENTRY_FORM, {}, false);
    expect(plain.map((s) => s.key)).toEqual(['player', 'contact']);
  });

  it('reviews the entry before sending, with the NRIC masked', () => {
    const html = page(
      <RegistrationForm
        event={EVENT}
        form={publicRegistrationForm(FULL_FORM)}
        categories={[{ id: 'c1', name: 'Under 12' }]}
        values={{ ...EMPTY_ENTRY_FORM, name: 'Tan Zugzwang', categoryId: 'c1', nricNumber: '140305-14-5678' }}
        onChange={() => undefined}
        files={{ receipt: { name: 'receipt.png', dataUrl: 'data:image/png;base64,AA==' } }}
        onFile={() => undefined}
        onSubmit={() => undefined}
        full={false}
        idPrefix="t"
      />,
    );
    expect(html).toContain('Check and send');
    expect(html).toContain('******-**-5678');
    expect(html.match(/140305/g)?.length ?? 0).toBe(1); // only in the field the player typed it into
    expect(html).toContain('RM 30 · receipt attached');
    expect(html).toContain('0 of 2 attached');
    expect(html).toContain('receipt.png');
    expect(html).toContain('By submitting, you confirm');
    expect(html).toContain('Submit entry');
  });

  it('turns the button into a waitlist when the roster is full', () => {
    const html = page(
      <RegistrationForm
        event={{ ...EVENT, registeredCount: 64 }}
        form={publicRegistrationForm(DEFAULT_REGISTRATION_FORM_CONFIG)}
        categories={[]}
        values={EMPTY_ENTRY_FORM}
        onChange={() => undefined}
        files={{}}
        onFile={() => undefined}
        onSubmit={() => undefined}
        full
        idPrefix="t"
      />,
    );
    expect(html).toContain('All 64 places are taken. New entries join the waitlist.');
    expect(html).toContain('Join the waitlist');
  });

  it('says what happens next after sending, including the receipt', () => {
    const sent = (over: Partial<TournamentRegistration>) =>
      page(
        <EntrySent registration={entry(over)} event={EVENT} category="Under 12" signedIn={false} onAnother={() => undefined} />,
      );
    const pending = sent({ paymentStatus: 'pending_receipt' });
    expect(pending).toContain('Entry sent for Tan Zugzwang');
    expect(pending).toContain('Waiting for approval');
    expect(pending).toContain('No receipt attached');
    expect(pending).toContain('Register another player');
    expect(sent({ paymentStatus: 'submitted' })).toContain('Receipt sent');
    expect(sent({ status: 'waitlisted' })).toContain('On the waitlist');
  });

  it('closes politely, with somewhere else to go', () => {
    const html = page(<RegistrationClosed event={{ ...EVENT, registrationOpen: false }} now={NOW} />);
    expect(html).toContain('Registration is closed');
    expect(html).toContain('Find another event');
    expect(page(<RegistrationClosed event={EVENT} now={NOW + 10 * 86_400_000} />)).toContain('Entries closed on 14 Dec');
  });
});
