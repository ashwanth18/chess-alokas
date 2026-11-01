# Chess Alokas — Participant & Family Mobile Companion (`apps/mobile`)

Production-ready Flutter mobile app (`chess_alokas_mobile`, package `com.chessalokas.chess_alokas_mobile`) for chess players, parents, and academy students.

---

## Features & 4-Tab Architecture

| Tab | Screen | Key Capabilities |
|-----|--------|------------------|
| **1. Discover** | `lib/screens/discover_screen.dart` | GPS location selector (`Kuala Lumpur`, `Petaling Jaya`, `George Town`, `Johor Bahru`), Haversine distance badges (`X.X km away`), radius filter chips (`10 km`, `25 km`, `50 km`, `All Malaysia`), category filter chips (`U8`, `U12`, `U18`, `Open`), and **1-Tap Family Registration Bottom Sheet** with age-group category auto-matching and DuitNow receipt attachment |
| **2. Matchday** | `lib/screens/matchday_screen.dart` | **Family Live Strip** (switch between active children/self), **Morning Check-In QR Pass Modal** (custom-painted QR matrix + check-in badge), **My Next Match Hero Card** (Round, Table/Board `#`, Piece Color `WHITE`/`BLACK`, Opponent rating & school), Round-by-Round pairings, Live Category Standings (`Pts`, `BH`, `BH-C1`, `SB`), and **Flag Result Dispute for Arbiter** |
| **3. Career & Certs** | `lib/screens/career_screen.dart` | **Alokas Rating** + **FIDE Rapid / Standard / Blitz** cards, Win/Draw/Loss & White/Black color split, custom-painted **Rating Progression Chart (`CustomPainter`)**, **Digital Certificate & Trophy Vault** (`ARCC/001/2026`, SHA-256 verification & full certificate preview modal), and Past Tournaments Attended history |
| **4. Family & Auth** | `lib/screens/profiles_screen.dart` | Supabase Cloud Account sign-in sheet, **Managed Family & Student Sub-Profiles** (`Primary Self`, `Child`, `Academy Student`), **+ Add Profile** dialog, and **Claim Past Tournaments & Certificates** (`POST /player/profiles/:id/claim`) |

---

## Directory Layout

```text
apps/mobile/
├── android/                        # Android Gradle config (com.chessalokas.chess_alokas_mobile)
├── ios/                            # iOS Runner config
├── lib/
│   ├── main.dart                   # Root app state, bottom navigation & cloud/seed sync
│   ├── models/
│   │   └── models.dart             # Domain models, Haversine distance & age-category matcher
│   ├── screens/
│   │   ├── discover_screen.dart    # Nearby GPS events & 1-Tap family registration sheet
│   │   ├── matchday_screen.dart    # Live matchday board hero card, QR pass & standings
│   │   ├── career_screen.dart      # Ratings, CustomPainter chart & Certificate Vault
│   │   └── profiles_screen.dart    # Supabase Auth & family/student sub-profile manager
│   ├── services/
│   │   └── alokas_api.dart         # REST client for chess-manager.alokas.com/api + Malaysia seed data
│   └── theme/
│       └── alokas_theme.dart       # Deep Forest Green (#071F17) & Warm Gold (#D4B98A) theme
└── test/
    └── widget_test.dart            # Unit + widget tests covering all 4 tabs and modals
```

---

## API Endpoints Used

- `GET https://chess-manager.alokas.com/api/public/events?lat=&lng=&radiusKm=&search=` — GPS Haversine tournament discovery feed
- `POST https://chess-manager.alokas.com/api/public/events/:slug/register` — 1-Tap player/family registration with DuitNow receipt upload
- `GET/POST https://chess-manager.alokas.com/api/player/profiles` — Global player & family sub-profiles
- `POST https://chess-manager.alokas.com/api/player/profiles/:id/claim` — Claim past tournament participations & digital certificates
- `GET https://chess-manager.alokas.com/api/player/dashboard` — Player career dashboard, live matchday board, and issued certificates

---

## Development, Testing & Android Phone Deployment

```powershell
cd apps/mobile

# 1. Static analysis (must report 0 issues)
flutter analyze

# 2. Run unit & widget test suite
flutter test

# 3. List connected devices (e.g. SM S918B • R5CW2242D5J)
flutter devices

# 4. Run live on connected Android phone
flutter run -d R5CW2242D5J

# 5. Or build & install APK directly onto the phone
flutter build apk --debug
flutter install --debug -d R5CW2242D5J
```
