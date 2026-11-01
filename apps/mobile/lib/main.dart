import 'dart:async';

import 'package:flutter/material.dart';

import 'models/draft.dart';
import 'models/live.dart';
import 'models/models.dart';
import 'screens/career_screen.dart';
import 'screens/discover_screen.dart';
import 'screens/matchday_screen.dart';
import 'screens/profiles_screen.dart';
import 'screens/register_screen.dart';
import 'services/alokas_api.dart';
import 'services/device_location.dart' as device;
import 'services/file_gateway.dart';
import 'services/local_store.dart';
import 'services/preferences.dart';
import 'theme/alokas_theme.dart';
import 'widgets/message_card.dart';
import 'widgets/player_name.dart';

void main() {
  runApp(const ChessAlokasMobileApp());
}

class ChessAlokasMobileApp extends StatefulWidget {
  final AlokasApiClient? apiClient;
  final ReceiptPicker receiptPicker;
  final CertificateSaver certificateSaver;
  final AppPreferences preferences;
  final LocalStore localStore;
  final device.DeviceLocator locateDevice;
  final device.SettingsOpener openLocationSettings;

  /// How often an open Matchday or live page checks for news.
  final Duration pollInterval;

  const ChessAlokasMobileApp({
    super.key,
    this.apiClient,
    this.receiptPicker = pickReceiptFile,
    this.certificateSaver = saveCertificateFile,
    this.preferences = const SecureAppPreferences(),
    this.localStore = const FileLocalStore(),
    this.locateDevice = device.locateDevice,
    this.openLocationSettings = device.openLocationSettings,
    this.pollInterval = const Duration(seconds: 30),
  });

  @override
  State<ChessAlokasMobileApp> createState() => _ChessAlokasMobileAppState();
}

class _ChessAlokasMobileAppState extends State<ChessAlokasMobileApp>
    with WidgetsBindingObserver {
  static const int _discoverTab = 0;
  static const int _matchdayTab = 1;
  static const int _careerTab = 2;
  static const int _accountTab = 3;

  late final AlokasApiClient _api;
  late final OfflineCache _cache;
  late final DraftStore _drafts;
  int _currentTabIndex = 0;
  AlokasThemeChoice _theme = AlokasThemeChoice.system;
  bool _inForeground = true;
  Timer? _pollTimer;

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
  List<RegistrationRecord>? _registrations;
  Map<String, List<RegistrationRecord>> _registrationsByEvent = const {};
  bool _registrationsLoaded = false;
  final Map<String, String> _eventNames = {};

  PlayerDashboard? _dashboard;
  bool _dashboardLoading = false;
  String? _dashboardError;
  DateTime? _dashboardUpdatedAt;
  int _dashboardRequestId = 0;

  final Map<String, LiveSnapshot> _live = {};
  final Map<String, DateTime> _liveAt = {};

  List<RegistrationDraft> _draftList = const [];

  @override
  void initState() {
    super.initState();
    _api = widget.apiClient ?? AlokasApiClient();
    _cache = OfflineCache(widget.localStore);
    _drafts = DraftStore(widget.localStore);
    WidgetsBinding.instance.addObserver(this);
    _api.session.addListener(_onSessionChanged);
    _restoreTheme();
    _restoreCityThenFetchEvents();
    _api.restoreSession();
  }

  Future<void> _restoreTheme() async {
    try {
      final name = await widget.preferences.readThemeName().timeout(
        const Duration(seconds: 2),
      );
      if (mounted) setState(() => _theme = AlokasThemeChoice.fromName(name));
    } on Object {
      // Falls back to following the phone's own setting.
    }
  }

  Future<void> _chooseTheme(AlokasThemeChoice choice) async {
    setState(() => _theme = choice);
    try {
      await widget.preferences.writeThemeName(choice.name);
    } on Object {
      // The choice works for this run but will not be remembered.
    }
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
    await _showCachedEvents();
    await _fetchEvents();
  }

  Future<void> _showCachedEvents() async {
    final cached = await _cache.loadEvents();
    final rows = cached?.value;
    if (!mounted || rows is! List || _events.isNotEmpty) return;
    final events = rows
        .whereType<Map<String, dynamic>>()
        .map(MobileEventItem.tryFromJson)
        .whereType<MobileEventItem>()
        .toList();
    setState(() {
      _events = events;
      _eventsUpdatedAt = cached!.savedAt;
    });
  }

  Future<void> _chooseLocation(LocationPreset location) async {
    setState(() => _selectedLocation = location);
    _refreshEvents();
    if (location.id == LocationPreset.deviceId) return;
    try {
      await widget.preferences.writeCityId(location.id);
    } on Object {
      // The choice works for this run but will not be remembered.
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _api.session.removeListener(_onSessionChanged);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final foreground = state == AppLifecycleState.resumed;
    if (foreground == _inForeground) return;
    _inForeground = foreground;
    if (foreground) _refreshTab(_currentTabIndex);
    _syncPolling();
  }

  /// Only an open Matchday in the foreground polls, to spare battery and data.
  void _syncPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
    if (_inForeground && _currentTabIndex == _matchdayTab && _api.isSignedIn) {
      _pollTimer = Timer.periodic(widget.pollInterval, (_) {
        if (!_dashboardLoading) _loadDashboard();
      });
    }
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
      _registrations = null;
      _registrationsByEvent = const {};
      _registrationsLoaded = false;
      _dashboard = null;
      _dashboardError = null;
      _dashboardUpdatedAt = null;
      _dashboardLoading = false;
      _live.clear();
      _liveAt.clear();
      _draftList = const [];
    });
    _syncPolling();
    if (key != null) {
      _startAccount(key);
    }
  }

  /// What this phone last saw appears at once, with its time, and the server is
  /// asked straight after. With no signal the saved copy stays on screen.
  Future<void> _startAccount(String key) async {
    await _reloadDrafts();
    await _showCachedAccount(key);
    if (!mounted || key != _loadedAccountKey) return;
    _loadProfiles();
    _loadRegistrations();
  }

  Future<void> _reloadDrafts() async {
    final key = _loadedAccountKey;
    if (key == null) return;
    final drafts = await _drafts.loadAll(key);
    if (mounted && key == _loadedAccountKey) {
      setState(() => _draftList = drafts);
    }
  }

  Future<void> _showCachedAccount(String key) async {
    final cached = await _cache.loadProfiles(key);
    if (!mounted || key != _loadedAccountKey) return;
    final rows = cached?.value;
    if (rows is List && _profiles.isEmpty) {
      final profiles = MobilePlayerProfile.listFromJson(rows);
      final saved = await _cache.loadSelectedProfile(key);
      if (!mounted || key != _loadedAccountKey) return;
      setState(() {
        _profiles = profiles;
        _profilesUpdatedAt = cached!.savedAt;
        _selectedProfileId = _pickSelected(profiles, saved?.value as String?);
      });
      await _showCachedDashboard(key, _selectedProfileId);
    }
  }

  Future<void> _showCachedDashboard(String key, String? profileId) async {
    if (profileId == null) return;
    final cached = await _cache.loadDashboard(key, profileId);
    final json = cached?.value;
    if (!mounted ||
        key != _loadedAccountKey ||
        profileId != _selectedProfileId ||
        _dashboard != null ||
        json is! Map<String, dynamic>) {
      return;
    }
    final dashboard = PlayerDashboard.fromJson(json);
    final tokens = _tokensIn(dashboard);
    for (final token in tokens) {
      final live = await _cache.loadLive(key, token);
      final value = live?.value;
      if (value is Map<String, dynamic>) {
        final snapshot = LiveSnapshot.tryFromJson(value);
        if (snapshot != null) {
          _live[token] = snapshot;
          _liveAt[token] = live!.savedAt;
        }
      }
    }
    if (!mounted ||
        key != _loadedAccountKey ||
        profileId != _selectedProfileId ||
        _dashboard != null) {
      return;
    }
    setState(() {
      _dashboard = dashboard;
      _dashboardUpdatedAt = cached!.savedAt;
    });
  }

  /// Signing out removes the children's data this phone has kept.
  Future<void> _signOut() async {
    await _cache.clearAccounts();
    await _drafts.clearAll();
    await _api.signOut();
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
          _cache.saveEvents(
            value.map((e) => e.raw).toList(),
            _eventsUpdatedAt!,
          );
          for (final event in value) {
            if (event.name != null) _eventNames[event.id] = event.name!;
          }
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
    var selectionChanged = false;
    setState(() {
      _profilesLoading = false;
      switch (result) {
        case ApiSuccess(:final value):
          _profiles = value;
          final selected = _pickSelected(value, _selectedProfileId);
          if (selected != _selectedProfileId) {
            _dashboard = null;
            selectionChanged = true;
          }
          _selectedProfileId = selected;
          _profilesUpdatedAt = DateTime.now();
          if (key != null) {
            _cache.saveProfiles(
              key,
              value.map((p) => p.raw).toList(),
              _profilesUpdatedAt!,
            );
          }
        case ApiFailure(:final message):
          _profilesError = message;
      }
    });
    if (selectionChanged && key != null) {
      await _showCachedDashboard(key, _selectedProfileId);
    }
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
        _registrations = value;
        _registrationsByEvent = grouped;
        _registrationsLoaded = true;
      });
      _lookUpEventNames(value);
    }
  }

  /// `GET /player/registrations` holds no event names, so a closed event that
  /// is no longer in the feed is looked up by id.
  Future<void> _lookUpEventNames(List<RegistrationRecord> records) async {
    final missing = records
        .map((r) => r.tournamentId)
        .whereType<String>()
        .where((id) => !_eventNames.containsKey(id))
        .toSet();
    for (final id in missing) {
      final result = await _api.fetchEventDetail(id);
      if (!mounted) return;
      if (result case ApiSuccess(:final value)) {
        final name = value.event.name;
        if (name != null) setState(() => _eventNames[id] = name);
      }
    }
  }

  Set<String> _tokensIn(PlayerDashboard dashboard) => dashboard.liveMatches
      .map((m) => m.publicToken)
      .whereType<String>()
      .toSet();

  Future<void> _loadDashboard() async {
    final profileId = _selectedProfileId;
    if (!_api.isSignedIn || profileId == null) return;
    final key = _loadedAccountKey;
    final requestId = ++_dashboardRequestId;
    setState(() {
      _dashboardLoading = true;
      _dashboardError = null;
    });
    final result = await _api.fetchDashboard(profileId);
    if (!mounted || requestId != _dashboardRequestId) return;
    setState(() {
      _dashboardLoading = false;
      switch (result) {
        case ApiSuccess(:final value):
          _dashboard = value;
          _dashboardUpdatedAt = DateTime.now();
          if (key != null) {
            _cache.saveDashboard(
              key,
              profileId,
              value.raw,
              _dashboardUpdatedAt!,
            );
          }
        case ApiFailure(:final message):
          // A matchday board already on screen stays, with a notice.
          _dashboardError = message;
      }
    });
    if (result case ApiSuccess(:final value)) {
      for (final token in _tokensIn(value)) {
        _loadLive(token);
      }
    }
  }

  /// A failed live load changes nothing: standings already known stay, with
  /// the time they were fetched.
  Future<void> _loadLive(String token) async {
    final result = await _api.fetchLive(token);
    if (!mounted) return;
    if (result case ApiSuccess(:final value)) _rememberLive(token, value);
  }

  void _rememberLive(String token, LiveSnapshot snapshot) {
    if (!mounted) return;
    final at = DateTime.now();
    setState(() {
      _live[token] = snapshot;
      _liveAt[token] = at;
    });
    final key = _loadedAccountKey;
    if (key != null) _cache.saveLive(key, token, snapshot.raw, at);
  }

  void _selectProfile(String id) {
    if (id == _selectedProfileId) return;
    setState(() {
      _selectedProfileId = id;
      _dashboard = null;
      _dashboardUpdatedAt = null;
    });
    final key = _loadedAccountKey;
    if (key != null) {
      _cache.saveSelectedProfile(key, id, DateTime.now());
      _showCachedDashboard(key, id);
    }
    _loadDashboard();
  }

  void _selectTab(int index) {
    if (index == _currentTabIndex) return;
    setState(() => _currentTabIndex = index);
    _refreshTab(index);
    _syncPolling();
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
        customAnswers: selection.customAnswers,
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
      final all = [...?_registrations];
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
          all.add(record);
        }
      }
      _registrationsByEvent = updated;
      _registrations = all;
      if (event.name != null) _eventNames[event.id] = event.name!;
    });
    return attempts;
  }

  Future<ApiResult<RegistrationRecord>> _uploadReceipt(
    RegistrationRecord record,
    ReceiptFile receipt,
  ) async {
    final result = await _api.uploadReceipt(
      registrationId: record.id!,
      receipt: receipt,
    );
    if (result is ApiSuccess<RegistrationRecord>) await _loadRegistrations();
    return result;
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
            ? 'Still loading. Please go back and try again in a moment.'
            : _profilesError,
        registrationsByEvent: _registrationsByEvent,
        selectedLocation: _selectedLocation,
        onLocationChanged: _chooseLocation,
        locateDevice: widget.locateDevice,
        openSettings: widget.openLocationSettings,
        loadEventDetail: _api.fetchEventDetail,
        onRegister: _handleRegister,
        onRefresh: _refreshEvents,
        onGoToAccount: () => _selectTab(_accountTab),
        receiptPicker: widget.receiptPicker,
        drafts: _draftList,
        draftStore: _drafts,
        accountKey: _loadedAccountKey,
        onDraftsChanged: _reloadDrafts,
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
        liveByToken: _live,
        liveUpdatedAt: _liveAt,
        loadLive: _api.fetchLive,
        onLiveLoaded: _rememberLive,
        pollInterval: widget.pollInterval,
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
        isAuthConfigured: _api.auth.isConfigured,
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
        onSignUp: (email, password) =>
            _api.signUp(email: email, password: password),
        onResendConfirmation: _api.auth.resendConfirmation,
        onRequestPasswordReset: _api.auth.requestPasswordReset,
        onSignOut: _signOut,
        themeChoice: _theme,
        onThemeChanged: _chooseTheme,
        registrations: _registrations,
        eventNameFor: (id) => id == null ? null : _eventNames[id],
        receiptPicker: widget.receiptPicker,
        onUploadReceipt: _uploadReceipt,
      ),
    ];

    return MaterialApp(
      title: 'Chess Alokas',
      debugShowCheckedModeBanner: false,
      theme: AlokasTheme.of(_theme, Brightness.light),
      darkTheme: AlokasTheme.of(_theme, Brightness.dark),
      themeMode: _theme == AlokasThemeChoice.system
          ? ThemeMode.system
          : ThemeMode.light,
      themeAnimationDuration: Duration.zero,
      home: Builder(
        builder: (context) {
          final p = context.pal;
          return Scaffold(
            appBar: AppBar(
              titleSpacing: 16,
              title: Row(
                children: [
                  const BrandMark(),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Chess Alokas',
                          style: atype(18, weight: 800, color: p.ink),
                        ),
                        Text(
                          !signedIn
                              ? 'Not signed in'
                              : activeProfile == null
                              ? 'Signed in'
                              : splitPlayerName(activeProfile.fullName).given,
                          style: atype(13, weight: 600, color: p.ink2),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            body: pages[_currentTabIndex],
            bottomNavigationBar: DecoratedBox(
              decoration: BoxDecoration(
                border: Border(top: BorderSide(color: p.rule)),
              ),
              child: NavigationBar(
                selectedIndex: _currentTabIndex,
                onDestinationSelected: _selectTab,
                destinations: const [
                  NavigationDestination(
                    icon: Icon(Icons.search),
                    label: 'Discover',
                  ),
                  NavigationDestination(
                    icon: Icon(Icons.grid_view),
                    label: 'Matchday',
                  ),
                  NavigationDestination(
                    icon: Icon(Icons.history),
                    label: 'Career',
                  ),
                  NavigationDestination(
                    icon: Icon(Icons.person_outline),
                    label: 'Account',
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
