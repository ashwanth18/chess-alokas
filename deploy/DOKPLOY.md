# Deploy Chess Alokas on Dokploy (Hostinger VPS)

Domain: **`chess-manager.alokas.com`**

> **Day-to-day shipping** (web push, desktop tags, migrations): see [`PIPELINE.md`](./PIPELINE.md).
> This file is the **one-time** Dokploy / DNS / Auth setup checklist.

## 1. DNS

Create an **A record** (or CNAME) for `chess-manager.alokas.com` pointing at your VPS IP.

## 2. Dokploy application

1. Create a new **Docker Compose** application from this repo.
2. Set compose path to `deploy/docker-compose.yml` (build context is repo root).
3. Attach domain `chess-manager.alokas.com` with HTTPS (Let’s Encrypt / Dokploy certs) to the **`web`** service, container port **80**.
4. Do **not** publish host ports 80/443 in compose — Dokploy’s proxy already binds them. Compose only `expose`s port 80 on `web`.

## 3. Environment variables (Dokploy UI — never commit)

| Variable | Where | Notes |
|----------|--------|--------|
| `DATABASE_URL` | api | Supabase pooler URI |
| `SUPABASE_URL` | api + web build | `https://….supabase.co` |
| `SUPABASE_SECRET_KEY` | api only | server secret / service_role |
| `SUPABASE_ANON_KEY` | api + web build | publishable/anon for JWT verify + client |
| `RESEND_API_KEY` / `RESEND_FROM` | api | optional certificate email |
| `SENTRY_DSN` | api | Node/Fastify DSN (free plan) |
| `VITE_SENTRY_DSN` | web build | React DSN (same or separate project) |
| `VITE_SENTRY_ORG_URL` | web build | optional Admin link to Issues |
| `SENTRY_AUTH_TOKEN` (+ `SENTRY_ORG` / `SENTRY_PROJECT`) | web build | optional source maps |

Web build args are wired in compose from `SUPABASE_URL` / `SUPABASE_ANON_KEY` / Sentry vars.

## 4. Supabase Auth dashboard

1. **Authentication → URL configuration**
   - Site URL: `https://chess-manager.alokas.com`
   - Redirect URLs:
     - `https://chess-manager.alokas.com/auth/callback`
     - `https://chess-manager.alokas.com/auth/reset`
     - `http://localhost:5173/auth/callback`
     - `http://localhost:5173/auth/reset`
2. **Providers**
   - Email: enable password + OTP / magic link
   - Google OAuth: Client ID/secret from Google Cloud Console
   - GitHub OAuth: Client ID/secret from GitHub Developer Settings
3. Confirm migration `005_auth_owners.sql` is applied (`owner_id`, `profiles`, RLS).

## 4b. Branded auth emails (hide Supabase)

Default Supabase SMTP sends from Supabase and looks generic. For production:

### A. Custom SMTP (From address)

1. In [Resend](https://resend.com) (you may already use it for certificates): verify domain `alokas.com` (or a subdomain like `mail.alokas.com`) and create an API key.
2. Supabase → **Authentication → SMTP Settings** → enable custom SMTP:

| Field | Value |
|-------|--------|
| Sender email | e.g. `Chess Alokas <noreply@alokas.com>` |
| Host | `smtp.resend.com` |
| Port | `465` (or `587`) |
| Username | `resend` |
| Password | your Resend API key |

3. Raise **Auth rate limits** if needed (custom SMTP starts ~30/hour).

### B. Email templates

1. Open **Authentication → Email Templates**.
2. Paste HTML from `deploy/email-templates/`:
   - **Magic Link** → `magic-link.html` — subject: `Sign in to Chess Alokas`
   - **Confirm sign up** → `confirm-signup.html` — subject: `Confirm your Chess Alokas email`
   - **Reset password** → `reset-password.html` — subject: `Reset your Chess Alokas password`
3. In Resend, disable **click tracking** for auth mail so magic-link URLs are not rewritten.

Note: the verify link host may still be `*.supabase.co` until you add a [custom Auth domain](https://supabase.com/docs/guides/auth/auth-smtp#additional-best-practices). The visible From name/address is what most users notice.

## 5. Verify

```bash
curl https://chess-manager.alokas.com/api/health
# expect ok, mode postgres, auth enabled, storage supabase
```

Sign up on the site → create tournament → Sync → Issue digital.

## 6. Desktop

Packaged Electron uses `https://chess-manager.alokas.com/api` by default. Users sign in (password / OTP / OAuth); they never paste secret keys.

Downloads: landing page at `/` links to [GitHub Releases](https://github.com/ashwanth18/chess-alokas/releases/latest) (Windows / Linux / macOS). Publish with `git tag vX.Y.Z && git push origin vX.Y.Z`.

Local API sidecar is only for `pnpm --filter @chess-alokas/desktop dev` (or `DESKTOP_LOCAL_API=1`).

## 7. Claim legacy cloud rows (optional)

If you have old tournaments with `owner_id IS NULL`:

```sql
update tournaments
set owner_id = '<your-auth-user-uuid>'
where owner_id is null;
```
