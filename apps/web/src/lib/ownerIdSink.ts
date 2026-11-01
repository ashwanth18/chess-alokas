/**
 * The signed-in user's id belongs in the local database's `meta` table, but AuthContext runs on every
 * route and must not load Dexie on a parent's phone. So it reports the id here, and OrganizerShell
 * writes it whenever the database is actually open, including any value reported before then.
 */
type Sink = (userId: string | null) => Promise<void>;

let latest: string | null | undefined;
let sink: Sink | null = null;

function write(userId: string | null) {
  sink?.(userId).catch((err: unknown) => console.warn('[auth] persistOwnerId failed', err));
}

export async function persistOwnerId(userId: string | null): Promise<void> {
  latest = userId;
  write(userId);
}

export function connectOwnerIdSink(next: Sink): () => void {
  sink = next;
  if (latest !== undefined) write(latest);
  return () => {
    if (sink === next) sink = null;
  };
}
