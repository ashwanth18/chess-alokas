import 'package:flutter/material.dart';

import 'models/models.dart';
import 'screens/career_screen.dart';
import 'screens/discover_screen.dart';
import 'screens/matchday_screen.dart';
import 'screens/profiles_screen.dart';
import 'services/alokas_api.dart';
import 'theme/alokas_theme.dart';

void main() {
  runApp(const ChessAlokasMobileApp());
}

class ChessAlokasMobileApp extends StatefulWidget {
  final AlokasApiClient? apiClient;

  const ChessAlokasMobileApp({super.key, this.apiClient});

  @override
  State<ChessAlokasMobileApp> createState() => _ChessAlokasMobileAppState();
}

class _ChessAlokasMobileAppState extends State<ChessAlokasMobileApp> {
  late final AlokasApiClient _api;
  int _currentTabIndex = 0;

  late GpsLocationPreset _selectedLocation;
  late List<MobileEventItem> _events;
  late List<MobilePlayerProfile> _profiles;
  late String _selectedProfileId;
  late Map<String, LiveTournamentState> _liveStates;
  late List<CertificateVaultItem> _certificates;
  late List<PastTournamentRecord> _pastTournaments;
  late String _signedInEmail;

  @override
  void initState() {
    super.initState();
    _api = widget.apiClient ?? AlokasApiClient();
    _selectedLocation = AlokasApiClient.gpsPresets.first;
    _events = AlokasApiClient.seedEvents();
    _profiles = List<MobilePlayerProfile>.from(
      AlokasApiClient.seedFamilyProfiles(),
    );
    _selectedProfileId = _profiles.first.id;
    _liveStates = Map<String, LiveTournamentState>.from(
      AlokasApiClient.seedLiveStates(),
    );
    _certificates = List<CertificateVaultItem>.from(
      AlokasApiClient.seedCertificates(),
    );
    _pastTournaments = List<PastTournamentRecord>.from(
      AlokasApiClient.seedPastTournaments(),
    );
    _signedInEmail = _api.signedInEmail ?? 'ashwanth@alokas.com';

    if (_api.enableNetwork) {
      _refreshEventsFromCloud();
    }
  }

  Future<void> _refreshEventsFromCloud() async {
    final latest = await _api.fetchEvents(
      lat: _selectedLocation.latitude,
      lng: _selectedLocation.longitude,
    );
    if (!mounted) return;
    setState(() {
      _events = latest;
    });
  }

  Future<void> _handleRegisterProfiles(
    MobileEventItem event,
    List<MobilePlayerProfile> selectedProfiles,
    bool attachReceipt,
  ) async {
    for (final prof in selectedProfiles) {
      final matchedCat = prof.matchCategory(event.categories);
      await _api.submitEventRegistration(
        slugOrId: event.publicSlug,
        profile: prof,
        categoryId: matchedCat.id,
        attachReceipt: attachReceipt,
      );
    }
    if (!mounted) return;
    setState(() {
      _events = _events.map((evt) {
        if (evt.id != event.id) return evt;
        final existingNames = List<String>.from(evt.registeredProfileNames);
        for (final p in selectedProfiles) {
          if (!existingNames.contains(p.fullName)) {
            existingNames.add(p.fullName);
          }
        }
        return evt.copyWith(
          registeredCount: evt.registeredCount + selectedProfiles.length,
          isRegistered: true,
          registeredProfileNames: existingNames,
        );
      }).toList();
    });
  }

  void _handleToggleCheckIn(String profileId) {
    final current = _liveStates[profileId];
    if (current == null) return;
    setState(() {
      _liveStates[profileId] = current.copyWith(checkedIn: !current.checkedIn);
    });
  }

  void _handleFlagDispute(String profileId, String reason) {
    final current = _liveStates[profileId];
    if (current == null) return;
    setState(() {
      _liveStates[profileId] = current.copyWith(
        disputeFlagged: true,
        disputeReason: reason,
      );
    });
  }

  void _handleAddProfile(MobilePlayerProfile newProfile) {
    setState(() {
      _profiles = [newProfile, ..._profiles];
      _selectedProfileId = newProfile.id;
      _liveStates[newProfile.id] = LiveTournamentState(
        tournamentId: 'evt-arcc-kl-2026',
        tournamentName: 'ARCC Kuala Lumpur Junior & Open Rapid Championship 2026',
        venueName: 'KL Gateway Convention Hall • Hall B',
        categoryName: newProfile.age <= 12 ? 'Under 12 (U12)' : 'Open Category',
        currentRound: 3,
        totalRounds: 6,
        profileId: newProfile.id,
        playerName: newProfile.fullName,
        fideId: newProfile.fideId,
        myBoard: 12,
        myColor: 'WHITE',
        opponentName: 'Rayyan Iskandar',
        opponentRating: 1210,
        opponentSchool: 'SK Taman Tun Dr Ismail 1',
        currentScore: 1.5,
        checkInCode:
            'ALOKAS-CHECKIN:ARCC2026:${newProfile.username.toUpperCase()}',
        checkedIn: true,
        roundPairings: [
          LiveRoundPairing(
            round: 3,
            board: 12,
            whiteName: newProfile.fullName,
            whiteRating: newProfile.bestRating,
            blackName: 'Rayyan Iskandar',
            blackRating: 1210,
            result: 'PENDING (LIVE)',
            isMyBoard: true,
          ),
        ],
        standings: [
          LiveStandingEntry(
            rank: 6,
            playerName: newProfile.fullName,
            school: newProfile.school,
            rating: newProfile.bestRating,
            score: 1.5,
            buchholz: 3.0,
            buchholzCut1: 2.0,
            sonnebornBerger: 2.0,
            isMe: true,
          ),
        ],
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final activeProfile = _profiles.firstWhere(
      (p) => p.id == _selectedProfileId,
      orElse: () => _profiles.first,
    );

    final pages = <Widget>[
      DiscoverScreen(
        events: _events,
        profiles: _profiles,
        selectedLocation: _selectedLocation,
        onLocationChanged: (loc) {
          setState(() => _selectedLocation = loc);
          if (_api.enableNetwork) {
            _refreshEventsFromCloud();
          }
        },
        onRegisterProfiles: _handleRegisterProfiles,
        onRefresh: _refreshEventsFromCloud,
      ),
      MatchdayScreen(
        profiles: _profiles,
        selectedProfileId: _selectedProfileId,
        onSelectProfile: (id) => setState(() => _selectedProfileId = id),
        liveStates: _liveStates,
        onToggleCheckIn: _handleToggleCheckIn,
        onFlagDispute: _handleFlagDispute,
      ),
      CareerScreen(
        profiles: _profiles,
        selectedProfileId: _selectedProfileId,
        onSelectProfile: (id) => setState(() => _selectedProfileId = id),
        certificates: _certificates,
        pastTournaments: _pastTournaments,
      ),
      ProfilesScreen(
        signedInEmail: _signedInEmail,
        profiles: _profiles,
        onAddProfile: _handleAddProfile,
        onClaimPastTournaments: _api.claimPastTournaments,
        onSignIn: (email, password) async {
          final updated = await _api.signInWithPassword(
            email: email,
            password: password,
          );
          if (!mounted) return;
          setState(() => _signedInEmail = updated);
        },
      ),
    ];

    return MaterialApp(
      title: 'Chess Alokas',
      debugShowCheckedModeBanner: false,
      theme: AlokasTheme.darkTheme,
      home: Scaffold(
        appBar: AppBar(
          title: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(7),
                decoration: BoxDecoration(
                  color: AlokasColors.warmGold,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(
                  Icons.emoji_events,
                  color: AlokasColors.deepForest,
                  size: 20,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Chess Alokas',
                      style: TextStyle(
                        color: AlokasColors.creamIvory,
                        fontWeight: FontWeight.w900,
                        fontSize: 17,
                      ),
                    ),
                    Text(
                      'Active: ${activeProfile.fullName} (${activeProfile.relationshipLabel})',
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AlokasColors.warmGold,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Center(
                child: AlokasBadge(
                  text: '${_profiles.length} Family',
                  color: AlokasColors.brightGold,
                  icon: Icons.family_restroom,
                ),
              ),
            ),
          ],
        ),
        body: pages[_currentTabIndex],
        bottomNavigationBar: NavigationBar(
          selectedIndex: _currentTabIndex,
          onDestinationSelected: (idx) =>
              setState(() => _currentTabIndex = idx),
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.explore_outlined),
              selectedIcon: Icon(Icons.explore),
              label: 'Discover',
            ),
            NavigationDestination(
              icon: Icon(Icons.sports_esports_outlined),
              selectedIcon: Icon(Icons.sports_esports),
              label: 'Matchday',
            ),
            NavigationDestination(
              icon: Icon(Icons.workspace_premium_outlined),
              selectedIcon: Icon(Icons.workspace_premium),
              label: 'Career & Certs',
            ),
            NavigationDestination(
              icon: Icon(Icons.people_outline),
              selectedIcon: Icon(Icons.people),
              label: 'Family & Auth',
            ),
          ],
        ),
      ),
    );
  }
}
