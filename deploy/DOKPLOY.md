# Deploy Chess Alokas on Dokploy (Hostinger VPS)

Domain: **`chess-manager.alokas.com`**

## 1. DNS

Create an **A record** (or CNAME) for `chess-manager.alokas.com` pointing at your VPS IP.

## 2. Dokploy application

1. Create a new **Docker Compose** application from this repo.
2. Set compose path to `deploy/docker-compose.yml` (build context is repo root).
3. Attach domain `chess-manager.alokas.com` with HTTPS (Let’s Encrypt / Dokploy certs) to the `web` service (port 80).

## 3. Environment variables (Dokploy UI — never commit)

| Variable | Where | Notes |
|----------|--------|--------|
| `DATABASE_URL` | api | Supabase pooler URI |
| `SUPABASE_URL` | api + web build | `https://….supabase.co` |
| `SUPABASE_SECRET_KEY` | api only | server secret / service_role |
| `SUPABASE_ANON_KEY` | api + web build | publishable/anon for JWT verify + client |
| `RESEND_API_KEY` / `RESEND_FROM` | api | optional certificate email |

Web build args are wired in compose from `SUPABASE_URL` / `SUPABASE_ANON_KEY`.

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

## 5. Verify

```bash
curl https://chess-manager.alokas.com/api/health
# expect ok, mode postgres, auth enabled, storage supabase
```

Sign up on the site → create tournament → Sync → Issue digital.

## 6. Desktop

Packaged Electron uses `https://chess-manager.alokas.com/api` by default. Users sign in (password / OTP / OAuth); they never paste secret keys.

Local API sidecar is only for `pnpm --filter @chess-alokas/desktop dev` (or `DESKTOP_LOCAL_API=1`).

## 7. Claim legacy cloud rows (optional)

If you have old tournaments with `owner_id IS NULL`:

```sql
update tournaments
set owner_id = '<your-auth-user-uuid>'
where owner_id is null;
```
