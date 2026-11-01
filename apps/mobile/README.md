# Chess Alokas Mobile (`apps/mobile`)

A player's home for chess, for players and those who look after young players (`chess_alokas_mobile`, package `com.chessalokas.chess_alokas_mobile`).

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

## Look

The Alokas brand: forest green surfaces, gold accent, cream text. Green always, whatever the phone's light or dark setting, with Sunlight as an option under Account. Archivo is bundled (`assets/fonts`, SIL OFL) with tabular figures.

- All colours live in `lib/theme/alokas_tokens.dart` and reach screens through `AlokasPalette`. A test fails on a raw colour outside `lib/theme/`, on `TextOverflow.ellipsis` or `fade`, and on emoji or Unicode chess glyphs.
- A test checks WCAG AA for every text colour on every surface, in both themes.
- `PlayerName` is the only way a name is shown. It never truncates: it narrows on the font's width axis, then wraps at the patronym (`bin`, `binti`, `a/l`, `a/p`). It shows `#no · section` when known, otherwise a detail such as `Born 2015 · Child`. A name typed entirely in capitals displays in Title Case; the stored name is not changed.

## What is real

Tested with mocked HTTP and on an Android 16 emulator against a local in-memory API with a stub sign-in service. See Known limits.

| Area | Behaviour | API |
|------|-----------|-----|
| Discover | Event feed with loading, empty and error-with-retry states. Fields the API omits stay unknown. Closed and past-deadline events offer no way to register. A full event warns that new entries are waitlisted. The chosen city is remembered. | `GET /public/events` |
| Nearby | "Use my location" asks for coarse location only when tapped, and uses the last known position if there is no fresh fix. Coordinates are rounded to about 1 km before leaving the phone and are not remembered. With nothing within 150 km it says "No events near you", names the closest, and offers Browse all events or Show true distances. Denied, permanently denied and location off each say what to do. | same |
| Event page | Facts, payment instructions and QR, only as the organizer published them. If there are none, the app says to contact the organizer. | `GET /public/events/:slugOrId` |
| Registration | Steps: who is playing, the organizer's questions (typed or a list, per player, required ones enforced), pay, receipt, send. Only a 201 counts as registered. `waitlisted` is shown as waitlisted. Sends the saved profile and a real category id, plus an optional receipt (PNG, JPEG, WebP or PDF, 5 MB max). | `POST /public/events/:slugOrId/register`, `customAnswers` |
| Registration draft | Saved on the phone at every change, with the receipt file and the event detail. After an app kill, Discover offers Continue registration at the same step, even with no signal. Players the server accepted are never sent twice. Removed on success, on Discard and on sign-out. | |
| Sign-in | Email and password, behind one class (`lib/services/auth_service.dart`). Token refresh; session in secure storage. The app works signed out for browsing. | Supabase `/auth/v1/token` |
| Sign-up | Email and password. With confirmation on, it asks the user to follow the emailed link and can resend it. Worded so it doesn't reveal whether an email already has an account. Links open in the browser; the app has no deep link. | `/auth/v1/signup`, `/auth/v1/resend` |
| Password reset | Requests the email; the new password is chosen from the link. Worded the same whether or not the account exists. | `/auth/v1/recover` |
| Late receipt | A registration still waiting on a receipt has Add receipt under Account. Shows the server's own message for a bad file, a registration that can't take one now, or too many tries. | `POST /player/registrations/:id/receipt` |
| Consent line | Registration, for a child or anyone under 18 or of unknown age, and child profiles show one line by the submit button with a link to the Privacy Policy, and send `guardianConsent: true` on submit. An adult registering themselves sees no line and sends nothing. | `guardianConsent` |
| Account deletion | Account has Delete my account: explains what stays, links to the retention policy, asks for the email typed out. This phone's copy goes only once the server confirms. Terms and Privacy are linked from sign-up and Account. | `DELETE /me` |
| Profiles | List, add, edit and delete. Validation errors, including the API's `details`, appear on the field and take focus. Deleting warns about active registrations. Find my past tournaments shows the server's `claimedCount`. | `GET/POST/PATCH/DELETE /player/profiles`, `POST /player/profiles/:id/claim` |
| Matchday | One hero card: round, score, full name with `#no · section`, a true white or black block with the very large board number, then opponent. Separate states for no pairing yet, bye and finished game. Then rank, nearby ladder and earlier rounds. Polls every 30 seconds while open in the foreground, and says when it last updated. | `GET /player/dashboard`, `GET /public/live/:token` |
| Standings and pairings | Full lists by section and round, with an as-of time, polling while open. **Ordered by points only; tied players share a rank (`4=`)**, because tie-breaks are not worked out on the phone. The screen says so. Available only if the organizer turned on the live page; otherwise the app says so. | `GET /public/live/:token` |
| Offline | The last events, profiles, dashboard and standings are kept on the phone and shown on a cold start, always with their "as of" time and a Retry. Refreshing and pull to refresh keep what's on screen if a reload fails. The account's copy is deleted on sign-out. Backups are off (`allowBackup=false`). | |
| Check-in pass | A screen to show at the desk: full name, number, section and a QR of the tournament and entry ids. **It does not check anyone in**, and says so: see below. | |
| Career | FIDE ratings on the profile (the Alokas rating is hidden, since it is 1000 for everyone today), win/draw/loss totals, tournament history, certificates. | `GET /player/dashboard` |
| Certificates | PDF download with a system save dialog. | `GET /certificates/:issueId/download` |

## Waiting on the API

- **QR check-in.** The desk's Roll Call cannot scan the code, and the dashboard does not say whether a player was marked present. Until both exist, the code does nothing and the pass is only a way to show the name and number.

## What does not exist yet

- **Registering without an account** or typing in a player by hand. Registration needs a signed-in account with a saved profile.
- **Official standings order.** Needs the API to return computed standings with tie-breaks.
- **Choosing a new password or confirming an email inside the app.** Both links open in the browser.
- **Result disputes, rating charts and push notifications.**
- **Languages other than English.** The mockups' translations were for layout only.

## Known limits

- Never run against real Supabase or a deployed API. Sign-up, confirmation, reset and refresh have only met a local stub that mimics Supabase's responses. Account deletion's success path has only met a stub, because the local API has no Supabase admin and answers 503.
- The opponent's `#no · section` comes from the live page, so it is missing when the organizer keeps that page off.
- `GET /player/registrations` holds no event names, so the app looks them up one by one.
- Android caches coarse locations for about 10 minutes, so a big move may take that long to show.
- Category suggestions are read from the category's name and the player's age, so the user should check them.
- Not tested: iOS, a screen reader, large system font sizes beyond the Career test, and the camera (receipts come from the file picker).

## Release signing and Play Store

Builds are signed with the debug key for now. For a release the founder needs to:

1. Create an upload keystore and keep it out of the repo, with a backup. Losing it blocks updates unless Play's upload-key reset is used.
2. Add `android/key.properties` (git-ignored) and a `signingConfigs.release` in `android/app/build.gradle.kts`.
3. Decide the final application id before the first upload; it cannot change afterwards. It is `com.chessalokas.chess_alokas_mobile` today.
4. Open a Google Play Console account, and provide a privacy policy URL, the data safety form (children's names, location, payment receipts) and a target audience declaration, since the app handles minors' data.
5. Build with `flutter build appbundle --release` and the three `--dart-define`s, and replace the default launcher icon.

## Layout

```text
lib/
  config.dart                     --dart-define configuration
  main.dart                       App state, polling, bottom navigation
  models/models.dart              API models with nullable fields; receipt validation
  models/live.dart                Public live snapshot, standings by points, results
  models/draft.dart               A registration in progress
  screens/                        Discover, Event, Register, Matchday, Live, Check-in pass, Career, Profiles
  services/alokas_api.dart        HTTP client, results, session
  services/auth_service.dart      Every call to the sign-in provider
  services/local_store.dart       App-private files: offline copy and drafts
  services/device_location.dart   Location permission and position
  services/session_storage.dart   Secure session storage
  services/preferences.dart       Remembers the chosen city and display
  services/file_gateway.dart      Receipt picking and certificate saving
  theme/                          Colour tokens, palette, type, Material theme
  widgets/player_name.dart        Name splitting and fitting
  widgets/message_card.dart       Cards, notices, player picker, shared pieces
test/
  fixtures/fake_api.dart          Obviously fake test data and a mock backend
  widget_test.dart                Tests that mock HTTP
  regression_test.dart            Tests for bugs found on the emulator
  design_and_flows_test.dart      Names, contrast, drafts, sign-up, offline, nearby, standings
```

## Development

```powershell
flutter analyze
flutter test
```
