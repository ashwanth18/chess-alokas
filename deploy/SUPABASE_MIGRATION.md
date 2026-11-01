# Self-Hosted Supabase Migration Guide (Dokploy VPS)

This guide documents our options and step-by-step runbook for migrating Chess Alokas from **Supabase Cloud** to a **self-hosted stack on our Dokploy VPS** whenever we choose to cut over.

---

## 1. Current Infrastructure & Dokploy Inventory

- **Dokploy Host (Primary VPS)**: `72.61.203.201`
  - **Project**: `alokas` (`0XeT_coG9AWm-R18bqjNJ`)
  - **Environment**: `production` (`0QUFLq8g3x3qeHn4u5D4h`)
  - **Compose Service**: `chessManager` (`DYuVzEIEXL8sb8oLwFGmb`) serving `https://chess-manager.alokas.com`
- **Secondary Remote Server**: `mandwine` (`194.254.245.52`, server ID `t13e8ERvHz5sgOfDvRanX`)
- **Built-in Dokploy Template**: Official `supabase` template (`version: 2026.08.03-3 / dokploy >= 0.22.5`)
- **Current Supabase Cloud Project**: `https://nyhvnuxecmqyjgbwzmvx.supabase.co`
  - **Cloud Free-Tier Pause Note**: If the free-tier project pauses due to inactivity, the API logs `PostgresError: (ENOTFOUND) tenant/user postgres.nyhvnuxecmqyjgbwzmvx not found`. Unpausing the project in the Supabase dashboard restores connectivity immediately without redeploying.

---

## 2. How Chess Alokas Uses Supabase

1. **PostgreSQL (`DATABASE_URL`)**:
   - Used by Fastify (`postgres` client with `prepare: false`) in `apps/api/src/db.ts`, `apps/api/src/certificates/store.ts`, `apps/api/src/routes/admin.ts`, and `apps/api/src/routes/publicAnalytics.ts`.
   - Schema is defined in ordered SQL migrations under `supabase/migrations/` (`001_initial.sql` onward) using extensions `pgcrypto` and `pg_trgm`.
2. **Supabase Auth (`GoTrue` + `auth.users` / `auth.sessions`)**:
   - Web (`apps/web/src/auth/AuthContext.tsx`), Desktop, and Flutter Mobile (`apps/mobile`) use Supabase Auth for email/password and 6-digit OTP.
   - API (`apps/api/src/auth.ts`) verifies Bearer JWTs via `client.auth.getUser(token)` and queries `auth.users` / `auth.sessions` over SQL for session management and `/admin/overview`.
   - Trigger `on_auth_user_created` (`supabase/migrations/005_auth_owners.sql`) auto-creates `public.profiles` rows.
3. **Supabase Realtime (`postgres_changes`)**:
   - Subscribes to live `games` (`apps/web/src/lib/gamesRealtime.ts`) and `game_cards` (`apps/web/src/lib/gameCardsRealtime.ts`) updates via the `supabase_realtime` publication.
4. **Supabase Storage (`certificates` & `registration-receipts` buckets)**:
   - Used in `apps/api/src/certificates/storage.ts` to store/download PDFs, with automatic fallback to local disk (`CERTIFICATES_DIR`).

---

## 3. Self-Hosting Architecture Options

### Option A: Self-Hosted Supabase on Dokploy — "Slim" Profile (Recommended)
Deploy Dokploy's built-in `supabase` compose template inside the `alokas` project at `https://supabase.alokas.com`, disabling heavy observability containers (`analytics`/Logflare, `vector`, `imgproxy`, `edge-functions`).
- **Pros**:
  - **Zero application code rewrite** across Web, API, Electron Desktop, and Flutter Mobile.
  - Never auto-pauses like Supabase Cloud free tier.
  - Keeps Supabase Studio dashboard accessible via Dokploy.
- **Resource Footprint**: ~1.2 GB – 1.8 GB RAM (Postgres, Kong, GoTrue, PostgREST, Realtime, Storage, Meta, Studio).

### Option B: Self-Hosted Supabase on Dokploy — Full Default Template
Deploy the unmodified 12-container Dokploy `supabase` template (including Logflare + Vector).
- **Pros**: 1-click template deploy in Dokploy UI with full Studio log analytics.
- **Resource Footprint**: ~3 GB – 4+ GB RAM. Recommended only if the VPS has >= 8 GB free RAM.

### Option C: Plain PostgreSQL Container on Dokploy + App-Native Auth/SSE
Deploy a single PostgreSQL 16 database in Dokploy (`~150 MB` RAM) + local Docker volume for `CERTIFICATES_DIR`.
- **Pros**: Minimal memory footprint.
- **Cons**: Requires replacing `@supabase/supabase-js` Auth and Realtime in Web, API, and Flutter with custom Fastify JWT/Better-Auth and SSE/WebSockets.

---

## 4. Step-by-Step Cutover Playbook (Option A)

### Phase 1: Provision Self-Hosted Supabase in Dokploy
1. **DNS**: Add an `A` record for `supabase.alokas.com` -> `72.61.203.201`.
2. **Deploy Template**: In Dokploy project `alokas`, create a Compose service from the `supabase` template.
3. **Configure Domain & Auth Env**:
   - Attach `https://supabase.alokas.com` (Let's Encrypt) to `kong` port `8000`.
   - Set `API_EXTERNAL_URL=https://supabase.alokas.com` and `SITE_URL=https://chess-manager.alokas.com`.
   - Set `ADDITIONAL_REDIRECT_URLS=https://chess-manager.alokas.com/auth/callback,https://chess-manager.alokas.com/auth/reset,http://localhost:5173/auth/callback,http://localhost:5173/auth/reset`.
   - Configure Resend SMTP in GoTrue (`GOTRUE_SMTP_HOST=smtp.resend.com`, `GOTRUE_SMTP_PORT=465`, `GOTRUE_SMTP_USER=resend`, `GOTRUE_SMTP_PASS=<RESEND_API_KEY>`, `GOTRUE_SMTP_ADMIN_EMAIL=noreply@alokas.com`).

### Phase 2: Migrate Schema & Data
1. **Clean Bootstrap or Cloud Dump**:
   - **To preserve existing cloud data**: Unpause cloud project `nyhvnuxecmqyjgbwzmvx` and run:
     ```bash
     pg_dump "$CLOUD_DIRECT_URL" \
       --schema=auth --schema=public --schema=storage \
       --no-owner --no-privileges \
       -f supabase_cloud_backup.sql
     ```
     Restore `supabase_cloud_backup.sql` into the self-hosted Postgres container.
   - **For a clean bootstrap**: Apply all files in `supabase/migrations/001_*.sql` through the latest migration in numerical order, and create the `certificates` bucket in `storage.buckets`.
2. **Copy Storage Objects**:
   - Download existing PDFs from the cloud `certificates` bucket and upload them to the self-hosted Storage API (or mount a persistent `CERTIFICATES_DIR` volume on `api`).

### Phase 3: Point Web, API, Desktop & Mobile to `supabase.alokas.com`
1. **Dokploy `chessManager` Env Vars (`deploy/docker-compose.yml`)**:
   - `DATABASE_URL`: `postgresql://postgres:<POSTGRES_PASSWORD>@<supabase-db-host>:5432/postgres`
   - `SUPABASE_URL`: `https://supabase.alokas.com`
   - `SUPABASE_ANON_KEY`: self-hosted `ANON_KEY`
   - `SUPABASE_SECRET_KEY`: self-hosted `SERVICE_ROLE_KEY`
2. **Desktop (`apps/web/.env.desktop`) & Mobile (`apps/mobile`)**:
   - Update `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in `apps/web/.env.desktop`, bump `apps/desktop/package.json`, and push a `vX.Y.Z` tag.
3. **Smoke Test**:
   - Verify `https://chess-manager.alokas.com/api/health` returns `mode: "postgres"`, `auth: "enabled"`, `storage: "supabase"`.
