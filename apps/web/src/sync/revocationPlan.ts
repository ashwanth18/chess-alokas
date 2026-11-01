/**
 * What may be deleted from a device after someone loses access. Pure rules with no Dexie or
 * Supabase here, so every refusal can be tested. When in doubt these delete nothing: removing
 * too little is a privacy gap the next sync can close, and removing too much loses work.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PullResponseForRevocation {
  tournaments?: unknown;
  categories?: unknown;
  participants?: unknown;
  games?: unknown;
  serverTime?: unknown;
  revokedTournamentIds?: unknown;
  revokedForUserId?: unknown;
}

/**
 * The server's list, or null if this response gives no authority to delete anything: it's partial
 * or from an older server, it was meant for someone else, or nobody is signed in.
 */
export function readRevokedIds(
  response: PullResponseForRevocation | null | undefined,
  /** Who was signed in when the sync started, and who is now. */
  syncUserId: string | null,
  sessionUserId: string | null,
): string[] | null {
  if (!response || !syncUserId || syncUserId !== sessionUserId) return null;
  const complete =
    Array.isArray(response.tournaments) &&
    Array.isArray(response.categories) &&
    Array.isArray(response.participants) &&
    Array.isArray(response.games) &&
    typeof response.serverTime === 'string';
  if (!complete) return null;
  if (response.revokedForUserId !== syncUserId) return null;
  const list = response.revokedTournamentIds;
  if (!Array.isArray(list)) return null;
  if (!list.every((id) => typeof id === 'string' && UUID.test(id))) return null;
  return [...new Set(list as string[])];
}

export interface RevocationPlan {
  remove: string[];
  /** On a shared computer, with changes that could be another account's. Kept for now. */
  heldBack: string[];
}

export function planRevocation(input: {
  revokedIds: string[];
  /** Tournaments on this device. Anything else on the list is simply not here. */
  heldIds: ReadonlySet<string>;
  /** Tournaments the same response delivered. A contradiction, so they stay. */
  deliveredIds: ReadonlySet<string>;
  pendingChanges: ReadonlyMap<string, number>;
  otherAccountsOnDevice: boolean;
}): RevocationPlan {
  const plan: RevocationPlan = { remove: [], heldBack: [] };
  for (const id of input.revokedIds) {
    if (!input.heldIds.has(id) || input.deliveredIds.has(id)) continue;
    if (input.otherAccountsOnDevice && (input.pendingChanges.get(id) ?? 0) > 0) {
      plan.heldBack.push(id);
    } else {
      plan.remove.push(id);
    }
  }
  return plan;
}

/** A backup's tables without these tournaments and their rows. Other rows are the same objects. */
export function stripTournaments(
  tables: Record<string, unknown[]>,
  ids: ReadonlySet<string>,
): { tables: Record<string, unknown[]>; removedTournaments: number } {
  if (ids.size === 0) return { tables, removedTournaments: 0 };
  const out: Record<string, unknown[]> = {};
  let removedTournaments = 0;
  for (const [name, rows] of Object.entries(tables)) {
    out[name] = rows.filter((row) => {
      const r = row as { id?: unknown; tournamentId?: unknown };
      const owner = name === 'tournaments' ? r.id : r.tournamentId;
      const remove = typeof owner === 'string' && ids.has(owner);
      if (remove && name === 'tournaments') removedTournaments += 1;
      return !remove;
    });
  }
  return { tables: out, removedTournaments };
}

export interface RevocationNoticeData {
  tournaments: string[];
  droppedChanges: number;
  /** Named once each: still here because of possible changes by another account. */
  heldBack: string[];
  /** Automatic desktop snapshots that could not be rewritten. */
  backupsNotCleaned: number;
}

export function mergeNotice(
  previous: RevocationNoticeData | null,
  next: RevocationNoticeData,
): RevocationNoticeData {
  if (!previous) return next;
  const removed = [...new Set([...previous.tournaments, ...next.tournaments])];
  return {
    tournaments: removed,
    droppedChanges: previous.droppedChanges + next.droppedChanges,
    heldBack: [...new Set([...previous.heldBack, ...next.heldBack])].filter(
      (name) => !next.tournaments.includes(name),
    ),
    backupsNotCleaned: Math.max(previous.backupsNotCleaned, next.backupsNotCleaned),
  };
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function noticeMessages(notice: RevocationNoticeData): string[] {
  const messages: string[] = [];
  if (notice.tournaments.length > 0) {
    const n = notice.tournaments.length;
    messages.push(
      `You no longer have access to ${listNames(notice.tournaments)}, so ${n === 1 ? 'it was' : 'they were'} removed from this device.`,
    );
  }
  if (notice.droppedChanges > 0) {
    const n = notice.droppedChanges;
    messages.push(`${n} unsaved change${n === 1 ? ' was' : 's were'} discarded and not saved online.`);
  }
  if (notice.heldBack.length > 0) {
    const one = notice.heldBack.length === 1;
    messages.push(
      `You no longer have access to ${listNames(notice.heldBack)}, but ${one ? 'it stays' : 'they stay'} on this computer for now because another account here may have unsaved changes in ${one ? 'it' : 'them'}.`,
    );
  }
  if (notice.backupsNotCleaned > 0) {
    const n = notice.backupsNotCleaned;
    messages.push(
      `${n} automatic backup${n === 1 ? '' : 's'} on this computer could not be cleaned and may still hold this data.`,
    );
  }
  return messages;
}

// ---- Device memory: localStorage, so it survives a rebuilt or restored local database ----

const LIST_PREFIX = 'alokas:revoked:';
const CLEANED_PREFIX = 'alokas:revokedCleaned:';
const HELD_PREFIX = 'alokas:revokedHeldNoticed:';

function readIds(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* Private window or full storage: the next sync says the same again. */
  }
}

/** Overwritten at each trustworthy sync, so access coming back lifts the block. */
export function recordRevokedList(userId: string, ids: string[]): void {
  writeIds(`${LIST_PREFIX}${userId}`, ids);
  const current = new Set(ids);
  for (const prefix of [CLEANED_PREFIX, HELD_PREFIX]) {
    writeIds(
      `${prefix}${userId}`,
      readIds(`${prefix}${userId}`).filter((id) => current.has(id)),
    );
  }
}

/** Every account's list. A restore can't tell which account a backup's rows belonged to. */
export function deviceRevokedIds(): Set<string> {
  const ids = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LIST_PREFIX)) readIds(key).forEach((id) => ids.add(id));
    }
  } catch {
    /* Storage unavailable: the next sync removes anything restored. */
  }
  return ids;
}

export function idsNotYetCleaned(userId: string, ids: string[]): string[] {
  const done = new Set(readIds(`${CLEANED_PREFIX}${userId}`));
  return ids.filter((id) => !done.has(id));
}

export function markCleaned(userId: string, ids: string[]): void {
  writeIds(`${CLEANED_PREFIX}${userId}`, [...new Set([...readIds(`${CLEANED_PREFIX}${userId}`), ...ids])]);
}

export function idsNotYetNoticedAsHeld(userId: string, ids: string[]): string[] {
  const done = new Set(readIds(`${HELD_PREFIX}${userId}`));
  return ids.filter((id) => !done.has(id));
}

export function markNoticedAsHeld(userId: string, ids: string[]): void {
  writeIds(`${HELD_PREFIX}${userId}`, [...new Set([...readIds(`${HELD_PREFIX}${userId}`), ...ids])]);
}
