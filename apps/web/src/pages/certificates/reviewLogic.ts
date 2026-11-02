/**
 * The bulk email review: who an issued certificate would go to, whether it can go, and what the
 * organizer has ticked. Pure functions, so the table, the page and the tests agree.
 */
import { isSendableEmail } from '@chess-alokas/shared';

export type CertType = 'participation' | 'winner';

/** An issued certificate as GET /tournaments/:id/certificates lists it. */
export type IssueLike = {
  id: string;
  participantId?: string | null;
  categoryId?: string | null;
  recipientName: string;
  recipientEmail?: string | null;
  type: CertType;
  status: string;
  serial?: string | null;
  error?: string | null;
  emailedAt?: string | null;
  createdAt: string;
  rank?: number | null;
};

/** What the review knows about a player beyond the certificate: start number and sections. */
export type PlayerInfo = { seed?: number | null; sections: string[] };

export type ReviewStatus = 'ready' | 'retry' | 'sent' | 'no-email' | 'invalid-email';

export type ReviewRow = {
  /** The certificate that would be emailed: the newest one for this person. */
  issueId: string;
  name: string;
  /** "#12 · U12". Two children with one name are told apart by this, never by school. */
  disambiguator: string | null;
  email: string | null;
  type: CertType;
  typeLabel: string;
  status: ReviewStatus;
  /** One short line under the status: when it was sent, or why the last try failed. */
  note: string | null;
  serial: string | null;
  /** Other rows with the same address, such as siblings with one parent's email. */
  sharedWith: number;
  /** Rows with no usable address can't be ticked. */
  selectable: boolean;
  /** Ticked when first shown: a valid address that hasn't been sent to before. */
  defaultTicked: boolean;
};

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  ready: 'Ready',
  retry: 'Ready, failed before',
  sent: 'Already sent',
  'no-email': 'No email',
  'invalid-email': 'Email not valid',
};

const normalEmail = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

/** "7 Jul" in the organizer's own locale and time zone. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Re-issuing makes a new certificate for the same person. These share a key; the newest is emailed. */
function personKey(issue: IssueLike): string {
  if (issue.participantId) return `${issue.type}|p|${issue.participantId}|${issue.categoryId ?? ''}`;
  return `${issue.type}|n|${issue.recipientName.trim().toLowerCase()}|${normalEmail(issue.recipientEmail)}`;
}

export function buildReviewRows(
  issues: IssueLike[],
  opts: {
    type: CertType;
    players?: Map<string, PlayerInfo>;
    categoryNames?: Map<string, string>;
  },
): ReviewRow[] {
  const groups = new Map<string, IssueLike[]>();
  for (const issue of issues) {
    if (issue.type !== opts.type) continue;
    const key = personKey(issue);
    const list = groups.get(key);
    if (list) list.push(issue);
    else groups.set(key, [issue]);
  }

  const rows: ReviewRow[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = group[0]!;
    const sentCopy = group.find((i) => i.status === 'emailed' || i.emailedAt);
    const email = latest.recipientEmail?.trim() || null;
    const info = latest.participantId ? opts.players?.get(latest.participantId) : undefined;
    const section =
      (latest.categoryId && opts.categoryNames?.get(latest.categoryId)) || info?.sections.join(', ') || null;
    const disParts = [info?.seed != null ? `#${info.seed}` : null, section].filter(Boolean);

    let status: ReviewStatus;
    let note: string | null = null;
    if (!email) status = 'no-email';
    else if (!isSendableEmail(email)) status = 'invalid-email';
    else if (sentCopy) {
      status = 'sent';
      const when = shortDate(sentCopy.emailedAt);
      note = sentCopy === latest ? (when ? `Sent ${when}` : null) : `An earlier copy was sent${when ? ` ${when}` : ''}`;
    } else if (latest.status === 'failed') {
      status = 'retry';
      note = latest.error ? `Last try: ${latest.error}` : null;
    } else status = 'ready';

    if (status === 'no-email') note = 'Add an email to this player, then issue again';
    if (status === 'invalid-email') note = 'Fix the address on the player, then issue again';

    rows.push({
      issueId: latest.id,
      name: latest.recipientName,
      disambiguator: disParts.length ? disParts.join(' · ') : null,
      email,
      type: latest.type,
      typeLabel:
        latest.type === 'winner'
          ? latest.rank
            ? `Winner, ${placeLabel(latest.rank)}`
            : 'Winner'
          : 'Participation',
      status,
      note,
      serial: latest.serial ?? null,
      sharedWith: 0,
      selectable: status !== 'no-email' && status !== 'invalid-email',
      defaultTicked: status === 'ready' || status === 'retry',
    });
  }

  const byAddress = new Map<string, number>();
  for (const row of rows) {
    if (row.email && row.selectable) byAddress.set(normalEmail(row.email), (byAddress.get(normalEmail(row.email)) ?? 0) + 1);
  }
  for (const row of rows) {
    if (row.email && row.selectable) row.sharedWith = (byAddress.get(normalEmail(row.email)) ?? 1) - 1;
  }

  return rows.sort(
    (a, b) =>
      (a.disambiguator ?? '').localeCompare(b.disambiguator ?? '', undefined, { numeric: true }) ||
      a.name.localeCompare(b.name),
  );
}

function placeLabel(rank: number): string {
  const v = rank % 100;
  if (v >= 11 && v <= 13) return `${rank}th`;
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[rank % 10] ?? 'th';
  return `${rank}${suffix}`;
}

/* ── Ticking ──────────────────────────────────────────────────────────────── */

export type TickAction =
  /** Back to the defaults, except anyone the organizer unticked on purpose: they stay unticked. */
  | { type: 'reset'; rows: ReviewRow[]; keepOut?: Set<string> }
  | { type: 'toggle'; id: string; rows: ReviewRow[] }
  | { type: 'set'; ids: string[]; on: boolean; rows: ReviewRow[] };

/** Ticked issue ids. A row with no usable address can never be ticked, whatever the action says. */
export function tickReducer(ticked: Set<string>, action: TickAction): Set<string> {
  const selectable = new Set(action.rows.filter((r) => r.selectable).map((r) => r.issueId));
  switch (action.type) {
    case 'reset':
      return new Set(
        action.rows.filter((r) => r.defaultTicked && !action.keepOut?.has(r.issueId)).map((r) => r.issueId),
      );
    case 'toggle': {
      if (!selectable.has(action.id)) return ticked;
      const next = new Set(ticked);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return next;
    }
    case 'set': {
      const next = new Set(ticked);
      for (const id of action.ids) {
        if (!selectable.has(id)) continue;
        if (action.on) next.add(id);
        else next.delete(id);
      }
      return next;
    }
  }
}

/** "Select all" means everyone who can be sent to and hasn't been: it never re-sends by accident. */
export function selectAllIds(rows: ReviewRow[]): string[] {
  return rows.filter((r) => r.defaultTicked).map((r) => r.issueId);
}

/* ── Counting ─────────────────────────────────────────────────────────────── */

export type ReviewSummary = {
  total: number;
  willSend: number;
  /** Ticked rows that were sent before: sending them is a resend. */
  resends: number;
  noEmail: number;
  invalidEmail: number;
  alreadySent: number;
  /** Distinct addresses among the ticked rows. Fewer than willSend when siblings share one. */
  addresses: number;
  sharedRows: number;
};

export function summarize(rows: ReviewRow[], ticked: Set<string>): ReviewSummary {
  const chosen = rows.filter((r) => ticked.has(r.issueId) && r.selectable);
  return {
    total: rows.length,
    willSend: chosen.length,
    resends: chosen.filter((r) => r.status === 'sent').length,
    noEmail: rows.filter((r) => r.status === 'no-email').length,
    invalidEmail: rows.filter((r) => r.status === 'invalid-email').length,
    alreadySent: rows.filter((r) => r.status === 'sent').length,
    addresses: new Set(chosen.map((r) => normalEmail(r.email))).size,
    sharedRows: rows.filter((r) => r.sharedWith > 0).length,
  };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "23 of 25 will be sent". */
export function countLine(s: ReviewSummary): string {
  return `${s.willSend} of ${s.total} will be sent`;
}

/* ── Finding a row ────────────────────────────────────────────────────────── */

export type ReviewFilter = 'all' | 'ticked' | 'ready' | 'sent' | 'problem' | 'shared';

export const FILTER_LABEL: Record<ReviewFilter, string> = {
  all: 'Everyone',
  ticked: 'Will be sent',
  ready: 'Not sent yet',
  sent: 'Already sent',
  problem: 'No or bad email',
  shared: 'Shared address',
};

export function filterRows(
  rows: ReviewRow[],
  ticked: Set<string>,
  query: string,
  filter: ReviewFilter,
): ReviewRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter === 'ticked' && !ticked.has(r.issueId)) return false;
    if (filter === 'ready' && r.status !== 'ready' && r.status !== 'retry') return false;
    if (filter === 'sent' && r.status !== 'sent') return false;
    if (filter === 'problem' && r.selectable) return false;
    if (filter === 'shared' && r.sharedWith === 0) return false;
    if (!q) return true;
    return [r.name, r.email ?? '', r.disambiguator ?? '', r.serial ?? ''].some((v) =>
      v.toLowerCase().includes(q),
    );
  });
}

/* ── After sending ────────────────────────────────────────────────────────── */

export type SendOutcome = {
  issueId: string;
  name: string;
  email: string | null;
  status: 'emailed' | 'failed' | 'skipped' | 'simulated';
  error?: string;
};

export const OUTCOME_LABEL: Record<SendOutcome['status'], string> = {
  emailed: 'Sent',
  failed: 'Failed',
  skipped: 'Not sent',
  simulated: 'Demo, not sent',
};

export function outcomeCounts(outcomes: SendOutcome[]) {
  return {
    sent: outcomes.filter((o) => o.status === 'emailed').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
    skipped: outcomes.filter((o) => o.status === 'skipped').length,
    simulated: outcomes.filter((o) => o.status === 'simulated').length,
  };
}

/** A plain sentence for what a send did. */
export function outcomeLine(outcomes: SendOutcome[]): string {
  const c = outcomeCounts(outcomes);
  const parts: string[] = [];
  if (c.simulated) parts.push(`Demo: ${plural(c.simulated, 'email')} would have been sent. Nothing was sent`);
  if (c.sent) parts.push(`${plural(c.sent, 'email')} sent`);
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.skipped) parts.push(`${c.skipped} not sent`);
  return parts.length ? `${parts.join('. ')}.` : 'Nothing was sent.';
}
