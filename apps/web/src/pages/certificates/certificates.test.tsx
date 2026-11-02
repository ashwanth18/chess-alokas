import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmailReview } from './EmailReview';
import {
  buildReviewRows,
  countLine,
  filterRows,
  outcomeLine,
  selectAllIds,
  summarize,
  tickReducer,
  type IssueLike,
  type PlayerInfo,
  type ReviewRow,
} from './reviewLogic';
import { csvRows, issueFields } from './recipients';

/** Invented players, as in the e2e fixtures. Two siblings share one parent's address. */
const P = {
  gambit: 'aaaaaaaa-0000-4000-8000-000000000001',
  indian: 'aaaaaaaa-0000-4000-8000-000000000002',
  kavitha: 'aaaaaaaa-0000-4000-8000-000000000003',
  tan: 'aaaaaaaa-0000-4000-8000-000000000004',
  lim: 'aaaaaaaa-0000-4000-8000-000000000006',
  arjun: 'aaaaaaaa-0000-4000-8000-000000000007',
};
const U12 = '33333333-3333-4333-8333-333333333312';

let n = 0;
function issue(over: Partial<IssueLike> & { participantId: string; recipientName: string }): IssueLike {
  n += 1;
  return {
    id: `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`,
    type: 'participation',
    status: 'stored',
    recipientEmail: null,
    createdAt: `2026-07-14T06:${String(n).padStart(2, '0')}:00.000Z`,
    ...over,
  };
}

const players = new Map<string, PlayerInfo>([
  [P.gambit, { seed: 1, sections: ['U12'] }],
  [P.indian, { seed: 2, sections: ['U12'] }],
  [P.kavitha, { seed: 3, sections: ['U12'] }],
  [P.tan, { seed: 4, sections: ['U12'] }],
  [P.lim, { seed: 6, sections: ['U12'] }],
  [P.arjun, { seed: 7, sections: ['U12'] }],
]);

function fixture() {
  const issues: IssueLike[] = [
    issue({ participantId: P.gambit, recipientName: 'PUTERI ALEKHINE DAMIA BINTI QUEEN GAMBIT', recipientEmail: 'parent.alekhine@example.invalid' }),
    issue({ participantId: P.indian, recipientName: 'PUTERI ALEKHINE DAMIA BINTI QUEEN INDIAN', recipientEmail: 'Parent.Alekhine@example.invalid' }),
    issue({
      participantId: P.kavitha,
      recipientName: 'Kavitha Zugzwang a/p Fianchetto Rajaratnam',
      recipientEmail: 'kavitha@example.invalid',
      status: 'emailed',
      emailedAt: '2026-07-07T03:00:00.000Z',
    }),
    issue({ participantId: P.tan, recipientName: 'Tan Zwischen Zug', recipientEmail: null }),
    issue({ participantId: P.lim, recipientName: 'Lim Gambit Ling', recipientEmail: 'not-an-address' }),
    issue({ participantId: P.arjun, recipientName: 'Arjun Pirc a/l Grunfeld Subramaniam', recipientEmail: 'arjun@example.invalid', status: 'failed', error: 'Mailbox is full' }),
    // A winner certificate: not part of a participation review.
    issue({ participantId: P.tan, recipientName: 'Tan Zwischen Zug', recipientEmail: 'tan@example.invalid', type: 'winner', rank: 1 }),
  ];
  const rows = buildReviewRows(issues, { type: 'participation', players, categoryNames: new Map([[U12, 'U12']]) });
  const byName = (part: string) => rows.find((r) => r.name.includes(part))!;
  return { issues, rows, byName };
}

describe('review rows', () => {
  it('has one row per issued certificate of the chosen type', () => {
    const { rows } = fixture();
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.type === 'participation')).toBe(true);
  });

  it('gives each row a status, and ticks only valid addresses not sent before', () => {
    const { byName } = fixture();
    expect(byName('GAMBIT')).toMatchObject({ status: 'ready', selectable: true, defaultTicked: true });
    expect(byName('Kavitha')).toMatchObject({ status: 'sent', selectable: true, defaultTicked: false });
    expect(byName('Kavitha').note).toMatch(/^Sent /);
    expect(byName('Tan')).toMatchObject({ status: 'no-email', selectable: false, defaultTicked: false });
    expect(byName('Lim')).toMatchObject({ status: 'invalid-email', selectable: false, defaultTicked: false });
    expect(byName('Arjun')).toMatchObject({ status: 'retry', selectable: true, defaultTicked: true, note: 'Last try: Mailbox is full' });
  });

  it('tells two same-named children apart by number and section, never school', () => {
    const { byName } = fixture();
    expect(byName('GAMBIT').disambiguator).toBe('#1 · U12');
    expect(byName('INDIAN').disambiguator).toBe('#2 · U12');
  });

  it('marks siblings who share one address, ignoring case, and keeps both sendable', () => {
    const { byName } = fixture();
    expect(byName('GAMBIT').sharedWith).toBe(1);
    expect(byName('INDIAN').sharedWith).toBe(1);
    expect(byName('INDIAN').selectable).toBe(true);
    expect(byName('Arjun').sharedWith).toBe(0);
  });

  it('emails the newest copy after a re-issue, and still says an earlier one was sent', () => {
    const first = issue({ participantId: P.lim, recipientName: 'Lim Gambit Ling', recipientEmail: 'lim@example.invalid', status: 'emailed', emailedAt: '2026-07-07T03:00:00.000Z' });
    const reissued = issue({ participantId: P.lim, recipientName: 'Lim Gambit Ling', recipientEmail: 'lim@example.invalid' });
    const rows = buildReviewRows([first, reissued], { type: 'participation' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.issueId).toBe(reissued.id);
    expect(rows[0]!.status).toBe('sent');
    expect(rows[0]!.note).toMatch(/An earlier copy was sent/);
  });

  it('notices when a player\'s address on file is different now, and only then', () => {
    const { issues } = fixture();
    const currentEmails = new Map<string, string | null>([
      [P.gambit, 'PARENT.ALEKHINE@example.invalid'], // same, different case
      [P.tan, 'tan.parent@example.invalid'], // had none at issue time
      [P.lim, 'lim.fixed@example.invalid'], // was typed wrong
      [P.arjun, ''], // removed: nothing to offer
    ]);
    const rows = buildReviewRows(issues, { type: 'participation', players, currentEmails });
    const by = (part: string) => rows.find((r) => r.name.includes(part))!;
    expect(by('GAMBIT').newEmail).toBeNull();
    expect(by('Tan')).toMatchObject({ newEmail: 'tan.parent@example.invalid', status: 'no-email', note: 'The player has an address now' });
    expect(by('Lim')).toMatchObject({ newEmail: 'lim.fixed@example.invalid', status: 'invalid-email' });
    expect(by('Arjun').newEmail).toBeNull();
    expect(by('Tan').participantId).toBe(P.tan);
  });

  it('a copy sent to an old address doesn\'t make the new one "already sent"', () => {
    const old = issue({ participantId: P.lim, recipientName: 'Lim Gambit Ling', recipientEmail: 'lim.old@example.invalid', status: 'emailed', emailedAt: '2026-07-07T03:00:00.000Z' });
    const fresh = issue({ participantId: P.lim, recipientName: 'Lim Gambit Ling', recipientEmail: 'lim.new@example.invalid' });
    const [row] = buildReviewRows([old, fresh], { type: 'participation' });
    expect(row).toMatchObject({ issueId: fresh.id, status: 'ready', defaultTicked: true, note: 'An earlier copy went to lim.old@example.invalid' });
  });

  it('shows a certificate another tab is sending, unticked', () => {
    const [row] = buildReviewRows(
      [issue({ participantId: P.tan, recipientName: 'Tan Zwischen Zug', recipientEmail: 'tan@example.invalid', status: 'pending' })],
      { type: 'participation' },
    );
    expect(row).toMatchObject({ status: 'sending', defaultTicked: false, selectable: true });
  });

  it('labels a winner certificate with the place', () => {
    const { issues } = fixture();
    const rows = buildReviewRows(issues, { type: 'winner' });
    expect(rows).toEqual([expect.objectContaining({ typeLabel: 'Winner, 1st', status: 'ready' })]);
  });
});

describe('ticking and counts', () => {
  const start = (rows: ReviewRow[]) => tickReducer(new Set(), { type: 'reset', rows });

  it('starts with the ready and retry rows ticked: "3 of 6 will be sent"', () => {
    const { rows } = fixture();
    const ticked = start(rows);
    expect(ticked.size).toBe(3);
    expect(countLine(summarize(rows, ticked))).toBe('3 of 6 will be sent');
  });

  it('unticking two leaves exactly the others', () => {
    const { rows, byName } = fixture();
    let ticked = start(rows);
    ticked = tickReducer(ticked, { type: 'toggle', id: byName('GAMBIT').issueId, rows });
    ticked = tickReducer(ticked, { type: 'toggle', id: byName('Arjun').issueId, rows });
    expect([...ticked]).toEqual([byName('INDIAN').issueId]);
    expect(countLine(summarize(rows, ticked))).toBe('1 of 6 will be sent');
  });

  it('never ticks a row with no usable address, even through select-many', () => {
    const { rows, byName } = fixture();
    let ticked = tickReducer(new Set(), { type: 'toggle', id: byName('Tan').issueId, rows });
    expect(ticked.size).toBe(0);
    ticked = tickReducer(ticked, { type: 'set', ids: rows.map((r) => r.issueId), on: true, rows });
    expect(ticked.has(byName('Tan').issueId)).toBe(false);
    expect(ticked.has(byName('Lim').issueId)).toBe(false);
    expect(ticked.size).toBe(4);
  });

  it('select all picks everyone not yet sent, so it never resends by accident', () => {
    const { rows, byName } = fixture();
    const ids = selectAllIds(rows);
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain(byName('Kavitha').issueId);
  });

  it('ticking an already-sent row counts as a resend', () => {
    const { rows, byName } = fixture();
    const ticked = tickReducer(start(rows), { type: 'toggle', id: byName('Kavitha').issueId, rows });
    const s = summarize(rows, ticked);
    expect(s).toMatchObject({ willSend: 4, resends: 1, alreadySent: 1, noEmail: 1, invalidEmail: 1 });
    // Siblings share one address: four emails go to three addresses.
    expect(s.addresses).toBe(3);
  });

  it('after a send refreshes the list, players unticked on purpose stay unticked', () => {
    const { rows, byName } = fixture();
    const out = new Set([byName('INDIAN').issueId]);
    const ticked = tickReducer(new Set(), { type: 'reset', rows, keepOut: out });
    expect(ticked.has(byName('INDIAN').issueId)).toBe(false);
    expect(ticked.has(byName('GAMBIT').issueId)).toBe(true);
    expect(ticked.size).toBe(2);
  });

  it('select none clears every tick', () => {
    const { rows } = fixture();
    const ticked = tickReducer(start(rows), { type: 'set', ids: rows.map((r) => r.issueId), on: false, rows });
    expect(ticked.size).toBe(0);
  });

  it('finds rows by name, address or number, and by filter', () => {
    const { rows } = fixture();
    const ticked = start(rows);
    expect(filterRows(rows, ticked, 'alekhine', 'all')).toHaveLength(2);
    expect(filterRows(rows, ticked, '#7', 'all').map((r) => r.name)).toEqual(['Arjun Pirc a/l Grunfeld Subramaniam']);
    expect(filterRows(rows, ticked, '', 'problem')).toHaveLength(2);
    expect(filterRows(rows, ticked, '', 'sent')).toHaveLength(1);
    expect(filterRows(rows, ticked, '', 'shared')).toHaveLength(2);
    expect(filterRows(rows, ticked, '', 'ticked')).toHaveLength(3);
  });

  it('describes a send in a plain sentence', () => {
    expect(
      outcomeLine([
        { issueId: 'a', name: 'A', email: 'a@x.invalid', status: 'emailed' },
        { issueId: 'b', name: 'B', email: 'b@x.invalid', status: 'emailed' },
        { issueId: 'c', name: 'C', email: 'c@x.invalid', status: 'failed', error: 'Bounced' },
      ]),
    ).toBe('2 emails sent. 1 failed.');
  });
});

describe('EmailReview table', () => {
  const render = (ticked?: Set<string>, extra: Partial<Parameters<typeof EmailReview>[0]> = {}) => {
    const { rows } = fixture();
    const t = ticked ?? tickReducer(new Set(), { type: 'reset', rows });
    return {
      rows,
      html: renderToStaticMarkup(
        <EmailReview rows={rows} ticked={t} onToggle={() => undefined} onSetMany={() => undefined} {...extra} />,
      ),
    };
  };

  it('shows the count line and what is held back', () => {
    const { html } = render();
    expect(html).toContain('3 of 6 will be sent');
    expect(html).toContain('1 already sent');
    expect(html).toContain('1 with no email');
    expect(html).toContain('1 with an email that isn&#x27;t valid');
    expect(html).toContain('2 share an address with someone else');
  });

  it('has a box per row, ticked to match, disabled where there is no usable address', () => {
    const { html } = render();
    const boxes = html.match(/<input type="checkbox"[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(6);
    expect(boxes.filter((b) => b.includes('checked=""'))).toHaveLength(3);
    expect(boxes.filter((b) => b.includes('disabled=""'))).toHaveLength(2);
    expect(html).toContain('aria-label="Send to PUTERI ALEKHINE DAMIA BINTI QUEEN GAMBIT (#1 · U12)"');
    expect(html).toContain('Tan Zwischen Zug (#4 · U12): No email, can&#x27;t send');
  });

  it('shows full names with their disambiguator, never cut short', () => {
    const { html } = render();
    expect(html).toContain('Puteri Alekhine Damia');
    expect(html).toContain('binti Queen Gambit');
    expect(html).toContain('binti Queen Indian');
    expect(html).toContain('#1 · U12');
    expect(html).not.toMatch(/\.\.\.|…|text-overflow/);
  });

  it('flags the shared address on both siblings, and shows each status in words', () => {
    const { html } = render();
    expect(html.match(/Shared with 1 other player/g)).toHaveLength(2);
    for (const label of ['Already sent', 'No email', 'Email not valid', 'Ready, failed before']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Last try: Mailbox is full');
  });

  it('counts down when two are unticked', () => {
    const { rows } = fixture();
    const t = tickReducer(tickReducer(new Set(), { type: 'reset', rows }), { type: 'set', ids: [rows[0]!.issueId, rows[1]!.issueId], on: false, rows });
    const html = renderToStaticMarkup(<EmailReview rows={rows} ticked={t} onToggle={() => undefined} onSetMany={() => undefined} />);
    expect(html).toMatch(/<strong>\d of 6 will be sent<\/strong>/);
  });

  it('offers "Use new address" on a row whose address changed, and says why it is off', () => {
    const { issues } = fixture();
    const rows = buildReviewRows(issues, {
      type: 'participation',
      players,
      currentEmails: new Map([[P.tan, 'tan.parent@example.invalid']]),
    });
    const ticked = tickReducer(new Set(), { type: 'reset', rows });
    const on = renderToStaticMarkup(
      <EmailReview rows={rows} ticked={ticked} onToggle={() => undefined} onSetMany={() => undefined} onUseNewAddress={() => undefined} />,
    );
    expect(on).toContain('Address on file now: <span class="cw-email">tan.parent@example.invalid</span>');
    expect(on).toContain('aria-label="Use new address for Tan Zwischen Zug (#4 · U12)"');
    expect(on).toContain('1 has a different address on file now');
    expect(on.match(/Use new address</g)).toHaveLength(1);
    const off = renderToStaticMarkup(
      <EmailReview
        rows={rows}
        ticked={ticked}
        onToggle={() => undefined}
        onSetMany={() => undefined}
        onUseNewAddress={() => undefined}
        reissueBlocked="load or design the template in step 2 first."
      />,
    );
    expect(off).toContain('To use a new address: load or design the template in step 2 first.');
    expect(off).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Use new address for Tan/);
  });

  it('searches, says how many are shown, and has a way back to everyone', () => {
    const { html } = render(undefined, { initialQuery: 'alekhine' });
    expect(html).toContain('Showing 2 of 6.');
    expect(html).toContain('Show everyone');
    const { html: none } = render(undefined, { initialQuery: 'Nobody Here' });
    expect(none).toContain('No one matches &quot;Nobody Here&quot;.');
  });
});

describe('recipients', () => {
  it('reads a CSV and drops empty rows', () => {
    const rows = csvRows([{ name: 'Goh En Passant', email: 'goh@example.invalid' }, { name: ' ', email: '' }], () => 'id');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fileName: 'Goh En Passant', email: 'goh@example.invalid', participantId: null });
  });

  it('sends the stored name exactly as typed, and no participant id for a CSV row', () => {
    const [row] = csvRows([{ name: 'SITI BISHOPAH KASPARINA BINTI EN PASSANT', email: 'x' }], () => 'not-a-uuid');
    expect(issueFields(row!, 'participation')).toMatchObject({
      recipientName: 'SITI BISHOPAH KASPARINA BINTI EN PASSANT',
      participantId: null,
      recipientEmail: 'x',
    });
  });
});

describe('the page sources', () => {
  it('use tokens only, no emoji, no chess glyphs and no truncation', () => {
    const files = [
      './certificates.css',
      './EmailReview.tsx',
      './EmailStep.tsx',
      './DesignerPanel.tsx',
      './Steps.tsx',
      './PdfPreview.tsx',
      '../CertificatesPage.tsx',
      '../../components/CertificateDesignerCanvas.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/[♔-♟]|\p{Extended_Pictographic}/u);
      expect(source, file).not.toMatch(/text-overflow|btn-primary|btn-outline|"btn /);
    }
    const css = readFileSync(new URL('./certificates.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|!important/i);
    expect(css).not.toMatch(/border-radius:\s*(?!var\(|0\b)[^;]*\d/);
    expect(css.trimStart().startsWith('@layer shell')).toBe(true);
  });
});
