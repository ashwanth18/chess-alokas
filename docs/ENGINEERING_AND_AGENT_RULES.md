# Chess Alokas — Engineering & Agent Rules Handbook

This document is the authoritative engineering standard for **Chess Alokas 2.0** (Web, Fastify API, Electron Desktop, Flutter Mobile App, Shared Packages, and Supabase Postgres). Every developer and AI agent working on this repository **must** follow these rules.

---

## 1. Monorepo Architecture & Layer Boundaries

| Path | Package / Target | Responsibility | Allowed Dependencies |
|------|------------------|----------------|----------------------|
| `packages/shared` | `@chess-alokas/shared` | Domain types, Zod schemas, category filter evaluator, tiebreak definitions, certificate serial & mail helpers | `zod` only (no Node-only or browser-only APIs) |
| `packages/pairing-engine` | `@chess-alokas/pairing-engine` | Swiss pairing engine, FIDE Dutch (`bbpPairings` v6 + TypeScript Dutch), standings & tiebreaks, simulator | `@chess-alokas/shared` |
| `packages/certificates` | `@chess-alokas/certificates` | PDF stamping (`pdf-lib`), batch ZIP generation, light PDF compression | `@chess-alokas/shared`, `@chess-alokas/pairing-engine` |
| `apps/api` | `@chess-alokas/api` | Fastify REST API, JWT auth, multi-tenant RBAC, `MemoryStore` + `PostgresStore`, FIDE lookup, floor PIN/QR, public live & discovery | All `packages/*` |
| `apps/web` | `@chess-alokas/web` | Offline-first React UI (Dexie IndexedDB + cloud sync), Organizer Desk, Participant Portal (`/player`, `/discover`, `/register/:slug`), Floor Scoring, Live & TV views | All `packages/*` |
| `apps/desktop` | `@chess-alokas/desktop` | Electron main/preload shell, NSIS/DMG/AppImage updater, native `bbpPairings` IPC | `@chess-alokas/pairing-engine`, bundles `apps/web` + `apps/api` |
| `apps/mobile` | `chess_alokas_mobile` (Flutter) | Participant & Parent mobile app (Auth, GPS Nearby Events, 1-Tap Family Registration, Live Matchday Companion, Certificate Vault) | REST `/api/*` + Supabase Auth/Realtime |
| `supabase/migrations` | SQL migrations | Ordered, idempotent PostgreSQL schema & RLS migrations (`001_*.sql`, `002_*.sql`, …) | PostgreSQL 15+ (`pgcrypto`, `pg_trgm`) |

### Strict Boundary Rules
1. **Shared Contracts First**: Any new entity, API request/response shape, or enum shared between `apps/api` and `apps/web` MUST be defined with Zod in `packages/shared/src/types.ts` and exported from `packages/shared/src/index.ts`.
2. **Dual-Store Parity (`MemoryStore` + `PostgresStore`)**: Every method added to the `Store` interface in `apps/api/src/db.ts` MUST be implemented in **both** `MemoryStore` (used for offline/unit tests) and `PostgresStore` (production Postgres) with identical semantics, filtering, and ownership checks.
3. **Offline-First Web & Desktop**: The Organizer Desk in `apps/web` reads/writes local Dexie (`apps/web/src/db/local.ts`) and syncs via `apps/web/src/sync/sync.ts`. Never break offline pairing or result entry for tournaments already loaded on the device.

---

## 2. Multi-Tenant Organizer vs. Global Participant Security Model

### 2.1 Tenant-Scoped Organizer Resources (B2B)
- Organizers operate through an `Organization` (`organizations` + `organization_members`) or direct `owner_id`.
- **Sandbox Trial vs. Verified Organizers**:
  - New B2B organizations start with `verification_status = 'pending_review'` and `plan_tier = 'trial'` (max 1 active tournament, max 24 players, private only, `can_publish_global = false`, `can_accept_paid_registrations = false`).
  - Only Platform Admins (`profiles.is_platform_admin = true`) can verify an organization (`verification_status = 'verified'`), grant `can_publish_global = true`, or upgrade `plan_tier` (`event_pass`, `pro`, `enterprise`).
- **Cross-Tenant Isolation**:
  - Every mutating API route and `pushSync` operation MUST verify that the authenticated user owns the tournament or is an authorized member (`owner`, `admin`, `director`) of the tournament's `organization_id`.
  - All `ON CONFLICT (id) DO UPDATE` queries on child tables (`categories`, `participants`, `games`, `tournament_registrations`) MUST include `AND <table>.tournament_id = EXCLUDED.tournament_id` so a caller cannot hijack rows across tournaments.

### 2.2 Global Participant Resources (B2C)
- Participant accounts and `player_profiles` are **global across the platform** and free to create without admin approval.
- One account (`account_user_id`) can manage a primary player profile (`is_primary = true`) plus multiple family/student sub-profiles (`relationship IN ('self', 'child', 'student', 'family')`).
- Public endpoints (`/public/live/:token`, `/public/events`, `/public/events/:slug`) MUST sanitize responses and never expose private fields (`recipient_email`, `phone`, `national_id`, `arbiter_pin_hash`, `owner_id`, or payment receipt paths).

---

## 3. Database & Supabase RLS Checklist

Whenever creating a new migration under `supabase/migrations/NNN_<name>.sql`:
1. **Sequential Numbering & Idempotency**: Never edit or re-order an already-shipped migration. Use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS`, and `CREATE OR REPLACE FUNCTION`.
2. **Row-Level Security (RLS)**:
   - Enable RLS (`ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;`) on every table in `public`.
   - Use `TO authenticated` / `TO anon` with `(select auth.uid())` predicates (never use deprecated `auth.role()`).
   - Never allow `authenticated` users to self-update privileged flags (`is_platform_admin`, `verification_status`, `plan_tier`, `can_publish_global`, `event_credits_remaining`). Protect privileged columns with a `BEFORE INSERT OR UPDATE` trigger or separate admin-only table.
3. **Connection Pool Safety**:
   - Supabase transaction pooler requires `prepare: false` on `postgres(...)` clients.
   - Avoid unbounded `Promise.all` query bursts (>5 concurrent queries) on a single request handler to prevent pool exhaustion.

---

## 4. Mandatory Definition of Done (Testing, Docs & Git Commit Gate)

Every feature, bug fix, or roadmap phase **must** complete all three gates before it is considered done:

### Gate 1: Automated Verification
Run all of the following from the repo root and ensure **zero errors**:
```bash
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @chess-alokas/web run build:desktop
pnpm --filter @chess-alokas/api run build:desktop
pnpm --filter @chess-alokas/desktop run build:main
```
When `apps/mobile` (Flutter) is modified, also run:
```bash
flutter analyze
flutter test
```

### Gate 2: Documentation Update
Every feature commit MUST update documentation alongside code:
1. **Feature Documentation (`docs/FEATURES_*.md` or `apps/mobile/README.md`)**: Document new database tables, API endpoints, UI routes, and user flows.
2. **Root `README.md`**: Keep the Features list, Monorepo table, and API overview table accurate.
3. **Agent Working Memory (`docs/AGENT_HANDOFF.md`)**: Update the `Last updated` header, `Status` checklist, `Key paths` table, latest migration number, and `How to resume` notes.

### Gate 3: Clean Atomic Git Commit
1. Check `git status` and `git diff` to ensure no secrets (`.env`, `.cursor/mcp.json`), build artifacts, or temporary files are staged.
2. Stage code, migrations, tests, and documentation together.
3. Commit with a clear, PowerShell-safe commit message (no bash heredocs):
   ```powershell
   git commit -m " Concise summary of feature, migration, tests, and docs"
   ```
