import type { Sql } from 'postgres';
import {
  DEMO_ORG_SLUG,
  assertDemoScope,
  assertRealCountsUnchanged,
} from './constants.js';
import type {
  DemoAccount,
  DemoCleared,
  DemoOps,
  DemoOrganization,
  DemoPlan,
  DemoScopeFacts,
  DemoWriteResult,
} from './types.js';

/** Old tombstones go. A device offline this long may keep a stale copy until it is cleared. */
const TOMBSTONE_DAYS = 30;
const INSERT_BATCH = 200;
const POSTGRES_UNDEFINED_TABLE = '42P01';

class RollBack extends Error {}

interface DemoTournamentRow {
  id: string;
  name: string;
  style: string;
  rounds: number;
  owner_id: string | null;
  organization_id: string | null;
  deleted_at: Date | string | null;
}

function toSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

type ColumnTypes = Map<string, string>;

async function columnsOf(s: Sql, table: string): Promise<ColumnTypes> {
  const rows = await s<{ column_name: string; data_type: string }[]>`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  return new Map(rows.map((r) => [r.column_name, r.data_type]));
}

/**
 * Writes rows using only the columns this database has, so the plan can carry fields from
 * migrations production hasn't applied yet. What it drops goes in `skipped`, for the report.
 */
async function insertRows(
  s: Sql,
  table: string,
  rows: object[],
  skipped: Set<string>,
): Promise<void> {
  if (rows.length === 0) return;
  const columns = await columnsOf(s, table);
  const usable = new Set<string>();
  const converted = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value === undefined) continue;
      const column = toSnake(key);
      const type = columns.get(column);
      if (!type) {
        skipped.add(`${table}.${column}`);
        continue;
      }
      usable.add(column);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out[column] = (type === 'jsonb' || type === 'json') && value !== null ? s.json(value as any) : value;
    }
    return out;
  });
  const names = [...usable];
  for (let i = 0; i < converted.length; i += INSERT_BATCH) {
    const batch = converted
      .slice(i, i + INSERT_BATCH)
      .map((row) => Object.fromEntries(names.map((n) => [n, row[n] ?? null])));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await s`INSERT INTO ${s(table)} ${s(batch as any, ...names)}`;
  }
}

async function factsIn(s: Sql): Promise<DemoScopeFacts> {
  const orgs = await s<{ id: string; slug: string }[]>`
    SELECT id::text AS id, slug FROM organizations WHERE is_demo
  `;
  const [foreign] = await s<{ members: string; links: string; holder: string }[]>`
    SELECT
      (
        SELECT COUNT(*)::text FROM (
          SELECT m.user_id
          FROM organization_members m
          JOIN organizations o ON o.id = m.organization_id
          WHERE o.is_demo AND m.user_id NOT IN (SELECT user_id FROM demo_accounts)
          UNION
          SELECT o.created_by
          FROM organizations o
          WHERE o.is_demo AND o.created_by IS NOT NULL
            AND o.created_by NOT IN (SELECT user_id FROM demo_accounts)
        ) people
      ) AS members,
      (
        SELECT COUNT(*)::text
        FROM participants p
        JOIN player_profiles pp ON pp.id = p.player_profile_id
        WHERE pp.account_user_id IN (SELECT user_id FROM demo_accounts)
          AND p.tournament_id NOT IN (SELECT id FROM demo_tournament_ids)
      ) AS links,
      (
        SELECT COUNT(*)::text FROM organizations
        WHERE NOT is_demo AND lower(slug) = ${DEMO_ORG_SLUG}
      ) AS holder
  `;
  return {
    flaggedOrganizations: orgs.map((o) => ({ id: o.id, slug: o.slug })),
    unflaggedSlugHolder: Number(foreign?.holder ?? 0) > 0,
    foreignMembers: Number(foreign?.members ?? 0),
    foreignProfileLinks: Number(foreign?.links ?? 0),
  };
}

async function realCountsIn(s: Sql): Promise<Record<string, number>> {
  const [row] = await s<Record<string, string>[]>`
    SELECT
      (SELECT COUNT(*)::text FROM organizations WHERE NOT is_demo) AS organizations,
      (
        SELECT COUNT(*)::text FROM tournaments
        WHERE id NOT IN (SELECT id FROM demo_tournament_ids)
      ) AS tournaments,
      (
        SELECT COUNT(*)::text FROM participants
        WHERE tournament_id NOT IN (SELECT id FROM demo_tournament_ids)
      ) AS participants,
      (
        SELECT COUNT(*)::text FROM games
        WHERE tournament_id NOT IN (SELECT id FROM demo_tournament_ids)
      ) AS games,
      (
        SELECT COUNT(*)::text FROM tournament_registrations
        WHERE tournament_id NOT IN (SELECT id FROM demo_tournament_ids)
      ) AS registrations,
      (
        SELECT COUNT(*)::text FROM player_profiles
        WHERE account_user_id NOT IN (SELECT user_id FROM demo_accounts)
      ) AS "playerProfiles",
      (
        SELECT COUNT(*)::text FROM auth.users
        WHERE id NOT IN (SELECT user_id FROM demo_accounts)
      ) AS users
  `;
  return Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, Number(v)]));
}

/** Reads the fields it needs rather than selecting columns, as other features add files of their own. */
function filePathsOf(row: Record<string, unknown>): string[] {
  const paths: string[] = [];
  if (typeof row['receipt_storage_path'] === 'string') paths.push(row['receipt_storage_path']);
  const files = row['private_files'];
  if (Array.isArray(files)) {
    for (const file of files) {
      const stored = (file as { storagePath?: unknown } | null)?.storagePath;
      if (typeof stored === 'string') paths.push(stored);
    }
  }
  return paths;
}

async function clearIn(
  s: Sql,
  options: { removeTenant: boolean; nowIso: string },
): Promise<DemoCleared> {
  const { removeTenant, nowIso } = options;
  await s`SELECT pg_advisory_xact_lock(hashtextextended('demo:reset', 0))`;
  const facts = await factsIn(s);
  assertDemoScope(facts);
  const orgId = facts.flaggedOrganizations[0]?.id ?? null;

  const tournaments = await s<DemoTournamentRow[]>`
    SELECT id::text AS id, name, style, rounds, owner_id::text AS owner_id,
           organization_id::text AS organization_id, deleted_at
    FROM tournaments
    WHERE id IN (SELECT id FROM demo_tournament_ids)
  `;
  const ids = tournaments.map((t) => t.id);
  const receiptPaths: string[] = [];
  const certificatePaths: string[] = [];

  if (ids.length > 0) {
    const regs = await s<Record<string, unknown>[]>`
      SELECT * FROM tournament_registrations WHERE tournament_id IN ${s(ids)}
    `;
    for (const reg of regs) receiptPaths.push(...filePathsOf(reg));
    const certs = await s<{ storage_path: string | null }[]>`
      SELECT storage_path FROM certificate_issues WHERE tournament_id IN ${s(ids)}
    `;
    for (const cert of certs) if (cert.storage_path) certificatePaths.push(cert.storage_path);

    // These keep the row with a null tournament otherwise, and it would then count as real.
    await s`DELETE FROM page_views WHERE tournament_id IN ${s(ids)}`;
    await s`DELETE FROM email_sends WHERE tournament_id IN ${s(ids)}`;
    // Cascades to every child table, including any added later.
    await s`DELETE FROM tournaments WHERE id IN ${s(ids)}`;

    if (!removeTenant) {
      const cutoff = new Date(Date.parse(nowIso) - TOMBSTONE_DAYS * 86_400_000).toISOString();
      for (const t of tournaments) {
        const deletedAt = t.deleted_at ? new Date(t.deleted_at).toISOString() : null;
        if (deletedAt && deletedAt < cutoff) continue;
        await s`
          INSERT INTO tournaments (
            id, name, style, rounds, status, current_round, owner_id, organization_id,
            updated_at, deleted_at
          )
          VALUES (
            ${t.id}, ${t.name}, ${t.style}, ${t.rounds}, 'draft', 0,
            ${t.owner_id}, ${t.organization_id}, ${nowIso}, ${deletedAt ?? nowIso}
          )
        `;
      }
    }
  }

  const profiles = await s`
    DELETE FROM player_profiles
    WHERE account_user_id IN (SELECT user_id FROM demo_accounts)
    RETURNING id
  `;

  if (orgId) {
    await s`DELETE FROM organization_invites WHERE organization_id = ${orgId}`;
    await s`DELETE FROM organization_members WHERE organization_id = ${orgId}`;
    if (removeTenant) {
      await s`UPDATE profiles SET default_organization_id = NULL WHERE default_organization_id = ${orgId}`;
      await s`DELETE FROM organizations WHERE id = ${orgId} AND is_demo`;
    }
  }

  return {
    tournamentsRemoved: tournaments.filter((t) => !t.deleted_at).length,
    profilesRemoved: profiles.length,
    receiptPaths,
    certificatePaths,
  };
}

async function writeOrganization(s: Sql, plan: DemoPlan, skipped: Set<string>): Promise<void> {
  const columns = await columnsOf(s, 'organizations');
  const org = plan.organization;
  const row: Record<string, unknown> = {
    ...org,
    isDemo: true,
    // A closed organization, from an attempt to delete the owner, comes back open.
    closedAt: null,
    anonymiseAfter: null,
  };
  const [existing] = await s<{ can_publish_global: boolean }[]>`
    SELECT can_publish_global FROM organizations WHERE id = ${org.id} AND is_demo
  `;
  if (!existing) {
    await insertRows(s, 'organizations', [row], skipped);
    return;
  }
  // The listing switch is the founder's choice, so a reset leaves it as it was.
  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const column = toSnake(key);
    if (value === undefined || column === 'id' || column === 'created_at') continue;
    if (column === 'can_publish_global') continue;
    if (columns.has(column)) update[column] = value;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await s`UPDATE organizations SET ${s(update as any, ...Object.keys(update))} WHERE id = ${org.id} AND is_demo`;
}

async function writePlan(s: Sql, plan: DemoPlan, skipped: Set<string>): Promise<void> {
  await writeOrganization(s, plan, skipped);
  for (const m of plan.members) {
    await s`
      INSERT INTO organization_members (organization_id, user_id, role, email)
      VALUES (${plan.organization.id}, ${m.userId}, ${m.role}, ${m.email.toLowerCase()})
    `;
    await s`
      UPDATE profiles
      SET default_organization_id = ${plan.organization.id},
          account_role = 'organizer'
      WHERE id = ${m.userId}
    `;
  }
  await insertRows(s, 'player_profiles', plan.profiles, skipped);
  for (const t of plan.tournaments) {
    await insertRows(s, 'tournaments', [t.tournament], skipped);
    await insertRows(s, 'categories', t.categories, skipped);
    await insertRows(s, 'participants', t.participants, skipped);
    await insertRows(s, 'games', t.games, skipped);
    await insertRows(s, 'game_result_events', t.resultEvents, skipped);
    await insertRows(s, 'game_cards', t.cards, skipped);
    await insertRows(s, 'tournament_tables', t.tables, skipped);
    await insertRows(s, 'floor_alerts', t.alerts, skipped);
    await insertRows(s, 'tournament_registrations', t.registrations, skipped);
    await insertRows(s, 'certificate_issues', t.certificates, skipped);
  }
}

export function createPostgresDemoOps(sql: Sql): DemoOps {
  const tx = <T>(fn: (s: Sql) => Promise<T>): Promise<T> =>
    sql.begin((t) => fn(t as unknown as Sql)) as Promise<T>;

  return {
    async isAccount(userId) {
      try {
        const rows = await sql`SELECT 1 FROM demo_accounts WHERE user_id = ${userId} LIMIT 1`;
        return rows.length > 0;
      } catch (err) {
        // An API deployed before migration 036 has no demo accounts, and must keep working.
        if ((err as { code?: string }).code === POSTGRES_UNDEFINED_TABLE) return false;
        throw err;
      }
    },

    async listAccounts() {
      const rows = await sql<{ user_id: string; email: string; label: string }[]>`
        SELECT user_id::text AS user_id, email, label FROM demo_accounts ORDER BY created_at, label
      `;
      return rows.map((r): DemoAccount => ({ userId: r.user_id, email: r.email, label: r.label }));
    },

    async registerAccount(account) {
      await sql`
        INSERT INTO demo_accounts (user_id, email, label)
        VALUES (${account.userId}, ${account.email}, ${account.label})
        ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, label = EXCLUDED.label
      `;
    },

    async forgetAccounts() {
      await sql`DELETE FROM demo_accounts`;
    },

    async setCredentialsUnlocked(userIds, untilIso) {
      if (userIds.length === 0) return;
      await sql`
        UPDATE demo_accounts SET credentials_unlocked_until = ${untilIso}
        WHERE user_id IN ${sql(userIds)}
      `;
    },

    async getOrganization() {
      const [row] = await sql<
        { id: string; name: string; slug: string; can_publish_global: boolean }[]
      >`SELECT id::text AS id, name, slug, can_publish_global FROM organizations WHERE is_demo ORDER BY created_at LIMIT 1`;
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        canPublishGlobal: row.can_publish_global,
        isDemo: true,
      } as DemoOrganization;
    },

    async setPubliclyListed(listed) {
      const rows = await sql`
        UPDATE organizations SET can_publish_global = ${listed}
        WHERE is_demo AND slug = ${DEMO_ORG_SLUG}
        RETURNING id
      `;
      return rows.length === 1;
    },

    scopeFacts() {
      return factsIn(sql);
    },

    async capabilities() {
      const [row] = await sql<{ nric: boolean; lock: boolean }[]>`
        SELECT
          EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'tournament_registrations'
              AND column_name = 'nric_number'
          ) AS nric,
          EXISTS (
            SELECT 1 FROM pg_trigger WHERE tgname = 'trg_protect_demo_account_credentials'
          ) AS lock
      `;
      return { formBuilder: Boolean(row?.nric), credentialLock: Boolean(row?.lock) };
    },

    realCounts() {
      return realCountsIn(sql);
    },

    async apply(plan, options): Promise<DemoWriteResult> {
      const nowIso = new Date().toISOString();
      const skipped = new Set<string>();
      let result: DemoWriteResult | null = null;
      try {
        await tx(async (s) => {
          await s`SELECT set_config('app.demo_seed', 'on', true)`;
          // A dry run has no sign-in accounts yet, and the foreign keys need rows to point at.
          for (const a of options?.placeholderAccounts ?? []) {
            await s`INSERT INTO auth.users (id, email) VALUES (${a.userId}, ${a.email})`.catch((err: Error) => {
              throw new Error(`A dry run could not stand in for accounts that don't exist yet: ${err.message}`);
            });
            await s`
              INSERT INTO demo_accounts (user_id, email, label)
              VALUES (${a.userId}, ${a.email}, ${a.label})
            `;
          }
          const before = await realCountsIn(s);
          const cleared = await clearIn(s, { removeTenant: false, nowIso });
          await writePlan(s, plan, skipped);
          const realCounts = await realCountsIn(s);
          assertRealCountsUnchanged(before, realCounts);
          result = {
            cleared,
            skippedColumns: [...skipped].sort(),
            realCounts,
            rolledBack: Boolean(options?.dryRun),
          };
          if (options?.dryRun) throw new RollBack();
        });
      } catch (err) {
        if (!(err instanceof RollBack)) throw err;
      }
      return result!;
    },

    async removeAll() {
      const nowIso = new Date().toISOString();
      return tx(async (s) => {
        await s`SELECT set_config('app.demo_seed', 'on', true)`;
        const before = await realCountsIn(s);
        const cleared = await clearIn(s, { removeTenant: true, nowIso });
        assertRealCountsUnchanged(before, await realCountsIn(s));
        return cleared;
      });
    },
  };
}
