type ReviewableRegistration = {
  id: string;
  status: string;
  hasReceipt?: boolean;
  paymentStatus?: string;
  playerSnapshot: { name: string; yearOfBirth?: number | null };
};

type RosterEntry = { name: string; yearOfBirth?: number | null };

/** A paid entry with no receipt: approving it means the organizer vouches for the payment. */
export function needsPaymentConfirmation(
  reg: Pick<ReviewableRegistration, 'hasReceipt' | 'paymentStatus'>,
  entryFeeCents: number | null | undefined,
): boolean {
  if (!entryFeeCents || entryFeeCents <= 0) return false;
  if (reg.hasReceipt) return false;
  return reg.paymentStatus !== 'verified' && reg.paymentStatus !== 'not_required';
}

function normalName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function sameYearOrUnknown(a?: number | null, b?: number | null): boolean {
  return a == null || b == null || a === b;
}

/** regId → why it looks like a duplicate. Rejected registrations never count. */
export function findLikelyDuplicates(
  registrations: ReviewableRegistration[],
  roster: RosterEntry[],
): Map<string, string> {
  const flags = new Map<string, string>();
  const live = registrations.filter((r) => r.status !== 'rejected');
  for (const reg of live) {
    const name = normalName(reg.playerSnapshot.name);
    const yob = reg.playerSnapshot.yearOfBirth;
    if (reg.status !== 'approved' && roster.some((p) => normalName(p.name) === name && sameYearOrUnknown(p.yearOfBirth, yob))) {
      flags.set(reg.id, 'Same name is already on the roster');
      continue;
    }
    const twin = live.some(
      (o) =>
        o.id !== reg.id &&
        normalName(o.playerSnapshot.name) === name &&
        sameYearOrUnknown(o.playerSnapshot.yearOfBirth, yob),
    );
    if (twin) flags.set(reg.id, 'Submitted more than once');
  }
  return flags;
}
