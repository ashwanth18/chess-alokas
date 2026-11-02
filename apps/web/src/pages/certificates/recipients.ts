/**
 * Who gets a certificate: everyone who played, the top places from the standings, or rows from a
 * CSV. Pure, so the page only holds state.
 */
import { computeSectionStandings, computeStandings } from '@chess-alokas/pairing-engine';
import {
  participantToRow,
  winnerToRow,
  winnersFromStandings,
  type CertificateRow,
} from '@chess-alokas/certificates';
import type { GameResult, TiebreakKey } from '@chess-alokas/shared';
import type { LocalCategory, LocalGame, LocalParticipant, LocalTournament } from '../../db/local';
import { isMixedTournament } from '../../lib/tournamentProgress';

export type CertMode = 'participation' | 'winner' | 'csv';

export type CertRow = {
  /** Participant id, or `${categoryId}:${participantId}` for a winner in a section, or a CSV row id. */
  id: string;
  fileName: string;
  row: CertificateRow;
  email?: string;
  participantId: string | null;
  categoryId: string | null;
  /** "#12 · U12", for telling two players with one name apart. */
  disambiguator: string | null;
};

const UUID = /^[0-9a-f-]{36}$/i;

export function cellText(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

export function rowName(r: CertRow): string {
  return String(r.row.name ?? r.fileName);
}

/** Category and place, for the recipients table. */
export function rowDetails(r: CertRow): string {
  return [cellText(r.row.category), cellText(r.row.place)].filter(Boolean).join(', ');
}

function dis(seed: number | null | undefined, section: string): string | null {
  const parts = [seed != null ? `#${seed}` : null, section || null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function buildTournamentRows(input: {
  mode: 'participation' | 'winner';
  tournament: LocalTournament;
  participants: LocalParticipant[];
  categories: LocalCategory[];
  games: LocalGame[];
  /** Serial for a row id: one already reserved, or the next unreserved one in sequence. */
  serialFor: (rowId: string) => string;
}): { rows: CertRow[]; problem: string | null } {
  const { mode, tournament, participants, categories, games, serialFor } = input;
  const date = tournament.date ? new Date(tournament.date).toLocaleDateString() : '';
  const sectionsOf = (p: LocalParticipant) =>
    categories.filter((c) => p.categoryIds?.includes(c.id)).map((c) => c.name).join(', ');

  if (mode === 'participation') {
    return {
      problem: null,
      rows: participants.map((p) => ({
        id: p.id,
        fileName: p.name,
        email: p.email ?? undefined,
        participantId: p.id,
        categoryId: null,
        disambiguator: dis(p.seed, sectionsOf(p)),
        row: participantToRow(p, {
          tournament: tournament.name,
          date,
          category: sectionsOf(p),
          serial: serialFor(p.id),
        }),
      })),
    };
  }

  const finished = games.filter((g) => g.result !== 'pending');
  if (finished.length === 0) {
    return { rows: [], problem: 'No results yet. Winners are worked out from results, so enter some first.' };
  }
  const topN = tournament.prizePlaces ?? 3;
  const scope = tournament.awardScope ?? 'per_category';
  const enginePlayers = participants.map((p) => ({
    id: p.id,
    name: p.name,
    rating: p.rating ?? undefined,
    seed: p.seed,
  }));
  const toPast = (list: LocalGame[]) =>
    list.map((g) => ({
      round: g.round,
      whiteId: g.whiteId ?? null,
      blackId: g.blackId ?? null,
      result: g.result as GameResult,
      isBye: g.isBye,
    }));
  const opts = {
    tiebreakOrder: (tournament.tiebreakOrder as TiebreakKey[] | null) ?? null,
    sharedPlaces: tournament.sharedPlaces ?? true,
  };
  const rows: CertRow[] = [];
  let failed = false;

  if (scope === 'overall' || categories.length === 0) {
    try {
      for (const s of winnersFromStandings(computeStandings(enginePlayers, toPast(finished), opts), topN)) {
        const p = participants.find((x) => x.id === s.id);
        rows.push({
          id: s.id,
          fileName: `${s.rank}_${s.name}`,
          email: p?.email ?? undefined,
          participantId: s.id,
          categoryId: null,
          disambiguator: dis(p?.seed, 'Overall'),
          row: winnerToRow(s, { tournament: tournament.name, date, category: 'Overall', serial: serialFor(s.id) }),
        });
      }
    } catch {
      failed = true;
    }
  } else {
    const mixed = isMixedTournament(tournament);
    for (const cat of categories) {
      const inCat = participants.filter((p) => p.categoryIds?.includes(cat.id));
      try {
        const standings = mixed
          ? computeSectionStandings(enginePlayers, toPast(finished), new Set(inCat.map((p) => p.id)), opts)
          : computeStandings(
              enginePlayers.filter((p) => inCat.some((c) => c.id === p.id)),
              toPast(finished.filter((g) => g.categoryId === cat.id)),
              opts,
            );
        for (const s of winnersFromStandings(standings, cat.prizePlaces ?? topN)) {
          const p = participants.find((x) => x.id === s.id);
          const rowId = `${cat.id}:${s.id}`;
          rows.push({
            id: rowId,
            fileName: `${cat.name}_${s.rank}_${s.name}`,
            email: p?.email ?? undefined,
            participantId: s.id,
            categoryId: cat.id,
            disambiguator: dis(p?.seed, cat.name),
            row: winnerToRow(s, { tournament: tournament.name, date, category: cat.name, serial: serialFor(rowId) }),
          });
        }
      } catch {
        failed = true;
      }
    }
  }
  return {
    rows,
    problem: failed ? 'Standings for some sections could not be worked out, so their winners are missing.' : null,
  };
}

/** Parses CSV rows that Papa has already split by header. Rows with nothing in them are dropped. */
export function csvRows(data: Array<Record<string, unknown>>, makeId: () => string): CertRow[] {
  return data
    .map((raw, i) => {
      const row: CertificateRow = {};
      for (const [k, v] of Object.entries(raw)) {
        const key = k.trim();
        if (key) row[key] = cellText(v);
      }
      const name = String(row['name'] ?? row['Name'] ?? `Row ${i + 1}`);
      return {
        id: makeId(),
        fileName: name,
        email: String(row['email'] ?? row['Email'] ?? '') || undefined,
        participantId: null,
        categoryId: null,
        disambiguator: null,
        row,
      };
    })
    .filter((r) => Object.values(r.row).some((v) => String(v ?? '').trim()));
}

/** What the server stores for one issued certificate, minus the PDF. */
export function issueFields(r: CertRow, type: 'participation' | 'winner') {
  return {
    participantId: r.participantId && UUID.test(r.participantId) ? r.participantId : null,
    categoryId: r.categoryId && UUID.test(r.categoryId) ? r.categoryId : null,
    type,
    rank: typeof r.row.rank === 'number' ? r.row.rank : Number(r.row.rank) || null,
    recipientEmail: r.email?.trim() || null,
    recipientName: rowName(r),
    serial: String(r.row.serial ?? '') || null,
  };
}
