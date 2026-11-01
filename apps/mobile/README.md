# Chess Alokas Mobile (`apps/mobile`)

Flutter app for players and parents (`chess_alokas_mobile`, package `com.chessalokas.chess_alokas_mobile`).

**Status: in development, not production-ready.** The app shows only what the API returns. It has no demo data: when something is unknown, missing or failed, it says so. See the tables below for what works and what does not exist yet.

## Configuration

Set with `--dart-define` at build or run time:

| Name | Default | Notes |
|------|---------|-------|
| `API_BASE_URL` | `https://chess-manager.alokas.com/api` | |
| `SUPABASE_URL` | none | Required for sign-in. |
| `SUPABASE_ANON_KEY` | none | Required for sign-in. Do not commit it. |

Without the two Supabase values you can browse events, and sign-in says it isn't available in this version of the app.

```powershell
flutter run --dart-define=SUPABASE_URL=<url> --dart-define=SUPABASE_ANON_KEY=<anon key>
```

## What is real

| Area | Behaviour | API |
|------|-----------|-----|
| Discover | Event feed with loading, empty and error-with-retry states. Fields the API omits stay unknown. Closed and past-deadline events offer no way to register. A full event warns that new entries are waitlisted. The chosen city is remembered. | `GET /public/events` |
| Event detail | Payment instructions and QR, only as the organizer published them. If there are none, the app says to contact the organizer. | `GET /public/events/:slugOrId` |
| Refreshing | Each tab reloads when you return to it or the app resumes, and on pull to refresh. If a reload fails, data already on screen stays with an "out of date" notice and Retry. If nothing was loaded yet, the error state shows. Nothing is saved for a cold start offline. | |
| Sign-in | Supabase password sign-in with token refresh. The session is kept in secure storage. The app works signed out for browsing. | Supabase `/auth/v1/token` |
| Registration | Sends the saved profile and a real category id, plus an optional receipt (PNG, JPEG, WebP or PDF, 5 MB max, as a data URL). Only a 201 counts as registered. Server errors are shown as failures. `waitlisted` is shown as waitlisted. | `POST /public/events/:slugOrId/register`, `GET /player/registrations` |
| Profiles | List, add, edit and delete. Validation errors, including the API's `details`, appear on the field and take focus. Deleting warns about active registrations, which stay with the organizers. Claim shows the server's `claimedCount`, and links an entry only if its email is the account's confirmed email and its name is the profile's full name. | `GET/POST/PATCH/DELETE /player/profiles`, `POST /player/profiles/:id/claim` |
| Matchday | The current round's board, colour, opponent, result and score, if the player has one. | `GET /player/dashboard` |
| Career | Ratings on the profile, win/draw/loss totals, tournament history, certificates. | `GET /player/dashboard` |
| Certificates | PDF download with a system save dialog. | `GET /certificates/:issueId/download` |

## What does not exist yet

- **Device location.** "Near: <city>" is a city you choose, and the app has no location permission. Distances are from that city.
- **Registering without an account** or typing in a player by hand. Registration needs a signed-in account with a saved profile.
- **Creating an account or resetting a password** in the app. Use the website.
- **Adding a receipt after registering.** The API has no route for it, so the player must send it to the organizer.
- **The organizer's custom registration questions.** The app shows a warning instead of asking them.
- **Check-in passes, full pairings, standings, result disputes and rating charts.** The API offers the app none of these.

## Known limits

- Production API: on 2026-11-01, `GET /public/events`, `/player/profiles`, `/player/dashboard` and `/player/registrations` all returned 404 on `chess-manager.alokas.com`. Until a build with those routes is deployed there, Discover shows an error and signed-in screens cannot load. Point `API_BASE_URL` at a server that has them.
- Automated tests use a mocked HTTP client. On 2026-11-01 the app was also driven on an Android 16 (API 36) emulator against a local in-memory API, with Supabase sign-in replaced by a local stub. It has not run against real Supabase or a deployed API that has these routes.
- Category suggestions are read from the category's name and the player's age, so the user should check them. The organizer's real eligibility rules are not applied.

## Layout

```text
lib/
  config.dart                  --dart-define configuration
  main.dart                    App state and bottom navigation
  models/models.dart           API models with nullable fields; receipt validation
  screens/                     Discover, Matchday, Career, Profiles
  services/alokas_api.dart     HTTP client, results, session and refresh
  services/session_storage.dart  Secure session storage
  services/preferences.dart    Remembers the chosen city
  services/file_gateway.dart   Receipt picking and certificate saving
  theme/, widgets/             Theme and shared widgets
test/
  fixtures/fake_api.dart       Obviously fake test data and a mock backend
  widget_test.dart             Tests that mock HTTP
  regression_test.dart         Tests for bugs found on the emulator
```

## Development

```powershell
flutter analyze
flutter test
```
