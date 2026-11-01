import 'package:flutter/material.dart';

import 'models/models.dart';
import 'screens/career_screen.dart';
import 'screens/discover_screen.dart';
import 'screens/matchday_screen.dart';
import 'screens/profiles_screen.dart';
import 'services/alokas_api.dart';
import 'services/file_gateway.dart';
import 'services/preferences.dart';
import 'theme/alokas_theme.dart';

void main() {
  runApp(const ChessAlokasMobileApp());
}

class ChessAlokasMobileApp extends StatefulWidget {
  final AlokasApiClient? apiClient;
  final ReceiptPicker receiptPicker;
  final CertificateSaver certificateSaver;
  final AppPreferences preferences;

  const ChessAlokasMobileApp({
    super.key,
    this.apiClient,
    this.receiptPicker = pickReceiptFile,
    this.certificateSaver = saveCertificateFile,
    this.preferences = const SecureAppPreferences(),
  });

  @override
  State<ChessAlokasMobileApp> createState() => _ChessAlokasMobileAppState();
}

class _ChessAlokasMobileAppState extends State<ChessAlokasMobileApp>
    with WidgetsBindingObserver {
  static const int _matchdayTab = 1;
  static const int _careerTab = 2;
  static const int _accountTab = 3;
  static const int _discoverTab = 0;

  late final AlokasApiClient _api;
  int _currentTabIndex = 0;

  LocationPreset _selectedLocation = locationPresets.first;
  List<MobileEventItem> _events = const [];
  bool _eventsLoading = true;
  String? _eventsError;
  DateTime? _eventsUpdatedAt;
  int _eventsRequestId = 0;

  /// The account whose data is on screen; compared so that a token refresh
  /// does not reload everything.
  String? _loadedAccountKey;

  List<MobilePlayerProfile> _profiles = const [];
  bool _profilesLoading = false;
  String? _profilesError;
  DateTime? _profilesUpdatedAt;
  String? _selectedProfileId;
  Map<String, List<RegistrationRecord>> _registrationsByEvent = const {};
  bool _registrationsLoaded = false;

  PlayerDashboard? _dashboard;
  bool _dashboardLoading = false;
  String? _dashboardError;
  DateTime? _dashboardUpdatedAt;
  int _dashboardRequestId = 0;

  @override
  void initState() {
    super.initState();
    _api = widget.apiClient ?? AlokasApiClient();
    WidgetsBinding.instance.addObserver(this);
    _api.session.addListener(_onSessionChanged);
    _restoreCityThenFetchEvents();
    _api.restoreSession();
  }

  /// A storage problem only means the first city is used; events still load.
  Future<void> _restoreCityThenFetchEvents() async {
    String? savedId;
    try {
      savedId = await widget.preferences.readCityId().timeout(
        const Duration(seconds: 2),
      );
    } on Object {
      savedId = null;
    }
    if (!mounted) return;
    for (final preset in locationPresets) {
      if (preset.id == savedId) _selectedLocation = preset;
    }
    await _fetchEvents();
  }

  Future<void> _chooseLocation(LocationPreset location) async {
    setState(() => _selectedLocation = location);
    _refreshEvents();
    try {
      await widget.preferences.writeCityId(location.id);
    } on Object {
      // The choice works for this run but will not be remembered.
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _api.session.removeListener(_onSessionChanged);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refreshTab(_currentTabIndex);
  }

  /// After a failed start there is no profile to ask about, so the profiles
  /// have to load first; that also loads the dashboard.
  void _reloadProfilesIfMissing() {
    if (_api.isSignedIn && !_profilesLoading && _profilesError != null) {
      _loadProfiles();
    }
  }

  Future<void> _refreshDashboard() async {
    if (_api.isSignedIn && _profilesError != null) {
      await _loadProfiles();
    } else {
      await _loadDashboard();
    }
  }

  /// Reloads what the tab shows. Data on screen stays there until new data
  /// arrives, and stays with a notice if the reload fails.
  void _refreshTab(int index) {
    switch (index) {
      case _discoverTab:
        _fetchEvents();
        if (_api.isSignedIn) {
          _loadRegistrations();
          _reloadProfilesIfMissing();
        }
      case _matchdayTab || _careerTab:
        if (!_dashboardLoading) _refreshDashboard();
      case _accountTab:
        if (_api.isSignedIn && !_profilesLoading) {
          _loadProfiles();
          _loadRegistrations();
        }
    }
  }

  String? _accountKey(AuthSession? session) =>
      session == null ? null : (session.userId ?? session.email ?? 'account');

  void _onSessionChanged() {
    final key = _accountKey(_api.session.value);
    if (!mounted) return;
    if (key == _loadedAccountKey) {
      setState(() {});
      return;
    }
    _dashboardRequestId++;
    setState(() {
      _loadedAccountKey = key;
      _profiles = const [];
      _selectedProfileId = null;
      _profilesError = null;
      _profilesUpdatedAt = null;
      _registrationsByEvent = const {};
      _registrationsLoaded = false;
      _dashboard = null;
      _dashboardError = null;
      _dashboardUpdatedAt = null;
      _dashboardLoading = false;
    });
    if (key != null) {
      _loadProfiles();
      _loadRegistrations();
    }
  }

  Future<void> _refreshEvents() {
    setState(() {
      _eventsLoading = true;
      _eventsError = null;
    });
    if (_api.isSignedIn) {
      _loadRegistrations();
      _reloadProfilesIfMissing();
    }
    return _fetchEvents();
  }

  Future<void> _fetchEvents() async {
    final requestId = ++_eventsRequestId;
    final result = await _api.fetchEvents(
      lat: _selectedLocation.latitude,
      lng: _selectedLocation.longitude,
    );
    if (!mounted || requestId != _eventsRequestId) return;
    setState(() {
      _eventsLoading = false;
      switch (result) {
        case ApiSuccess(:final value):
          _events = value;
          _eventsError = null;
          _eventsUpdatedAt = DateTime.now();
        case ApiFailure(:final message):
          // Events already on screen stay; a failed refresh says nothing
          // about whether they still exist.
          _eventsError = message;
      }
    });
  }

  Future<void> _loadProfiles() async {
    setState(() {
      _profilesLoading = true;
      _profilesError = null;
    });
    final key = _loadedAccountKey;
    final result = await _api.fetchProfiles();
    if (!mounted || key != _loadedAccountKey) return;
    setState(() {
      _profilesLoading = false;
      switch (result) {
        case ApiSuccess(:final value):
          _profiles = value;
          final selected = _pickSelected(value, _selectedProfileId);
          if (selected != _selectedProfileId) _dashboard = null;
          _selectedProfileId = selected;
          _profilesUpdatedAt = DateTime.now();
        case ApiFailure(:final message):
          _profilesError = message;
      }
    });
    _loadDashboard();
  }

  String? _pickSelected(List<MobilePlayerProfile> profiles, String? current) {
    if (profiles.isEmpty) return null;
    if (profiles.any((p) => p.id == current)) return current;
    return profiles
        .firstWhere((p) => p.isPrimary, orElse: () => profiles.first)
        .id;
  }

  /// Used to mark events the account already registered for. If this fails the
  /// markers are simply absent, and nothing claims the player is unregistered.
  Future<void> _loadRegistrations() async {
    final key = _loadedAccountKey;
    final result = await _api.fetchMyRegistrations();
    if (!mounted || key != _loadedAccountKey) return;
    if (result case ApiSuccess(:final value)) {
      setState(() {
        final grouped = <String, List<RegistrationRecord>>{};
        for (final record in value) {
          final eventId = record.tournamentId;
          if (eventId != null) (grouped[eventId] ??= []).add(record);
        }
        _registrationsByEvent = grouped;
        _registrationsLoaded = true;
      });
    }
  }

  Future<void> _loadDashboard() async {
    if (!_api.isSignedIn || _selectedProfileId == null) return;
    final requestId = ++_dashboardRequestId;
    setState(() {
      _dashboardLoading = true;
      _dashboardError = null;
    });
    final result = await _api.fetchDashboard(_selectedProfileId);
    if (!mounted || requestId != _dashboardRequestId) return;
    setState(() {
      _dashboardLoading = false;
      switch (result) {
        case ApiSuccess(:final value):
          _dashboard = value;
          _dashboardUpdatedAt = DateTime.now();
        case ApiFailure(:final message):
          // A matchday board already on screen stays, with a notice.
          _dashboardError = message;
      }
    });
  }

  void _selectProfile(String id) {
    if (id == _selectedProfileId) return;
    setState(() {
      _selectedProfileId = id;
      _dashboard = null;
      _dashboardUpdatedAt = null;
    });
    _loadDashboard();
  }

  void _selectTab(int index) {
    if (index == _currentTabIndex) return;
    setState(() => _currentTabIndex = index);
    _refreshTab(index);
  }

  /// Registrations still active for a player; null when they are not known.
  int? _activeRegistrationsFor(String profileId) {
    if (!_registrationsLoaded) return null;
    var count = 0;
    for (final records in _registrationsByEvent.values) {
      for (final record in records) {
        if (record.playerProfileId == profileId && record.isActive) count++;
      }
    }
    return count;
  }

  Future<void> _refreshProfiles() async {
    _loadRegistrations();
    await _loadProfiles();
  }

  /// Submits one registration per player. Each entry reports its own outcome,
  /// and only a 201 from the server marks a player as registered.
  Future<List<RegistrationAttempt>> _handleRegister(
    MobileEventItem event,
    List<RegistrationSelection> selections,
    ReceiptFile? receipt,
  ) async {
    final attempts = <RegistrationAttempt>[];
    for (final selection in selections) {
      final result = await _api.submitEventRegistration(
        slugOrId: event.slugOrId,
        profile: selection.profile,
        categoryId: selection.categoryId,
        receipt: receipt,
      );
      attempts.add(
        RegistrationAttempt(profile: selection.profile, result: result),
      );
    }
    if (!mounted) return attempts;
    setState(() {
      final updated = Map<String, List<RegistrationRecord>>.of(
        _registrationsByEvent,
      );
      for (final attempt in attempts) {
        if (attempt.result case ApiSuccess(:final value)) {
          final record = RegistrationRecord(
            id: value.id,
            tournamentId: event.id,
            playerProfileId: attempt.profile.id,
            playerName: value.playerName ?? attempt.profile.fullName,
            status: value.status,
            paymentStatus: value.paymentStatus,
            hasReceipt: value.hasReceipt,
          );
          updated[event.id] = [...?updated[event.id], record];
        }
      }
      _registrationsByEvent = updated;
    });
    return attempts;
  }

  Future<ApiResult<void>> _createProfile(Map<String, dynamic> fields) async {
    final result = await _api.createProfile(fields);
    switch (result) {
      case ApiFailure(:final message, :final statusCode, :final fieldErrors):
        return ApiFailure(
          message,
          statusCode: statusCode,
          fieldErrors: fieldErrors,
        );
      case ApiSuccess(:final value):
        await _loadProfiles();
        if (mounted) _selectProfile(value.id);
        return const ApiSuccess(null);
    }
  }

  Future<ApiResult<void>> _updateProfile(
    String id,
    Map<String, dynamic> fields,
  ) async {
    final result = await _api.updateProfile(id, fields);
    switch (result) {
      case ApiFailure(:final message, :final statusCode, :final fieldErrors):
        return ApiFailure(
          message,
          statusCode: statusCode,
          fieldErrors: fieldErrors,
        );
      case ApiSuccess():
        await _loadProfiles();
        return const ApiSuccess(null);
    }
  }

  Future<ApiResult<void>> _deleteProfile(String id) async {
    final result = await _api.deleteProfile(id);
    if (result is ApiSuccess<void>) await _loadProfiles();
    return result;
  }

  Future<ApiResult<int>> _claimPastTournaments(
    MobilePlayerProfile profile,
  ) async {
    final result = await _api.claimPastTournaments(profile);
    if (result is ApiSuccess<int>) _loadDashboard();
    return result;
  }

  @override
  Widget build(BuildContext context) {
    final session = _api.session.value;
    final signedIn = session != null;
    final selected = _profiles.where((p) => p.id == _selectedProfileId);
    final activeProfile = selected.isEmpty ? null : selected.first;

    final pages = <Widget>[
      DiscoverScreen(
        eventsLoading: _eventsLoading,
        eventsError: _eventsError,
        eventsUpdatedAt: _eventsUpdatedAt,
        events: _events,
        isSignedIn: signedIn,
        profiles: _profiles,
        profilesUnavailable: _profiles.isNotEmpty
            ? null
            : _profilesLoading
            ? 'Still loading. Please close this and try again in a moment.'
            : _profilesError,
        registrationsByEvent: _registrationsByEvent,
        selectedLocation: _selectedLocation,
        onLocationChanged: _chooseLocation,
        loadEventDetail: _api.fetchEventDetail,
        onRegister: _handleRegister,
        onRefresh: _refreshEvents,
        onGoToAccount: () => _selectTab(_accountTab),
        receiptPicker: widget.receiptPicker,
      ),
      MatchdayScreen(
        isSignedIn: signedIn,
        profiles: _profiles,
        selectedProfileId: _selectedProfileId,
        onSelectProfile: _selectProfile,
        loading: _dashboardLoading || _profilesLoading,
        error: _dashboardError ?? _profilesError,
        dashboardUpdatedAt: _dashboardUpdatedAt,
        dashboard: _dashboard,
        onRefresh: _refreshDashboard,
        onGoToAccount: () => _selectTab(_accountTab),
      ),
      CareerScreen(
        isSignedIn: signedIn,
        profiles: _profiles,
        selectedProfileId: _selectedProfileId,
        onSelectProfile: _selectProfile,
        loading: _dashboardLoading || _profilesLoading,
        error: _dashboardError ?? _profilesError,
        dashboardUpdatedAt: _dashboardUpdatedAt,
        dashboard: _dashboard,
        onRefresh: _refreshDashboard,
        onGoToAccount: () => _selectTab(_accountTab),
        onDownloadCertificate: _api.downloadCertificate,
        certificateSaver: widget.certificateSaver,
      ),
      ProfilesScreen(
        isAuthConfigured: _api.config.isAuthConfigured,
        signedInEmail: signedIn ? (session.email ?? 'Signed in') : null,
        profiles: _profiles,
        profilesLoading: _profilesLoading,
        profilesError: _profilesError,
        profilesUpdatedAt: _profilesUpdatedAt,
        activeRegistrationsFor: _activeRegistrationsFor,
        onRetryProfiles: _refreshProfiles,
        onCreateProfile: _createProfile,
        onUpdateProfile: _updateProfile,
        onDeleteProfile: _deleteProfile,
        onClaimPastTournaments: _claimPastTournaments,
        onSignIn: (email, password) =>
            _api.signInWithPassword(email: email, password: password),
        onSignOut: _api.signOut,
      ),
    ];

    final String subtitle;
    if (!signedIn) {
      subtitle = 'Not signed in';
    } else if (activeProfile != null) {
      subtitle =
          'Active: ${activeProfile.fullName} (${activeProfile.relationshipLabel})';
    } else {
      subtitle = 'Signed in';
    }

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
                      subtitle,
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
            if (signedIn && _profiles.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(right: 12),
                child: Center(
                  child: AlokasBadge(
                    text: _profiles.length == 1
                        ? '1 Profile'
                        : '${_profiles.length} Profiles',
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
          onDestinationSelected: _selectTab,
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
              label: 'Career',
            ),
            NavigationDestination(
              icon: Icon(Icons.people_outline),
              selectedIcon: Icon(Icons.people),
              label: 'Account',
            ),
          ],
        ),
      ),
    );
  }
}
