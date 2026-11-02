import { randomUUID } from 'node:crypto';
import { demoEmailDomain, DEMO_ORG_SLUG } from './constants.js';
import { DEFAULT_DEMO_FLOOR_PIN, DEMO_LINKS, buildDemoPlan } from './plan.js';
import type { DemoAccount, DemoOps, DemoPlan, DemoWriteResult } from './types.js';

export type DemoLabel = 'owner' | 'director' | 'arbiter' | 'parent' | 'teen';

const LABELS: Array<{ label: DemoLabel; displayName: string; passwordEnv: string }> = [
  { label: 'owner', displayName: 'Puan Amina (Demo owner)', passwordEnv: 'DEMO_STAFF_PASSWORD' },
  { label: 'director', displayName: 'Farah (Demo director)', passwordEnv: 'DEMO_STAFF_PASSWORD' },
  { label: 'arbiter', displayName: 'Hakim (Demo arbiter)', passwordEnv: 'DEMO_STAFF_PASSWORD' },
  { label: 'parent', displayName: 'Encik Rashid (Demo parent)', passwordEnv: 'DEMO_PLAYER_PASSWORD' },
  { label: 'teen', displayName: 'Priya (Demo player)', passwordEnv: 'DEMO_PLAYER_PASSWORD' },
];

const MIN_PASSWORD_LENGTH = 12;
const UNLOCK_MS = 5 * 60_000;
const REAL_FILE_BATCH = 10;

/** The sign-in side. Supabase in production; a fake locally and in tests. */
export interface DemoAuthAdmin {
  findUserIdByEmail(email: string): Promise<string | null>;
  createUser(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<{ id: string }>;
  updatePassword(userId: string, password: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

export interface DemoFileStore {
  saveReceipt(tournamentId: string, registrationId: string, contentType: string, bytes: Uint8Array): Promise<string>;
  saveCertificate(tournamentId: string, issueId: string, bytes: Uint8Array): Promise<string>;
  deleteReceipt(path: string): Promise<void>;
  deleteCertificate(path: string): Promise<void>;
}

export interface DemoRunContext {
  ops: DemoOps;
  auth: DemoAuthAdmin;
  files: DemoFileStore;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
  now?: Date;
  /** Fixes the pairing style in tests. */
  style?: 'swiss' | 'dutch';
}

export function demoEmailOf(label: DemoLabel, env: NodeJS.ProcessEnv): string {
  return `demo-${label}@${demoEmailDomain(env)}`;
}

function passwordFor(passwordEnv: string, env: NodeJS.ProcessEnv): string | null {
  const value = env[passwordEnv];
  if (!value) return null;
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`${passwordEnv} must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return value;
}

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(run));
  }
}

/** Finds or creates each account. Passwords come from the environment and are never printed. */
async function provisionAccounts(ctx: DemoRunContext): Promise<Record<DemoLabel, DemoAccount>> {
  const { ops, auth, env, log } = ctx;
  const known = new Map((await ops.listAccounts()).map((a) => [a.label, a]));
  const out = {} as Record<DemoLabel, DemoAccount>;
  for (const { label, displayName, passwordEnv } of LABELS) {
    const email = demoEmailOf(label, env);
    const password = passwordFor(passwordEnv, env);
    let userId = known.get(label)?.userId ?? (await auth.findUserIdByEmail(email));
    if (!userId) {
      if (!password) throw new Error(`${passwordEnv} is required to create the demo accounts.`);
      try {
        userId = (await auth.createUser({ email, password, displayName })).id;
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown error';
        throw new Error(
          `Supabase refused to create ${email}: ${reason}. If it rejects the address, set DEMO_EMAIL_DOMAIN to a subdomain you own with no MX record (docs/DEMO.md).`,
        );
      }
      log(`  created account: ${label}`);
    } else if (password) {
      await ops.registerAccount({ userId, email, label });
      await ops.setCredentialsUnlocked([userId], new Date(Date.now() + UNLOCK_MS).toISOString());
      try {
        await auth.updatePassword(userId, password);
      } finally {
        await ops.setCredentialsUnlocked([userId], null);
      }
      log(`  password set from the environment: ${label}`);
    } else {
      log(`  kept password: ${label}`);
    }
    const account = { userId, email, label };
    await ops.registerAccount(account);
    out[label] = account;
  }
  return out;
}

async function uploadPlanFiles(ctx: DemoRunContext, plan: DemoPlan): Promise<{ receipts: string[]; certificates: string[] }> {
  const receipts: string[] = [];
  const certificates: string[] = [];
  await inBatches(plan.files, REAL_FILE_BATCH, async (file) => {
    if (file.kind === 'receipt') {
      receipts.push(
        await ctx.files.saveReceipt(file.tournamentId, file.ownerId, file.contentType, file.bytes),
      );
    } else {
      certificates.push(await ctx.files.saveCertificate(file.tournamentId, file.ownerId, file.bytes));
    }
  });
  return { receipts, certificates };
}

async function removeFiles(
  ctx: DemoRunContext,
  receipts: string[],
  certificates: string[],
): Promise<number> {
  let failed = 0;
  const attempt = async (remove: () => Promise<void>) => {
    try {
      await remove();
    } catch {
      failed += 1;
    }
  };
  await inBatches(receipts, REAL_FILE_BATCH, (p) => attempt(() => ctx.files.deleteReceipt(p)));
  await inBatches(certificates, REAL_FILE_BATCH, (p) => attempt(() => ctx.files.deleteCertificate(p)));
  return failed;
}

function reportPlan(ctx: DemoRunContext, plan: DemoPlan, result: DemoWriteResult): void {
  const { summary } = plan;
  const verb = result.rolledBack ? 'Would write' : 'Wrote';
  ctx.log(
    `${verb}: ${summary.tournaments} tournaments, ${summary.participants} players, ${summary.games} games, ${summary.registrations} entries, ${summary.certificates} certificates, ${summary.files} files. Pairing engine: ${summary.engine}.`,
  );
  ctx.log(
    `${result.rolledBack ? 'Would remove' : 'Removed'} first: ${result.cleared.tournamentsRemoved} demo tournaments, ${result.cleared.profilesRemoved} demo profiles.`,
  );
  ctx.log(`Real data, unchanged: ${JSON.stringify(result.realCounts)}`);
  if (result.skippedColumns.length > 0) {
    ctx.log(
      `Left out, as this database has no column for them (a re-run after the migration adds them): ${result.skippedColumns.join(', ')}`,
    );
  }
}

function reportLinks(ctx: DemoRunContext): void {
  const { slugs, liveToken } = DEMO_LINKS;
  ctx.log('Links, relative to the app:');
  ctx.log(`  Live page  /live/${liveToken}`);
  ctx.log(`  Venue TV   /live/${liveToken}/tv`);
  for (const slug of Object.values(slugs)) ctx.log(`  Register   /register/${slug}`);
}

async function buildPlan(ctx: DemoRunContext, accounts: Record<DemoLabel, DemoAccount>): Promise<DemoPlan> {
  const existing = await ctx.ops.getOrganization();
  return buildDemoPlan({
    now: ctx.now ?? new Date(),
    organizationId: existing?.id ?? randomUUID(),
    accounts,
    capabilities: await ctx.ops.capabilities(),
    floorPin: ctx.env['DEMO_FLOOR_PIN'] || DEFAULT_DEMO_FLOOR_PIN,
    style: ctx.style,
    env: ctx.env,
  });
}

/** Builds or rebuilds the tenant. */
async function rebuild(ctx: DemoRunContext): Promise<DemoWriteResult> {
  const { ops, log } = ctx;
  const accounts = await provisionAccounts(ctx);
  const plan = await buildPlan(ctx, accounts);
  const capabilities = await ops.capabilities();
  log(`Password and deletion lock on auth.users: ${capabilities.credentialLock ? 'on' : 'NOT ON'}`);
  log(`Form builder fields (034): ${capabilities.formBuilder ? 'yes' : 'no, left out until a re-run'}`);
  const uploaded = await uploadPlanFiles(ctx, plan);
  let result: DemoWriteResult;
  try {
    result = await ops.apply(plan);
  } catch (err) {
    await removeFiles(ctx, uploaded.receipts, uploaded.certificates);
    throw err;
  }
  const failed = await removeFiles(ctx, result.cleared.receiptPaths, result.cleared.certificatePaths);
  if (failed > 0) log(`Could not remove ${failed} old demo file(s). They are unreachable, and harmless.`);
  reportPlan(ctx, plan, result);
  reportLinks(ctx);
  return result;
}

export async function demoSeed(ctx: DemoRunContext): Promise<void> {
  const existing = await ctx.ops.getOrganization();
  if (existing) {
    ctx.log(
      `The demo tenant (${DEMO_ORG_SLUG}) is already here, so nothing changed. Run demo:reset to rebuild it, which also moves its dates to today and adds any new fields.`,
    );
    return;
  }
  await rebuild(ctx);
}

export async function demoReset(ctx: DemoRunContext): Promise<void> {
  await rebuild(ctx);
}

/**
 * Runs the real SQL in a transaction that is rolled back. It creates no accounts, uploads nothing
 * and leaves the database as it was.
 */
export async function demoDryRun(ctx: DemoRunContext): Promise<void> {
  const { ops, log, env } = ctx;
  const capabilities = await ops.capabilities();
  log(`Password and deletion lock on auth.users: ${capabilities.credentialLock ? 'on' : 'NOT ON'}`);
  log(`Form builder fields (034): ${capabilities.formBuilder ? 'yes' : 'no, left out until a re-run'}`);
  const known = new Map((await ops.listAccounts()).map((a) => [a.label, a]));
  const accounts = {} as Record<DemoLabel, DemoAccount>;
  const placeholderAccounts: DemoAccount[] = [];
  for (const { label, passwordEnv } of LABELS) {
    const email = demoEmailOf(label, env);
    if (!known.has(label) && !env[passwordEnv]) {
      log(`Missing ${passwordEnv}: needed to create ${label}.`);
    }
    passwordFor(passwordEnv, env);
    let userId = known.get(label)?.userId ?? (await ctx.auth.findUserIdByEmail(email));
    if (!userId) {
      userId = randomUUID();
      placeholderAccounts.push({ userId, email, label });
      log(`Would create account: ${email}`);
    } else {
      log(`Account exists: ${email}`);
    }
    accounts[label] = { userId, email, label };
  }
  const plan = await buildPlan(ctx, accounts);
  const result = await ops.apply(plan, { dryRun: true, placeholderAccounts });
  reportPlan(ctx, plan, result);
  log(`Rolled back. No accounts, files or rows were changed.`);
}

/**
 * Removes the whole tenant: tournaments, organization, profiles, files, sign-in accounts.
 * Nothing that isn't marked as demo. Safe to repeat if a step fails part way.
 */
export async function demoDelete(ctx: DemoRunContext): Promise<void> {
  const { ops, auth, log } = ctx;
  const accounts = await ops.listAccounts();
  const cleared = await ops.removeAll();
  const failedFiles = await removeFiles(ctx, cleared.receiptPaths, cleared.certificatePaths);
  await ops.setCredentialsUnlocked(accounts.map((a) => a.userId), new Date(Date.now() + UNLOCK_MS).toISOString());
  let failedAccounts = 0;
  for (const account of accounts) {
    try {
      await auth.deleteUser(account.userId);
    } catch {
      failedAccounts += 1;
    }
  }
  log(
    `Removed ${cleared.tournamentsRemoved} tournaments, ${cleared.profilesRemoved} profiles, ${
      cleared.receiptPaths.length + cleared.certificatePaths.length - failedFiles
    } files and ${accounts.length - failedAccounts} accounts.`,
  );
  if (failedFiles > 0) log(`Could not remove ${failedFiles} file(s).`);
  if (failedAccounts > 0) {
    await ops.setCredentialsUnlocked(accounts.map((a) => a.userId), null);
    throw new Error(`${failedAccounts} sign-in account(s) could not be deleted. Run demo:delete again.`);
  }
  await ops.forgetAccounts();
}

/** The one switch for public Discover. Direct links and demo accounts work either way. */
export async function demoSetListed(ctx: DemoRunContext, listed: boolean): Promise<void> {
  const changed = await ctx.ops.setPubliclyListed(listed);
  if (!changed) throw new Error('There is no demo tenant to change. Run demo:seed first.');
  ctx.log(
    listed
      ? 'Demo events now appear in public Discover and the app.'
      : 'Demo events are now hidden from public Discover and the app. Their direct links still work.',
  );
}
