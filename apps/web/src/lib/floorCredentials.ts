export type FloorCredentials = {
  arbiterName: string;
  pin: string;
  pinRound: number | null;
};

const key = (tournamentId: string) => `chess-alokas-floor:${tournamentId}`;

export function loadFloorCredentials(tournamentId: string | null | undefined): FloorCredentials | null {
  if (!tournamentId) return null;
  try {
    const raw = localStorage.getItem(key(tournamentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FloorCredentials;
    if (!parsed || typeof parsed.arbiterName !== 'string') return null;
    return {
      arbiterName: parsed.arbiterName,
      pin: typeof parsed.pin === 'string' ? parsed.pin : '',
      pinRound: typeof parsed.pinRound === 'number' ? parsed.pinRound : null,
    };
  } catch {
    return null;
  }
}

export function saveFloorCredentials(
  tournamentId: string,
  creds: FloorCredentials,
): void {
  try {
    localStorage.setItem(key(tournamentId), JSON.stringify(creds));
  } catch {
    /* ignore */
  }
}

export function clearFloorPin(tournamentId: string): void {
  const prev = loadFloorCredentials(tournamentId);
  if (!prev) return;
  saveFloorCredentials(tournamentId, { ...prev, pin: '', pinRound: null });
}
