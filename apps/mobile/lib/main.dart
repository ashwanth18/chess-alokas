import 'dart:async';

import 'package:flutter/material.dart';

import 'models/draft.dart';
import 'models/live.dart';
import 'models/models.dart';
import 'screens/auth_screens.dart';
import 'screens/career_screen.dart';
import 'screens/discover_screen.dart';
import 'screens/events_map.dart';
import 'screens/matchday_screen.dart';
import 'screens/profiles_screen.dart';
import 'screens/register_screen.dart';
import 'services/alokas_api.dart';
import 'services/device_location.dart' as device;
import 'services/email_app.dart' as email;
import 'services/file_gateway.dart';
import 'services/local_store.dart';
import 'services/map_style.dart';
import 'services/preferences.dart';
import 'theme/alokas_theme.dart';
import 'widgets/account_scope.dart';
import 'widgets/locked_tab.dart';
import 'widgets/message_card.dart';

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
  final device.SettingsOpener openDeviceLocationSettings;
  final device.SettingsOpener requestPreciseLocation;
  final device.PlaceNamer namePlace;
  final MapStyleLoader loadMapStyle;
  final MapSurfaceBuilder mapSurfaceBuilder;

  /// Opens the email app after sign-up; null where there is no way to.
  final email.EmailAppOpener? openEmailApp;

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
    this.openDeviceLocationSettings = device.openDeviceLocationSettings,
    this.requestPreciseLocation = device.requestPreciseLocation,
    this.namePlace = device.nameDevicePlace,
    this.loadMapStyle = loadOpenFreeMapStyle,
    this.mapSurfaceBuilder = buildMapLibreSurface,
    this.openEmailApp = email.openEmailApp,
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
  final GlobalKey<NavigatorState> _navigatorKey = GlobalKey<NavigatorState>();

  /// False for the moment it takes to read what this phone remembers.
  bool _launchReady = false;

  /// How this person last came in; null shows the welcome screen.
  EntryChoice? _entry;

  /// Set while signing out or deleting the account, so that losing the
  /// session is not mistaken for it running out.
  bool _endingSession = false;
  bool _sessionEndedPending = false;
  bool _sessionPromptOpen = false;

  /// The email of the session that ended, to fill in on sign-in.
  String? _endedEmail;
  int _currentTabIndex = 0;
  AlokasThemeChoice _theme = AlokasThemeChoice.forest;
  bool _inForeground = true;
  Timer? _pollTimer;

  late final device.NearMeController _nearMe;
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
    _nearMe = device.NearMeController(
      locate: widget.locateDevice,
      namePlace: widget.namePlace,
      remember: widget.preferences.writeNearMe,
    );
    _restoreNearMe();
    _showCachedEvents().then((_) => _fetchEvents());
    _startUp();
  }

  /// Opens on the welcome screen, the app, or Discover for a guest, as soon as
  /// the saved choice and session are read. A refresh of the session carries
  /// on behind, so a signed-in person opens the app with no signal.
  Future<void> _startUp() async {
    final sessionRead = Completer<void>();
    _api.restoreSession(
      onRead: () {
        if (!sessionRead.isCompleted) sessionRead.complete();
      },
    );
    EntryChoice? entry;
    try {
      entry = await widget.preferences.readEntry().timeout(
        const Duration(seconds: 2),
      );
    } on Object {
      entry = null;
    }
    await sessionRead.future.timeout(
      const Duration(seconds: 3),
      onTimeout: () {},
    );
    if (!mounted) return;
    final signedIn = _api.isSignedIn;
    setState(() {
      _entry = signedIn ? EntryChoice.member : entry;
      _launchReady = true;
    });
    if (signedIn && entry != EntryChoice.member) {
      _rememberEntry(EntryChoice.member);
    }
    if (!signedIn && entry == EntryChoice.member) _sessionEnded(null);
    _maybePromptSessionEnded();
  }

  Future<void> _rememberEntry(EntryChoice? choice) async {
    if (mounted) setState(() => _entry = choice);
    try {
      await widget.preferences.writeEntry(choice);
    } on Object {
      // Works for this run; the welcome screen may show again next launch.
    }
  }

  void _browseAsGuest() {
    setState(() => _currentTabIndex = _discoverTab);
    _rememberEntry(EntryChoice.guest);
  }

  AuthActions get _authActions => AuthActions(
    isConfigured: _api.auth.isConfigured,
    signIn: (email, password) =>
        _api.signInWithPassword(email: email, password: password),
    signUp: (email, password) => _api.signUp(email: email, password: password),
    resendConfirmation: _api.auth.resendConfirmation,
    requestPasswordReset: _api.auth.requestPasswordReset,
    openEmailApp: widget.openEmailApp,
  );

  /// The one way into sign-in, from anywhere. Completes with true when
  /// someone is signed in; the page underneath is still there to return to.
  Future<bool> _openAuth({
    AuthStart start = AuthStart.signIn,
    String? email,
  }) async {
    final navigator = _navigatorKey.currentState;
    if (navigator == null) return false;
    final result = await navigator.push<bool>(
      MaterialPageRoute<bool>(
        builder: (_) =>
            AuthPage(actions: _authActions, start: start, initialEmail: email),
      ),
    );
    return result == true && _api.isSignedIn;
  }

  /// The session ran out or was refused: not a sign-out by the person.
  void _sessionEnded(String? email) {
    _endedEmail = email ?? _endedEmail;
    _sessionEndedPending = true;
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => _maybePromptSessionEnded(),
    );
  }

  /// One calm prompt, over whatever is open. What was on screen stays.
  Future<void> _maybePromptSessionEnded() async {
    if (!_sessionEndedPending || _sessionPromptOpen || !_launchReady) return;
    final navigatorContext = _navigatorKey.currentContext;
    if (navigatorContext == null || _api.isSignedIn) {
      _sessionEndedPending = false;
      return;
    }
    _sessionEndedPending = false;
    _sessionPromptOpen = true;
    final signIn = await showDialog<bool>(
      context: navigatorContext,
      builder: (context) => AlertDialog(
        key: const Key('session-ended'),
        title: const Text('Please sign in again'),
        content: const Text(
          'Your sign-in on this phone has ended. Sign in to see your players '
          'and matches.',
        ),
        actions: [
          TextButton(
            key: const Key('session-not-now'),
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Not now'),
          ),
          ElevatedButton(
            key: const Key('session-sign-in'),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Sign in'),
          ),
        ],
      ),
    );
    _sessionPromptOpen = false;
    if (!mounted || _api.isSignedIn) return;
    if (signIn == true) {
      await _openAuth(email: _endedEmail);
    } else {
      _rememberEntry(EntryChoice.guest);
    }
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

  /// A storage problem only means Near me starts off.
  Future<void> _restoreNearMe() async {
    bool wasOn;
    try {
      wasOn = await widget.preferences.readNearMe().timeout(
        const Duration(seconds: 2),
      );
    } on Object {
      wasOn = false;
    }
    if (mounted) await _nearMe.restore(wasOn);
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

  @override
  void dispose() {
    _pollTimer?.cancel();
    _nearMe.dispose();
    WidgetsBinding.instance.removeObserver(this);
    _api.session.removeListener(_onSessionChanged);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final foreground = state == AppLifecycleState.resumed;
    if (foreground == _inForeground) return;
    _inForeground = foreground;
    if (foreground) {
      _refreshTab(_currentTabIndex);
      _nearMe.refreshIfOld();
    }
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

  /// The last session seen, for its email once it has gone.
  AuthSession? _lastSession;

  void _onSessionChanged() {
    final session = _api.session.value;
    final key = _accountKey(session);
    final previous = _lastSession;
    _lastSession = session;
    if (!mounted) return;
    if (key == _loadedAccountKey) {
      setState(() {});
      return;
    }
    if (key == null && _loadedAccountKey != null && !_endingSession) {
      _sessionEnded(previous?.email);
    }
    if (key != null && _launchReady && _entry != EntryChoice.member) {
      _rememberEntry(EntryChoice.member);
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

  /// Signing out removes the children's data this phone has kept, and goes
  /// back to the welcome screen.
  Future<void> _signOut() async {
    _endingSession = true;
    try {
      await _cache.clearAccounts();
      await _drafts.clearAll();
      await _api.signOut();
    } finally {
      _endingSession = false;
    }
    _backToWelcome();
  }

  void _backToWelcome() {
    _navigatorKey.currentState?.popUntil((route) => route.isFirst);
    setState(() => _currentTabIndex = _discoverTab);
    _rememberEntry(null);
  }

  /// The account is gone only once the server says so; then so is this phone's
  /// copy of it.
  Future<ApiResult<void>> _deleteAccount() async {
    _endingSession = true;
    final ApiResult<void> result;
    try {
      result = await _api.deleteAccount();
    } finally {
      _endingSession = false;
    }
    if (result is ApiSuccess<void>) {
      await _cache.clearAccounts();
      await _drafts.clearAll();
      if (mounted) {
        setState(() => _currentTabIndex = _discoverTab);
        _rememberEntry(null);
      }
    }
    return result;
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
    // The position stays on the phone: distances are worked out here.
    final result = await _api.fetchEvents();
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
        guardianConsent: selection.guardianConsent,
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

  String? get _profilesUnavailable => _profiles.isNotEmpty
      ? null
      : _profilesLoading
      ? 'Still loading. Please go back and try again in a moment.'
      : _profilesError;

  Widget _page(AuthSession? session) {
    if (session == null && _currentTabIndex != _discoverTab) {
      return _lockedPage(_currentTabIndex);
    }
    return switch (_currentTabIndex) {
      _matchdayTab => MatchdayScreen(
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
      _careerTab => CareerScreen(
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
      _accountTab => ProfilesScreen(
        signedInEmail: session?.email ?? 'Signed in',
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
        onSignOut: _signOut,
        onDeleteAccount: _deleteAccount,
        themeChoice: _theme,
        onThemeChanged: _chooseTheme,
        registrations: _registrations,
        eventNameFor: (id) => id == null ? null : _eventNames[id],
        receiptPicker: widget.receiptPicker,
        onUploadReceipt: _uploadReceipt,
      ),
      _ => DiscoverScreen(
        eventsLoading: _eventsLoading,
        eventsError: _eventsError,
        eventsUpdatedAt: _eventsUpdatedAt,
        events: _events,
        profiles: _profiles,
        registrationsByEvent: _registrationsByEvent,
        nearMe: _nearMe,
        openSettings: widget.openLocationSettings,
        openDeviceLocationSettings: widget.openDeviceLocationSettings,
        requestPreciseLocation: widget.requestPreciseLocation,
        loadMapStyle: widget.loadMapStyle,
        mapSurfaceBuilder: widget.mapSurfaceBuilder,
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
    };
  }

  /// Matchday, Career and Account for a guest: one locked state, the same on
  /// each, opening the same sign-in pages and coming back to this tab.
  Widget _lockedPage(int tab) {
    final (IconData icon, String title, String message) = switch (tab) {
      _matchdayTab => (
        Icons.sports_esports_outlined,
        'Follow your games',
        'Your board, colour and opponent for each round, and the standings, '
            'during a tournament.',
      ),
      _careerTab => (
        Icons.workspace_premium_outlined,
        'Your chess record',
        'Ratings, results and certificates for every player you look after.',
      ),
      _ => (
        Icons.person_outline,
        'Your account',
        'Add your players, register for events and keep track of entries and '
            'receipts.',
      ),
    };
    return LockedTab(
      key: ValueKey('locked-$tab'),
      icon: icon,
      title: title,
      message: message,
      authAvailable: _api.auth.isConfigured,
      onSignIn: () => _openAuth(email: _endedEmail),
      onCreateAccount: () => _openAuth(start: AuthStart.createAccount),
      footer: tab == _accountTab
          ? [
              const SizedBox(height: 40),
              ThemePicker(choice: _theme, onChanged: _chooseTheme),
              const SizedBox(height: 16),
              const LegalLinks(),
            ]
          : const [],
    );
  }

  Widget _home(AuthSession? session) {
    if (!_launchReady) return const LaunchScreen();
    if (session == null && _entry == null) {
      return WelcomeScreen(
        onSignIn: () => _openAuth(),
        onCreateAccount: () => _openAuth(start: AuthStart.createAccount),
        onBrowse: _browseAsGuest,
      );
    }
    return Builder(
      builder: (context) {
        final p = context.pal;
        return Scaffold(
          appBar: AppBar(
            titleSpacing: 16,
            title: Row(
              children: [
                const BrandMark(),
                const SizedBox(width: 12),
                Flexible(
                  child: Text(
                    'Chess Alokas',
                    style: atype(18, weight: 800, color: p.ink),
                  ),
                ),
              ],
            ),
            actions: [
              if (session == null && _api.auth.isConfigured)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: TextButton(
                    key: const Key('appbar-sign-in'),
                    style: TextButton.styleFrom(foregroundColor: p.accent),
                    onPressed: () => _openAuth(email: _endedEmail),
                    child: const Text('Sign in'),
                  ),
                ),
            ],
          ),
          body: _page(session),
          bottomNavigationBar: DecoratedBox(
            decoration: BoxDecoration(
              boxShadow: [BoxShadow(color: p.shadow, blurRadius: 12)],
            ),
            child: NavigationBar(
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
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final session = _api.session.value;
    return AccountScope(
      signedIn: session != null,
      profiles: _profiles,
      profilesSettled:
          _profiles.isNotEmpty ||
          _profilesUpdatedAt != null ||
          (_profilesError != null && !_profilesLoading),
      profilesUnavailable: _profilesUnavailable,
      registrationsByEvent: _registrationsByEvent,
      drafts: _draftList,
      accountKey: _loadedAccountKey,
      authAvailable: _api.auth.isConfigured,
      openAuth: _openAuth,
      child: MaterialApp(
        title: 'Chess Alokas',
        navigatorKey: _navigatorKey,
        debugShowCheckedModeBanner: false,
        theme: AlokasTheme.of(_theme),
        themeAnimationDuration: Duration.zero,
        home: _home(session),
      ),
    );
  }
}
