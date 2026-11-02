# Demo tenant

A fictional academy, **Akademi Catur Demo**, for showing organizers and players how Chess Alokas works. Every event name ends in `(Demo)`. Passwords are never in this repo: ask whoever loaded it.

## Accounts

| Sign in as | For | Where |
|---|---|---|
| `demo-owner@alokas-demo.invalid` | Everything an owner sees | Web, desktop |
| `demo-director@alokas-demo.invalid` | Running an event | Web, desktop |
| `demo-arbiter@alokas-demo.invalid` | The floor only | Web, phone browser |
| `demo-parent@alokas-demo.invalid` | Two children, Aina and Haziq | The app, web |
| `demo-teen@alokas-demo.invalid` | Priya, playing on her own account | The app, web |

**Floor PIN for Round 4:** `246810`. It only opens this fictional event's tables. Choosing "Issue round PIN" or "Get a new scoring PIN" replaces it until the next reset.

## Five minutes for organizers

Sign in as the owner on web or desktop, and **press Sync once**: a browser new to an account shows nothing until it has synced.

1. **Desk.** Open Piala Demo Rapid. Round 4 of 7, two sections, some results in. Standings shows tiebreaks. A chief arbiter call is waiting on one table, and one player withdrew after Round 2.
2. **Floor.** Open a table as the arbiter (Team, then a table number) and enter the PIN. Score a board on a phone, then watch it reach the desk. Until the next deploy, use a private window: see Limits.
3. **TV.** Tournament page, Open TV / Projector Mode, or `/live/alokas-demo-live-rapid/tv`. The public page is `/live/alokas-demo-live-rapid`.
4. **Registration.** Open Terbuka Junior Kuala Lumpur, then Registrations. Pending, waitlisted, approved and rejected entries, sample receipts and the organizer's questions. The public form is `/register/demo-terbuka-kuala-lumpur`.
5. **Certificates.** Open Kejohanan Hujung Tahun, then Certificates. Everyone's certificate is issued. Try emailing them: nothing is sent, and the page says so.

## Five minutes for players

1. **Discover.** In the app, signed in or not, the demo events are listed. Near me finds Cheltenham Rapid Morning from around Cheltenham.
2. **Matchday.** Sign in as the parent. Aina is still playing and Haziq's game has finished. Priya, on her own account, is still playing.
3. **Career.** History from two past events, and certificates to download as PDFs.

## Load, reset, remove

The command reads only the environment, never a `.env` file. Needed: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `DEMO_CONFIRM` set to the hostname of `SUPABASE_URL`. To create accounts or set their passwords, also `DEMO_STAFF_PASSWORD` and `DEMO_PLAYER_PASSWORD`, of 12 characters or more. Optional: `DEMO_FLOOR_PIN`.

Apply the migration first. It is additive, and needs nothing newer than 032:

```
psql "$DATABASE_URL" --single-transaction -f supabase/migrations/036_demo_tenant.sql
```

| Command | What it does |
|---|---|
| `pnpm demo:seed --dry-run` | Runs the real SQL and rolls it back. Creates no accounts and uploads nothing |
| `pnpm demo:seed` | Builds the tenant. If it is already there, changes nothing |
| `pnpm demo:reset` | Rebuilds it with today's dates. Run this before a demo. Also adds fields from newer migrations |
| `pnpm demo:list off` / `on` | **The one switch for public Discover.** No re-seed, and a reset keeps it. Direct links still work when off |
| `pnpm demo:delete` | Removes every demo tournament, the organization, accounts and files |

Every run checks that it can only touch demo data, and undoes itself if a count of real rows changes. A reset takes a few seconds and signs nobody out.

**If Supabase refuses `.invalid`,** the seed stops at the first account and changes nothing else. Set `DEMO_EMAIL_DOMAIN` to a subdomain you own with no MX record, on the API as well, so mail to it is blocked there too.

**On your own computer,** with no cloud at all:

```
pnpm --filter @chess-alokas/api exec tsx src/demo/localServer.ts --serve
```

This runs PGlite, a stand-in for Supabase, and the API on port 3199, seeded. Run the web app with `VITE_API_URL=http://127.0.0.1:3199`, `VITE_SUPABASE_URL=http://127.0.0.1:54331` and any `VITE_SUPABASE_ANON_KEY`. The passwords are `local-staff-password` and `local-player-password`.

**To remove the migration too,** after `demo:delete`:

```sql
drop trigger if exists trg_protect_demo_account_credentials on auth.users;
drop trigger if exists trg_demo_boundaries on public.organizations;
drop trigger if exists trg_demo_boundaries on public.organization_members;
drop trigger if exists trg_demo_boundaries on public.organization_invites;
drop trigger if exists trg_demo_boundaries on public.email_sends;
drop trigger if exists trg_demo_boundaries on public.tournament_registrations;
drop function if exists public.protect_demo_account_credentials();
drop function if exists public.enforce_demo_boundaries();
drop function if exists public.demo_tournament_flag(uuid);
drop view if exists public.demo_tournament_ids;
drop table if exists public.demo_accounts;
alter table public.organizations drop column if exists is_demo;
```

Current code reads these only where it must, but admin metrics need the view and the table, so don't do this while running a build that has them.

## What keeps it apart from real data

- `organizations.is_demo` marks the organization, and `demo_accounts` the accounts. Only the demo command sets them.
- Demo accounts can't enter real events, join or create organizations, or be deleted. Their password and email can't be changed, including by calling Supabase directly.
- Demo events take entries only from demo accounts, so nobody's real details land in a shared tenant.
- The demo organization sends no email and no invites.
- Demo data stays out of admin metrics, the organization list and page-view analytics.
- Any signed-in demo account, or `/discover?demo=1`, sees demo events while they are switched off for everyone else.

## Limits

- **Real Supabase hasn't run this.** Sign-in, the admin API, the trigger on `auth.users` and Storage have met only a local stand-in. The dry run reports whether the lock and the buckets are there.
- **The production API predates some of this.** The database still enforces the boundaries, but with a generic error. Until the next deploy:
  - admin metrics and page views count demo data;
  - a person signed in on the floor page keeps being asked for the PIN, so use a private window;
  - the Account page shows forms that fail, and attempting to delete an account runs its cleanup first, which a reset repairs.
- **Visitors can edit anything else,** and a reset restores it. Two people on one account see each other's changes.
- **A device offline for over 30 days** may keep old demo copies after a reset. Clear site data, or sign out and in again.
- **Sign-in links.** The web app refuses to request one for a demo address. The app, or a direct call, can still make Supabase try to send one to `.invalid`.
- **Not blocked:** adding MFA to a shared account, if MFA is ever turned on in Supabase.
- **The certificate designer** starts empty: issued certificates are there, but no template is saved for the owner to edit.
- **The app** has no Demo badge. The `(Demo)` in the name is what marks them, and the API sends `isDemo` when it is wanted.
