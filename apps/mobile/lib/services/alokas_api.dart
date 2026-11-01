import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config.dart';
import '../models/live.dart';
import '../models/models.dart';
import 'auth_service.dart';
import 'session_storage.dart';

export 'auth_service.dart';

const String _sessionExpiredMessage =
    'Your session has expired. Please sign in again.';
const String _signInRequiredMessage = 'Please sign in first.';

class AlokasApiClient {
  static const Duration _defaultTimeout = Duration(seconds: 15);
  static const Duration _uploadTimeout = Duration(seconds: 90);
  static const Duration _refreshMargin = Duration(seconds: 60);

  final AppConfig config;
  final http.Client _http;
  final SessionStorage _storage;
  final DateTime Function() _now;

  /// The current session; null means signed out.
  final ValueNotifier<AuthSession?> session = ValueNotifier<AuthSession?>(null);

  Future<RefreshOutcome>? _refreshInFlight;

  /// The only route to the sign-in provider.
  final AuthService auth;

  AlokasApiClient({
    AppConfig? config,
    http.Client? httpClient,
    SessionStorage? sessionStorage,
    DateTime Function()? clock,
  }) : this._(
         config ?? AppConfig.fromEnvironment(),
         httpClient ?? http.Client(),
         sessionStorage ?? const SecureSessionStorage(),
         clock ?? DateTime.now,
       );

  AlokasApiClient._(this.config, this._http, this._storage, this._now)
    : auth = AuthService(config: config, httpClient: _http, clock: _now);

  bool get isSignedIn => session.value != null;

  // ---- Auth ----

  /// Loads a saved session at startup. Without one the app is simply signed out.
  Future<void> restoreSession() async {
    if (!auth.isConfigured) return;
    String? stored;
    try {
      stored = await _storage.read();
    } on Object {
      return;
    }
    if (stored == null) return;
    final saved = AuthSession.tryDecode(stored);
    if (saved == null) {
      await _setSession(null);
      return;
    }
    session.value = saved;
    if (_isExpiring(saved)) await _refresh();
  }

  Future<ApiResult<AuthSession>> signInWithPassword({
    required String email,
    required String password,
  }) async {
    final result = await auth.signInWithPassword(
      email: email,
      password: password,
    );
    if (result case ApiSuccess(:final value)) await _setSession(value);
    return result;
  }

  /// Signs in only if the provider hands back a session straight away.
  Future<ApiResult<SignUpOutcome>> signUp({
    required String email,
    required String password,
  }) async {
    final result = await auth.signUp(email: email, password: password);
    if (result case ApiSuccess(value: SignedUpWithSession(:final session))) {
      await _setSession(session);
    }
    return result;
  }

  /// Always signs out on this device, even if the server cannot be told.
  Future<void> signOut() async {
    final current = session.value;
    await _setSession(null);
    if (current != null) await auth.signOut(current);
  }

  Future<void> _setSession(AuthSession? next) async {
    session.value = next;
    try {
      if (next == null) {
        await _storage.delete();
      } else {
        await _storage.write(next.encode());
      }
    } on Object {
      // Keystore trouble: the session works for this run but will not persist.
    }
  }

  bool _isExpiring(AuthSession value) {
    final expiresAt = value.expiresAt;
    return expiresAt != null && !_now().add(_refreshMargin).isBefore(expiresAt);
  }

  /// Refresh tokens rotate, so concurrent callers share one refresh.
  Future<RefreshOutcome> _refresh() {
    return _refreshInFlight ??= _doRefresh().whenComplete(
      () => _refreshInFlight = null,
    );
  }

  Future<RefreshOutcome> _doRefresh() async {
    final current = session.value;
    if (current == null) return RefreshOutcome.rejected;
    final result = await auth.refresh(current);
    if (result.outcome == RefreshOutcome.refreshed) {
      await _setSession(result.session);
    } else if (result.outcome == RefreshOutcome.rejected) {
      await _setSession(null);
    }
    return result.outcome;
  }

  // ---- Transport ----

  Future<http.Response> _send(
    String method,
    Uri uri,
    Map<String, String> headers,
    String? body,
    Duration timeout,
  ) async {
    final request = http.Request(method, uri)..headers.addAll(headers);
    if (body != null) request.body = body;
    final streamed = await _http.send(request).timeout(timeout);
    return http.Response.fromStream(streamed).timeout(timeout);
  }

  Uri _apiUri(String path, [Map<String, String>? query]) {
    final base = config.apiBaseUrl.trim().replaceAll(RegExp(r'/+$'), '');
    return Uri.parse(
      '$base$path',
    ).replace(queryParameters: query == null || query.isEmpty ? null : query);
  }

  /// Sends a request to the API. With [authed] it attaches a fresh token and
  /// retries once after a 401, refreshing the session in between.
  Future<ApiResult<http.Response>> _request(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
    bool authed = false,
    Duration timeout = _defaultTimeout,
  }) async {
    final uri = _apiUri(path, query);
    final encoded = body == null ? null : jsonEncode(body);

    Future<http.Response> sendWith(String? token) => _send(
      method,
      uri,
      {
        'Accept': 'application/json',
        if (encoded != null) 'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      },
      encoded,
      timeout,
    );

    try {
      if (!authed) return ApiSuccess(await sendWith(null));

      var current = session.value;
      if (current == null) {
        return const ApiFailure(_signInRequiredMessage, statusCode: 401);
      }
      if (_isExpiring(current)) {
        final outcome = await _refresh();
        if (outcome == RefreshOutcome.rejected) {
          return const ApiFailure(_sessionExpiredMessage, statusCode: 401);
        }
        if (outcome == RefreshOutcome.unavailable) {
          return const ApiFailure(offlineMessage);
        }
        current = session.value;
        if (current == null) {
          return const ApiFailure(_sessionExpiredMessage, statusCode: 401);
        }
      }

      final first = await sendWith(current.accessToken);
      if (first.statusCode != 401) return ApiSuccess(first);

      final outcome = await _refresh();
      if (outcome == RefreshOutcome.rejected) {
        return const ApiFailure(_sessionExpiredMessage, statusCode: 401);
      }
      final refreshed = session.value;
      if (outcome == RefreshOutcome.unavailable || refreshed == null) {
        return ApiSuccess(first);
      }
      return ApiSuccess(await sendWith(refreshed.accessToken));
    } on Object {
      return const ApiFailure(offlineMessage);
    }
  }

  Map<String, dynamic>? _decodeMap(http.Response response) {
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      return decoded is Map<String, dynamic> ? decoded : null;
    } on Object {
      return null;
    }
  }

  /// The server's own wording when it gave any, otherwise its status code.
  String _errorText(http.Response response) {
    final body = _decodeMap(response);
    if (body != null) {
      for (final key in const [
        'error_description',
        'msg',
        'message',
        'error',
      ]) {
        final value = body[key];
        if (value is String && value.trim().isNotEmpty) return value.trim();
      }
    }
    return 'The server returned HTTP ${response.statusCode}.';
  }

  /// Reads validation errors shaped `{details: {field: {_errors: ["why"]}}}`.
  Map<String, String> _fieldErrorsFrom(http.Response response) {
    final details = _decodeMap(response)?['details'];
    if (details is! Map) return const {};
    final errors = <String, String>{};
    details.forEach((key, value) {
      if (key == '_errors' || key is! String || value is! Map) return;
      final reasons = value['_errors'];
      if (reasons is List && reasons.isNotEmpty && reasons.first is String) {
        errors[key] = reasons.first as String;
      }
    });
    return errors;
  }

  ApiFailure<T> _failureFrom<T>(http.Response response) => ApiFailure<T>(
    _errorText(response),
    statusCode: response.statusCode,
    fieldErrors: _fieldErrorsFrom(response),
  );

  ApiFailure<T> _unexpected<T>() =>
      ApiFailure<T>('The server sent a response the app could not read.');

  Future<ApiResult<T>> _readJson<T>(
    Future<ApiResult<http.Response>> pending,
    T? Function(Map<String, dynamic> json) parse, {
    int expectedStatus = 200,
  }) async {
    final outcome = await pending;
    switch (outcome) {
      case ApiFailure(:final message, :final statusCode):
        return ApiFailure<T>(message, statusCode: statusCode);
      case ApiSuccess(value: final response):
        if (response.statusCode != expectedStatus) {
          return _failureFrom<T>(response);
        }
        final body = _decodeMap(response);
        final parsed = body == null ? null : parse(body);
        return parsed == null ? _unexpected<T>() : ApiSuccess<T>(parsed);
    }
  }

  // ---- Public events ----

  Future<ApiResult<List<MobileEventItem>>> fetchEvents({
    double? lat,
    double? lng,
    double? radiusKm,
    String? search,
  }) {
    return _readJson(
      _request(
        'GET',
        '/public/events',
        query: {
          if (lat != null) 'lat': lat.toString(),
          if (lng != null) 'lng': lng.toString(),
          if (radiusKm != null) 'radiusKm': radiusKm.toString(),
          if (search != null && search.trim().isNotEmpty)
            'search': search.trim(),
        },
      ),
      (json) {
        final events = json['events'];
        if (events is! List) return null;
        return events
            .whereType<Map<String, dynamic>>()
            .map(MobileEventItem.tryFromJson)
            .whereType<MobileEventItem>()
            .toList();
      },
    );
  }

  Future<ApiResult<EventDetail>> fetchEventDetail(String slugOrId) {
    return _readJson(
      _request('GET', '/public/events/${Uri.encodeComponent(slugOrId)}'),
      EventDetail.tryFromJson,
    );
  }

  // ---- Registration ----

  /// `POST /public/events/:slugOrId/register`. Only a 201 counts as registered.
  Future<ApiResult<RegistrationRecord>> submitEventRegistration({
    required String slugOrId,
    required MobilePlayerProfile profile,
    String? categoryId,
    ReceiptFile? receipt,
    Map<String, String> customAnswers = const {},
    bool guardianConsent = false,
  }) {
    return _readJson(
      _request(
        'POST',
        '/public/events/${Uri.encodeComponent(slugOrId)}/register',
        body: {
          'playerProfileId': profile.id,
          if (categoryId != null && isUuid(categoryId))
            'selectedCategoryId': categoryId,
          if (receipt != null) 'receiptDataUrl': receipt.toDataUrl(),
          if (customAnswers.isNotEmpty) 'customAnswers': customAnswers,
          if (guardianConsent) 'guardianConsent': true,
        },
        authed: true,
        timeout: receipt == null ? _defaultTimeout : _uploadTimeout,
      ),
      (json) {
        final registration = json['registration'];
        return registration is Map<String, dynamic>
            ? RegistrationRecord.fromJson(registration)
            : null;
      },
      expectedStatus: 201,
    );
  }

  Future<ApiResult<List<RegistrationRecord>>> fetchMyRegistrations() {
    return _readJson(_request('GET', '/player/registrations', authed: true), (
      json,
    ) {
      final rows = json['registrations'];
      if (rows is! List) return null;
      return rows
          .whereType<Map<String, dynamic>>()
          .map(RegistrationRecord.fromJson)
          .toList();
    });
  }

  /// Adds a receipt to a registration that has none. The API does not have
  /// this route yet: see apps/mobile/README.md. Until it does, a 404 here is
  /// reported plainly and the registration is left as it was.
  Future<ApiResult<RegistrationRecord>> uploadReceipt({
    required String registrationId,
    required ReceiptFile receipt,
  }) async {
    final result = await _readJson<RegistrationRecord>(
      _request(
        'POST',
        '/player/registrations/${Uri.encodeComponent(registrationId)}/receipt',
        body: {'receiptDataUrl': receipt.toDataUrl()},
        authed: true,
        timeout: _uploadTimeout,
      ),
      (json) {
        final registration = json['registration'];
        return registration is Map<String, dynamic>
            ? RegistrationRecord.fromJson(registration)
            : null;
      },
    );
    if (result case ApiFailure(statusCode: 404)) {
      return const ApiFailure(
        'This server cannot take a receipt after registering yet. Nothing was '
        'sent. Please give the receipt to the organizer.',
        statusCode: 404,
      );
    }
    return result;
  }

  /// `DELETE /me`. On success this device forgets the session straight away;
  /// the sign-in account no longer exists to tell.
  Future<ApiResult<void>> deleteAccount() async {
    final outcome = await _request('DELETE', '/me', authed: true);
    switch (outcome) {
      case ApiFailure(:final message, :final statusCode):
        return ApiFailure(message, statusCode: statusCode);
      case ApiSuccess(value: final response):
        if (response.statusCode != 204) return _failureFrom(response);
        await _setSession(null);
        return const ApiSuccess(null);
    }
  }

  // ---- Live tournament ----

  Future<ApiResult<LiveSnapshot>> fetchLive(String token) {
    return _readJson(
      _request('GET', '/public/live/${Uri.encodeComponent(token)}'),
      LiveSnapshot.tryFromJson,
    );
  }

  // ---- Player profiles ----

  Future<ApiResult<List<MobilePlayerProfile>>> fetchProfiles() {
    return _readJson(
      _request('GET', '/player/profiles', authed: true),
      (json) => json['profiles'] is List
          ? MobilePlayerProfile.listFromJson(json['profiles'])
          : null,
    );
  }

  MobilePlayerProfile? _profileFrom(Map<String, dynamic> json) {
    final profile = json['profile'];
    return profile is Map<String, dynamic>
        ? MobilePlayerProfile.tryFromJson(profile)
        : null;
  }

  Future<ApiResult<MobilePlayerProfile>> createProfile(
    Map<String, dynamic> fields,
  ) {
    return _readJson(
      _request('POST', '/player/profiles', body: fields, authed: true),
      _profileFrom,
      expectedStatus: 201,
    );
  }

  Future<ApiResult<MobilePlayerProfile>> updateProfile(
    String id,
    Map<String, dynamic> fields,
  ) {
    return _readJson(
      _request(
        'PATCH',
        '/player/profiles/${Uri.encodeComponent(id)}',
        body: fields,
        authed: true,
      ),
      _profileFrom,
    );
  }

  Future<ApiResult<void>> deleteProfile(String id) async {
    final outcome = await _request(
      'DELETE',
      '/player/profiles/${Uri.encodeComponent(id)}',
      authed: true,
    );
    switch (outcome) {
      case ApiFailure(:final message, :final statusCode):
        return ApiFailure(message, statusCode: statusCode);
      case ApiSuccess(value: final response):
        return response.statusCode == 204
            ? const ApiSuccess(null)
            : _failureFrom(response);
    }
  }

  /// Returns the server's `claimedCount`. The server links an entry only when
  /// its email matches the account's confirmed email and its name matches the
  /// profile's full name, and answers 403 if the email is not confirmed.
  Future<ApiResult<int>> claimPastTournaments(MobilePlayerProfile profile) {
    return _readJson(
      _request(
        'POST',
        '/player/profiles/${Uri.encodeComponent(profile.id)}/claim',
        body: const <String, dynamic>{},
        authed: true,
      ),
      (json) {
        final count = json['claimedCount'];
        return count is num ? count.toInt() : null;
      },
    );
  }

  // ---- Dashboard & certificates ----

  Future<ApiResult<PlayerDashboard>> fetchDashboard(String? profileId) {
    return _readJson(
      _request(
        'GET',
        '/player/dashboard',
        query: {'profileId': ?profileId},
        authed: true,
      ),
      PlayerDashboard.fromJson,
    );
  }

  Future<ApiResult<Uint8List>> downloadCertificate(String issueId) async {
    final outcome = await _request(
      'GET',
      '/certificates/${Uri.encodeComponent(issueId)}/download',
      authed: true,
      timeout: _uploadTimeout,
    );
    switch (outcome) {
      case ApiFailure(:final message, :final statusCode):
        return ApiFailure(message, statusCode: statusCode);
      case ApiSuccess(value: final response):
        return response.statusCode == 200
            ? ApiSuccess(response.bodyBytes)
            : _failureFrom(response);
    }
  }
}
