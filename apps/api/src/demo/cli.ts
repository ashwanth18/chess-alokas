/**
 * Loads the demo tenant. See docs/DEMO.md.
 *
 *   pnpm demo:seed [--dry-run]     Builds it, or does nothing if it is already there
 *   pnpm demo:reset [--dry-run]    Rebuilds it with today's dates
 *   pnpm demo:delete               Removes it completely
 *   pnpm demo:list on|off          The switch for public Discover
 *
 * Reads the environment only, never a .env file, so it can't pick up the wrong database by
 * accident. Doesn't use the app's store: production's schema may be behind this checkout, and
 * this has to work against either.
 */
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { cliFileStore, supabaseAuthAdmin } from './cliParts.js';
import { createPostgresDemoOps } from './postgresOps.js';
import { demoDelete, demoDryRun, demoReset, demoSeed, demoSetListed, type DemoRunContext } from './runner.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

/** Refuses a run that doesn't name the project it is about to change. */
function assertConfirmed(host: string, dryRun: boolean): void {
  if (dryRun || host === 'localhost' || host === '127.0.0.1') return;
  if (process.env['DEMO_CONFIRM'] !== host) {
    throw new Error(`This changes ${host}. To confirm, set DEMO_CONFIRM=${host}`);
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes('--dry-run');
  const databaseUrl = required('DATABASE_URL');
  const supabaseUrl = required('SUPABASE_URL');
  const secret = process.env['SUPABASE_SECRET_KEY'] || process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!secret) throw new Error('SUPABASE_SECRET_KEY is required.');
  const host = new URL(supabaseUrl).hostname;
  console.log(`Target: ${host}${dryRun ? ' (dry run)' : ''}`);
  assertConfirmed(host, dryRun);

  const sql = postgres(databaseUrl, { max: 4, prepare: false, onnotice: () => undefined });
  try {
    const [check] = await sql<{ applied: boolean }[]>`
      SELECT to_regclass('public.demo_accounts') IS NOT NULL AS applied
    `;
    if (!check?.applied) {
      throw new Error('Migration 036_demo_tenant.sql is not applied to this database. Apply it first.');
    }
    const client = createClient(supabaseUrl, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const ctx: DemoRunContext = {
      ops: createPostgresDemoOps(sql),
      auth: supabaseAuthAdmin(client),
      files: cliFileStore,
      env: process.env,
      log: (line) => console.log(line),
    };
    if (dryRun) {
      for (const bucket of ['certificates', 'registration-receipts']) {
        const { error } = await client.storage.getBucket(bucket);
        console.log(`Storage bucket ${bucket}: ${error ? `NOT FOUND (${error.message})` : 'found'}`);
      }
    }
    switch (command) {
      case 'seed':
        if (dryRun) await demoDryRun(ctx);
        else await demoSeed(ctx);
        break;
      case 'reset':
        if (dryRun) await demoDryRun(ctx);
        else await demoReset(ctx);
        break;
      case 'delete':
        if (dryRun) throw new Error('demo:delete has no dry run. demo:seed --dry-run shows what is there.');
        await demoDelete(ctx);
        break;
      case 'list':
        if (rest[0] !== 'on' && rest[0] !== 'off') throw new Error('Say demo:list on or demo:list off.');
        await demoSetListed(ctx, rest[0] === 'on');
        break;
      default:
        throw new Error('Commands: seed, reset, delete, list on|off');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  // The message only: a driver's error object can carry the connection string.
  console.error(err instanceof Error ? err.message : 'The demo command failed.');
  process.exitCode = 1;
});
