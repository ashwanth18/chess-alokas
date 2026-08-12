export type LiveBookmark = {
  id: string;
  name: string;
};

const MAX_BOOKMARKS = 8;

const storageKey = (token: string) => `chess-alokas-live-bookmarks:${token}`;

export function loadLiveBookmarks(token: string | null | undefined): LiveBookmark[] {
  if (!token) return [];
  try {
    const raw = localStorage.getItem(storageKey(token));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: LiveBookmark[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const id = (item as LiveBookmark).id;
      const name = (item as LiveBookmark).name;
      if (typeof id !== 'string' || !id) continue;
      out.push({
        id,
        name: typeof name === 'string' && name.trim() ? name.trim() : 'Player',
      });
      if (out.length >= MAX_BOOKMARKS) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function saveLiveBookmarks(token: string, bookmarks: LiveBookmark[]): void {
  try {
    localStorage.setItem(
      storageKey(token),
      JSON.stringify(bookmarks.slice(0, MAX_BOOKMARKS)),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function isLiveBookmarked(
  token: string | null | undefined,
  playerId: string,
): boolean {
  return loadLiveBookmarks(token).some((b) => b.id === playerId);
}

/** Toggle bookmark; returns the new list. Cap at MAX_BOOKMARKS (won't add if full). */
export function toggleLiveBookmark(
  token: string,
  player: { id: string; name: string },
): LiveBookmark[] {
  const current = loadLiveBookmarks(token);
  const idx = current.findIndex((b) => b.id === player.id);
  let next: LiveBookmark[];
  if (idx >= 0) {
    next = current.filter((b) => b.id !== player.id);
  } else if (current.length >= MAX_BOOKMARKS) {
    next = current;
  } else {
    next = [...current, { id: player.id, name: player.name.trim() || 'Player' }];
  }
  saveLiveBookmarks(token, next);
  return next;
}
