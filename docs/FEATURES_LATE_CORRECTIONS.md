# Late result corrections and database access

## Who can read what, directly (`033`)

The API connects as table owner and bypasses row level security, so these rules are the backstop, and what Supabase Realtime applies to a browser's live updates. Client access is select-only. The one write left is a user's own `profiles.display_name`.

| Tables | Who reads a tournament's rows |
|---|---|
| `tournaments`, `tournament_tables`, `floor_alerts` | `owner_id`, organization owner, admin, director, arbiter |
| `categories`, `participants`, `games`, `game_cards`, `game_result_events`, `certificate_issues`, `certificate_templates` | The same, without arbiter |
| `profiles`, `player_profiles` | The person themselves |
| `organizations`, `organization_members` | Members, as before |
| `tournament_registrations` and every other table | Nobody. API only |

- **The helper** is `public.readable_tournament_ids(include_arbiter)`. Policies use `tournament_id in (select public.readable_tournament_ids())`, which runs once per query rather than once per row.
- **Platform admins** read no tournament data directly. None of today's rules gave them any, and their dashboard uses API aggregates.
- **`tournaments`** can't be read with `select *`: `arbiter_pin_hash` and `public_token` aren't granted to clients, and a column added later starts ungranted.
- **Signed-out clients** have no select on any table.
- **Storage:** clients get no policy on `certificates` or `registration-receipts`. The API reads both with the service key, and 033 sets both private.

`apps/api/src/migrations.test.ts` lists every public table in `ACCESS`. A new table fails until someone decides who may read it. `apps/api/src/crossTenant.test.ts` takes its routes from Fastify, so a new route is swept without being added.

## Correcting a result

A director, admin or owner can correct any entered result in a confirmed round or a round before one already paired, including on a completed tournament. A short reason is required. Arbiters and floor sessions can't.

Each correction adds a `game_result_events` row: `actor_user_id`, `actor_name`, `created_at`, `previous_result`, `result`, and the reason in `note`. `GET /games/:id/history` returns a game's rows, newest first, to managers only. A floor-locked result stays locked. A game with cards can't be corrected to an absence.

### How it syncs

There is one path, online or offline. Corrections travel in `POST /sync/push` as `corrections` on the game row, so one set of rules applies (`decideCorrection` in `apps/api/src/lib/syncEngine.ts`).

- **On the device:** `LocalGame.pendingCorrections` queues them in order. It isn't indexed, so the Dexie schema, version and database name don't change. The row shows **Queued** until the server accepts it.
- **The stored result decides, not the clock.** A correction applies only if `previousResult` is what the server holds. Otherwise the code is `correction_conflict`, the server's copy stands, this device takes it from the pull, and a notice stays on the tournament until dismissed.
- **A result the server never saw:** if a director entered a result offline, confirmed, then corrected, and the round isn't frozen on the server, it applies in order, with both changes logged.
- **Retries:** if the first answer was lost, a row already holding the corrected result is a no-op. It isn't logged twice.
- **Time:** the server stamps the row, so a desk clock that is behind can't hide the correction from other devices. Each log row keeps the time the director made the correction, capped at server time.

### Standings

Nothing is stored. Standings, public live and TV pages all compute from games, so they follow the correction. If standings changed and certificates were issued, the director is told, on reconnecting if the correction was made offline. Certificates are not reissued automatically.

## Later rounds

If a later round is paired, the dialog says `Round 4 was paired using the old score.` and offers:

- **Keep Round 4 pairings**, the default. Nothing else changes.
- **Undo Round 4 and re-pair**, shown only for the newest round with no results in it.

`POST /tournaments/:id/rounds/:round/undo` removes that round's games, logs a row per game in `game_result_events` (`Round 4 undone: ...`), sets `current_round` back, and clears `arbiter_pin_hash` and `arbiter_pin_round` in one transaction. The floor PIN and every session from it stop working, and the table links ask for a PIN again. The web app then pairs the round and issues a new PIN.

The server refuses with a 409 if the round isn't the newest, is confirmed, is Round 1, or has a result, a floor lock or a card. A card means the game has started. Games are locked first, so a floor result either lands and refuses the undo, or waits and finds its game gone.

Undo needs a connection, because only the server knows whether the floor has entered a result. A device that was offline can't bring removed games back: its push gets `game_removed`.
