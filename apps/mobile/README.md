# Chess Alokas Mobile (`apps/mobile`)

A player's home for chess, for players and those who look after young players (Dart package `chess_alokas_mobile`, Android application id `com.alokas.chess`).

**Status: in development, not production-ready.** The app shows only what the API returns. It has no demo data: when something is unknown, missing or failed, it says so. See the tables below for what works and what does not exist yet.

## Configuration

Set with `--dart-define` at build or run time:

| Name | Default | Notes |
|------|---------|-------|
| `API_BASE_URL` | `https://chess-manager.alokas.com/api` | |
| `SUPABASE_URL` | none | Required for sign-in. |
| `SUPABASE_ANON_KEY` | none | Required for sign-in. Do not commit it. |

Without the two Supabase values you can browse events, and the sign-in pages and locked tabs say sign-in isn't available in this version of the app.

```powershell
flutter run --dart-define=SUPABASE_URL=<url> --dart-define=SUPABASE_ANON_KEY=<anon key>
```

## Look

The Alokas brand: forest green surfaces, gold accent, cream text. Green always, whatever the phone's light or dark setting, with Sunlight as an option under Account. Archivo is bundled (`assets/fonts`, SIL OFL) with tabular figures.

- All colours live in `lib/theme/alokas_tokens.dart` and reach screens through `AlokasPalette`. A test fails on a raw colour outside `lib/theme/`, on `TextOverflow.ellipsis` or `fade`, and on emoji or Unicode chess glyphs.
- A test checks WCAG AA for every text colour on every surface, in both themes.
- The crown is the logo. `BrandMark` draws it from the path in `docs/design/logo/crown.svg`; the launcher and adaptive icons are made from `docs/design/logo/crown-1024.png` and `crown-foreground-1024.png` on `#0F3D2E`, with a themed icon on Android 13 and later.
- `PlayerName` is the only way a name is shown. It never truncates: it narrows on the font's width axis, then wraps at the patronym (`bin`, `binti`, `a/l`, `a/p`). It shows `#no · section` when known, otherwise a detail such as `Born 2015 · Child`. A name typed entirely in capitals displays in Title Case; the stored name is not changed.

## Getting in

| Moment | What happens |
|--------|--------------|
| First launch | A full-screen welcome with no tab bar: the crown, `Chess Alokas`, `Your chess life, in one app.`, then `Sign in`, `Create account`, and a small `Browse tournaments without an account`. A brief crown-only launch screen covers the moment it takes to read what the phone remembers, so the welcome never flashes up for someone signed in. |
| Next launches | Signed in: straight into the app. Chose to browse: straight to Discover. The choice is kept in secure storage (`entry_v1`). Signing out or deleting the account forgets it, so the welcome shows again. |
| Sign in, Create account | Full-screen pages (`lib/screens/auth_screens.dart`) with a back arrow and a link to switch between them. Email keyboard, `email`, `password` and `newPassword` autofill hints, show/hide password, Enter moves to the password and then submits. Field problems show on the field; the server's answer shows in a box above the button, with a one-tap fix where there is one: `Resend confirmation email` for an unconfirmed email, `Sign in instead` for an email already in use. The button shows a spinner while working. Sign-up keeps the agreement line with Terms and Privacy links. |
| Check your email | After sign-up with confirmation on: the address, `Open email app` (Android opens the phone's email app at its inbox through a small channel in `MainActivity.kt`; hidden elsewhere), `I've confirmed, sign in` (back to sign-in with the email filled in) and `Resend email`. |
| Forgot password | Asks for the email, sends the reset link, says so in the same words whether or not the account exists, and goes back to sign-in. |
| Guests | Discover and event pages are open. Matchday, Career and Account each show the same locked state: an icon, a title, one line on what the tab holds, `Sign in` and `Create account`. The Account one also offers Display (Sunlight) and the Terms and Privacy links. The app bar has a small `Sign in`. Signing in from anywhere returns to the same tab or page. |
| Registering as a guest | The event page shows `Register a player` with `Sign in or create an account to register.` It opens sign-in; once signed in and the players have loaded, registration opens by itself, with any unfinished registration for that event on this phone. With no players yet, the event page asks to add one. |
| Signed in | Account is the account page: initial, name (the profile marked as the person themselves) and email, registrations, players, Settings (Display), Terms and Privacy, `Sign out`, `Delete my account`. Signing out returns to the welcome screen. |
| Session ends | If the refresh token is refused (expired or revoked), one dialog: `Please sign in again`, with `Not now` and `Sign in` (email filled in). Pages show their locked state instead of errors, and whatever page was open stays underneath, including an unfinished registration. `Not now` keeps browsing as a guest. A sign-out by the person never shows it. |
| Offline at launch | A signed-in person opens into the app with this phone's saved copy and its "as of" notice. The session is read from storage before any network call; a refresh that cannot reach the server keeps the session. |

## What is real

Tested with mocked HTTP and on an Android 16 emulator against a local in-memory API with a stub sign-in service. See Known limits.

| Area | Behaviour | API |
|------|-----------|-----|
| Discover search | One field for tournament, city or venue. A dropdown suggests cities (from the events and a built-in list of Malaysian cities and states) and events, forgiving typos, missing spaces and case, with short names such as KL, PJ and JB, and Penang or Pulau Pinang. Choosing one filters. Matching is in `lib/services/place_search.dart`. | `GET /public/events` |
| Near me | One switch. On a real fix: a green dot and `Near you · Cheltenham` from the phone's own geocoder, or rounded coordinates and accuracy if it has no answer, with how fresh the fix is. Tap to refresh. With no real fix it says `Location off`, says why, offers a way forward, and no distance appears anywhere. Asks for precise location; approximate-only says so and rounds distances. A last known position older than 30 minutes is not used. Only whether it was left on is remembered, never a position. **The position never leaves the phone for the Alokas API**: distances are worked out on the phone. The phone's geocoder (Google's service on most Android phones) is sent coordinates rounded to about 100 m to name the place. | |
| Event cards | `X km away`, only from the real position; nearest first when located, otherwise soonest first. `Entry RM 30` or `Free`. `8 confirmed · 64 places`: `registeredCount` is players the organizer has approved, and is what the server uses to decide full; pending and waitlisted entries are not in it. `maxParticipants` is a limit and is only ever called places. Deadline banner: `Closes 14 Dec · 5 days left`, urgent under 3 days, `Closes today, 6:00 PM`, `Registration closed`; none if there is no deadline. Offline, closed, full and error states as before. | same |
| Map | List or Map switch, list by default. MapLibre with free OpenFreeMap tiles (no key, no card), recoloured to the brand in Alokas green, and OpenFreeMap's Liberty style in Sunlight. Gold pins, clustered when close. A pin opens a short card; a shared venue lists every event there. A blue dot marks the real position. Filters apply. Opens on the user if located, otherwise on all events; from far away a chip gives the distance to the nearest and shows them. Events with no coordinates stay in the list, counted as `2 not on the map`. If the style or tile server can't be reached, or no map data has appeared after 20 seconds, it returns to the list and says `Map not available right now`. OpenStreetMap credit always visible. | `tiles.openfreemap.org` |
| Event page | Facts, payment instructions and QR, only as the organizer published them. If there are none, the app says to contact the organizer. | `GET /public/events/:slugOrId` |
| Venue | Under Where on the event page and in the map pin card: `Directions` and `Copy address` (`Address copied`). Directions opens the phone's maps app with a `geo:` link at the pin, labelled with the venue, or searching the address when there are no coordinates; if no app takes it, Google Maps on the web, which needs no key. The copied address is the street address, with the venue name in front if the address leaves it out, or else the venue, city, state and country that are known. An event with neither shows neither action. `lib/widgets/venue_actions.dart`. | |
| Registration | Steps: who is playing, the organizer's questions (typed or a list, per player, required ones enforced), pay, receipt, send. Only a 201 counts as registered. `waitlisted` is shown as waitlisted. Sends the saved profile and a real category id, plus an optional receipt (PNG, JPEG, WebP or PDF, 5 MB max). | `POST /public/events/:slugOrId/register`, `customAnswers` |
| Registration draft | Saved on the phone at every change, with the receipt file and the event detail. After an app kill, Discover offers Continue registration at the same step, even with no signal. Players the server accepted are never sent twice. Removed on success, on Discard and on sign-out. | |
| Sign-in | Email and password, behind one class (`lib/services/auth_service.dart`). Token refresh; session in secure storage. See Getting in. | Supabase `/auth/v1/token` |
| Sign-up | Email and password. With confirmation on, the Check your email page; it can resend the link. An email already in use is reported (Supabase answers with no identities). Links open in the browser; the app has no deep link. | `/auth/v1/signup`, `/auth/v1/resend` |
| Password reset | Requests the email; the new password is chosen from the link. Worded the same whether or not the account exists. | `/auth/v1/recover` |
| Late receipt | A registration still waiting on a receipt has Add receipt under Account. Shows the server's own message for a bad file, a registration that can't take one now, or too many tries. | `POST /player/registrations/:id/receipt` |
| Consent line | Registration, for a child or anyone under 18 or of unknown age, and child profiles show one line by the submit button with a link to the Privacy Policy, and send `guardianConsent: true` on submit. An adult registering themselves sees no line and sends nothing. | `guardianConsent` |
| Account deletion | Account has Delete my account: explains what stays, links to the retention policy, asks for the email typed out. This phone's copy goes only once the server confirms, then the welcome screen shows. Terms and Privacy are linked from sign-up and Account. | `DELETE /me` |
| Profiles | List, add, edit and delete. Validation errors, including the API's `details`, appear on the field and take focus. Deleting warns about active registrations. Find my past tournaments shows the server's `claimedCount`. | `GET/POST/PATCH/DELETE /player/profiles`, `POST /player/profiles/:id/claim` |
| Matchday | One hero card: round, score, full name with `#no · section`, a true white or black block with the very large board number, then opponent. Separate states for no pairing yet, bye and finished game. Then rank, nearby ladder and earlier rounds. Polls every 30 seconds while open in the foreground, and says when it last updated. | `GET /player/dashboard`, `GET /public/live/:token` |
| Standings and pairings | Full lists by section and round, with an as-of time, polling while open. **Ordered by points only; tied players share a rank (`4=`)**, because tie-breaks are not worked out on the phone. The screen says so. Available only if the organizer turned on the live page; otherwise the app says so. | `GET /public/live/:token` |
| Offline | The last events, profiles, dashboard and standings are kept on the phone and shown on a cold start, always with their "as of" time and a Retry. Refreshing and pull to refresh keep what's on screen if a reload fails. The account's copy is deleted on sign-out. Backups are off (`allowBackup=false`). | |
| Check-in pass | A screen to show at the desk: full name, number, section and a QR of the tournament and entry ids. **It does not check anyone in**, and says so: see below. | |
| Career | FIDE ratings on the profile (the Alokas rating is hidden, since it is 1000 for everyone today), win/draw/loss totals, tournament history, certificates. | `GET /player/dashboard` |
| Certificates | PDF download with a system save dialog. | `GET /certificates/:issueId/download` |

## Install and share

The Android application id is `com.alokas.chess`. It replaced `com.chessalokas.chess_alokas_mobile`, which Android treats as a different app: an old copy stays installed alongside the new one, with its own sign-in and data, until it is uninstalled.

**Production APK**, for sharing:

```powershell
powershell -ExecutionPolicy Bypass -File apps\mobile\scripts\build-production-apk.ps1
powershell -ExecutionPolicy Bypass -File apps\mobile\scripts\build-production-apk.ps1 -CheckOnly   # inputs and signing only, builds nothing
```

It points at `https://chess-manager.alokas.com/api`, and reads the Supabase URL and public anon key from `apps/web/.env.desktop` at build time without copying or printing them. It builds one APK per architecture, which are far smaller than a universal one, into `apps/mobile/build/production-apk/`. Share `chess-alokas-arm64.apk`; `chess-alokas-arm32-older-phones.apk` is for very old phones.

It builds from a temporary copy, because building in the repo fails on Windows without Developer Mode (Flutter's desktop plugin symlinks).

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
- `Open email app` was seen opening Gmail on the emulator; other email apps and iOS (where it is hidden) are untested. Directions was seen opening Google Maps at the pin on the emulator; other maps apps are untested.
- The opponent's `#no · section` comes from the live page, so it is missing when the organizer keeps that page off.
- `GET /player/registrations` holds no event names, so the app looks them up one by one.
- Android caches approximate locations for about 10 minutes, so a big move may take that long to show.
- `MapLibreMap` itself is not in the widget tests, which swap in a stand-in. It was tested on the emulator: use `-gpu host`, because the software renderer draws pins white and drops all map text.
- An organizer who never set a fee shows as `Free`: the API returns 0 for both.
- Category suggestions are read from the category's name and the player's age, so the user should check them.
- Not tested: iOS, a screen reader, and the camera (receipts come from the file picker). Large text is tested at 200% at 360 wide for the welcome, sign-in, sign-up, check-email and locked screens, and was looked at on the emulator at 160% and 360 dp for those and Discover; other screens only at their own tests' sizes.

## Release signing and Play Store

Release builds read `%USERPROFILE%\.chess-alokas\key.properties`, outside the repo:

```properties
storeFile=C:/Users/you/.chess-alokas/upload.jks
storePassword=...
keyAlias=...
keyPassword=...
```

- With that file, release builds use it. A relative `storeFile` is read from that folder. A missing value or keystore stops the build, naming what's wrong, never a value.
- Without it, release builds are signed with the debug key. Gradle warns, and so does the production script: Flutter's own output can hide Gradle's warning. Such a build can't go on Play, and a build signed with the real key won't install over it.
- `*.jks`, `*.keystore` and `key.properties` are git-ignored throughout the repo. Keep the keystore and passwords out of it.

The founder creates the key, with a backup, since losing it blocks updates unless Play's upload-key reset is used:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.chess-alokas"
keytool -genkeypair -v -keystore "$env:USERPROFILE\.chess-alokas\upload.jks" -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

For the Play Store, also:

1. Open a Google Play Console account, and provide a privacy policy URL, the data safety form (children's names, precise location, payment receipts) and a target audience declaration, since the app handles minors' data.
2. Build with `flutter build appbundle --release` and the three `--dart-define`s. The application id cannot change after the first upload.

## Layout

```text
lib/
  config.dart                     --dart-define configuration
  main.dart                       App state, launch, welcome or tabs, sign-in routing, polling
  models/models.dart              API models with nullable fields; receipt validation
  models/live.dart                Public live snapshot, standings by points, results
  models/draft.dart               A registration in progress
  screens/                        Discover, Event, Register, Matchday, Live, Check-in pass, Career, Profiles (the Account tab)
  screens/auth_screens.dart       Launch, welcome, sign-in, create account, check email, reset
  screens/events_map.dart         The map view, and all direct use of MapLibre
  services/alokas_api.dart        HTTP client, results, session
  services/auth_service.dart      Every call to the sign-in provider
  services/local_store.dart       App-private files: offline copy and drafts
  services/device_location.dart   Location permission, position, place name, Near me state
  services/place_search.dart      City and event search, tolerant of typos
  services/map_style.dart         Fetches, checks and recolours the free map style
  services/session_storage.dart   Secure session storage
  services/preferences.dart       Remembers Near me on or off, the display, and guest or signed in
  services/email_app.dart         Opens the phone's email app (Android channel in MainActivity.kt)
  services/file_gateway.dart      Receipt picking and certificate saving
  theme/                          Colour tokens, palette, type, Material theme
  widgets/player_name.dart        Name splitting and fitting
  widgets/event_facts.dart        Icon facts, entry and players, deadline banner
  widgets/message_card.dart       Cards, notices, player picker, the crown, shared pieces
  widgets/account_scope.dart      The account as pushed pages see it, and the one way into sign-in
  widgets/locked_tab.dart         The guest locked state, Display picker, Terms and Privacy links
  widgets/venue_actions.dart      Directions and Copy address
test/
  fixtures/fake_api.dart          Obviously fake test data and a mock backend
  widget_test.dart                Tests that mock HTTP
  regression_test.dart            Tests for bugs found on the emulator
  design_and_flows_test.dart      Names, contrast, drafts, sign-up, offline, standings
  discover_test.dart              Search matching, labels, deadlines, Near me, the map's logic
  auth_flow_test.dart             Welcome, sign-in and sign-up, locked tabs, return after sign-in, sign-out, session ending, venue actions, small phones and large text
```

## Development

```powershell
flutter analyze
flutter test
```
