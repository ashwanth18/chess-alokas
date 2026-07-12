import { db, nowIso } from '../db/local';

/** Soft-delete tournament and all related records; marks dirty for sync. */
export async function softDeleteTournament(tournamentId: string): Promise<boolean> {
  const tournament = await db.tournaments.get(tournamentId);
  if (!tournament || tournament.deletedAt) return false;

  const now = nowIso();

  await db.tournaments.update(tournamentId, {
    deletedAt: now,
    updatedAt: now,
    dirty: 1,
  });

  const [categories, participants, games] = await Promise.all([
    db.categories
      .where('tournamentId')
      .equals(tournamentId)
      .filter((c) => !c.deletedAt)
      .toArray(),
    db.participants
      .where('tournamentId')
      .equals(tournamentId)
      .filter((p) => !p.deletedAt)
      .toArray(),
    db.games
      .where('tournamentId')
      .equals(tournamentId)
      .filter((g) => !g.deletedAt)
      .toArray(),
  ]);

  await Promise.all([
    ...categories.map((c) =>
      db.categories.update(c.id, { deletedAt: now, updatedAt: now, dirty: 1 }),
    ),
    ...participants.map((p) =>
      db.participants.update(p.id, { deletedAt: now, updatedAt: now, dirty: 1 }),
    ),
    ...games.map((g) => db.games.update(g.id, { deletedAt: now, updatedAt: now, dirty: 1 })),
  ]);

  return true;
}
