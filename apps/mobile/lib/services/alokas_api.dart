import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config.dart';
import '../models/models.dart';
import 'session_storage.dart';

sealed class ApiResult<T> {
  const ApiResult();
}

final class ApiSuccess<T> extends ApiResult<T> {
  final T value;

  const ApiSuccess(this.value);
}

final class ApiFailure<T> extends ApiResult<T> {
  final String message;
  final int? statusCode;

  /// Per-field reasons from the API's `details`, keyed by request field name.
  final Map<String, String> fieldErrors;

  const ApiFailure(
    this.message, {
    this.statusCode,
    this.fieldErrors = const {},
  });
}

class AuthSession {
  final String accessToken;
  final String refreshToken;
  final DateTime? expiresAt;
  final String? userId;
  final String? email;

  const AuthSession({
    required this.accessToken,
    required this.refreshToken,
    this.expiresAt,
    this.userId,
    this.email,
  });

  /// Reads a Supabase token response. Null if it holds no usable tokens.
  static AuthSession? tryFromTokenResponse(
    Map<String, dynamic> json,
    DateTime now,
  ) {
    final access = json['access_token'];
    final refresh = json['refresh_token'];
    if (access is! String || access.isEmpty) return null;
    if (refresh is! String || refresh.isEmpty) return null;
    final expiresAtSeconds = json['expires_at'];
    final expiresIn = json['expires_in'];
    final user = json['user'];
    return AuthSession(
      accessToken: access,
      refreshToken: refresh,
      expiresAt: expiresAtSeconds is num
          ? DateTime.fromMillisecondsSinceEpoch(
              expiresAtSeconds.toInt() * 1000,
              isUtc: true,
            )
          : expiresIn is num
              ? now.add(Duration(seconds: expiresIn.toInt()))
              : null,
      userId: user is Map<String, dynamic> ? user['id'] as String? : null,
      email: user is Map<String, dynamic> ? user['email'] as String? : null,
    );
  }

  static AuthSession? tryDecode(String stored) {
    try {
      final json = jsonDecode(stored);
      if (json is! Map<String, dynamic>) return null;
      final access = json['accessToken'];
      final refresh = json['refreshToken'];
      if (access is! String || refresh is! String) return null;
      final expires = json['expiresAt'];
      return AuthSession(
        accessToken: access,
        refreshToken: refresh,
        expiresAt: expires is String ? DateTime.tryParse(expires) : null,
        userId: json['userId'] as String?,
        email: json['email'] as String?,
      );
    } on Object {
      return null;
    }
  }

  String encode() => jsonEncode({
        'accessToken': accessToken,
        'refreshToken': refreshToken,
        'expiresAt': expiresAt?.toUtc().toIso8601String(),
        'userId': userId,
        'email': email,
      });

  AuthSession mergedWith(AuthSession? previous) => AuthSession(
        accessToken: accessToken,
        refreshToken: refreshToken,
        expiresAt: expiresAt,
        userId: userId ?? previous?.userId,
        email: email ?? previous?.email,
      );
}

enum _RefreshOutcome { refreshed, rejected, unavailable }

const String _offlineMessage =
    'Could not reach the server. Check your connection and try again.';
const String _sessionExpiredMessage =
    'Your session has expired. Please sign in again.';
const String _signInRequiredMessage = 'Please sign in first.';
const String notConfiguredMessage =
    "Sign-in isn't available in this version of the app. You can still browse "
    'events.';

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

  Future<_RefreshOutcome>? _refreshInFlight;

  AlokasApiClient({
    AppConfig? config,
    http.Client? httpClient,
    SessionStorage? sessionStorage,
    DateTime Function()? clock,
  })  : config = config ?? AppConfig.fromEnvironment(),
        _http = httpClient ?? http.Client(),
        _storage = sessionStorage ?? const SecureSessionStorage(),
        _now = clock ?? DateTime.now;

  bool get isSignedIn => session.value != null;

  // ---- Auth ----

  Uri _authUri(String path, [Map<String, String>? query]) {
    final base = config.supabaseUrl.trim().replaceAll(RegExp(r'/+$'), '');
    return Uri.parse('$base/auth/v1/$path').replace(queryParameters: query);
  }

  Map<String, String> get _authHeaders => {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'apikey': config.supabaseAnonKey.trim(),
      };

  /// Loads a saved session at startup. Without one the app is simply signed out.
  Future<void> restoreSession() async {
    if (!config.isAuthConfigured) return;
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
    if (!config.isAuthConfigured) {
      return const ApiFailure(notConfiguredMessage);
    }
    final http.Response response;
    try {
      response = await _send(
        'POST',
        _authUri('token', {'grant_type': 'password'}),
        _authHeaders,
        jsonEncode({'email': email.trim(), 'password': password}),
        _defaultTimeout,
      );
    } on Object {
      return const ApiFailure(_offlineMessage);
    }
    if (response.statusCode != 200) {
      return ApiFailure(
        _errorText(response),
        statusCode: response.statusCode,
      );
    }
    final decoded = _decodeMap(response);
    final next = decoded == null
        ? null
        : AuthSession.tryFromTokenResponse(decoded, _now());
    if (next == null) {
      return const ApiFailure('The sign-in service returned no session.');
    }
    await _setSession(next);
    return ApiSuccess(next);
  }

  /// Always signs out on this device, even if the server cannot be told. Other
  /// devices, such as the website, stay signed in.
  Future<void> signOut() async {
    final current = session.value;
    await _setSession(null);
    if (current == null || !config.isAuthConfigured) return;
    try {
      await _send(
        'POST',
        _authUri('logout', {'scope': 'local'}),
        {..._authHeaders, 'Authorization': 'Bearer ${current.accessToken}'},
        null,
        _defaultTimeout,
      );
    } on Object {
      // The token stays valid until it expires; it is gone from this device.
    }
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
    return expiresAt != null &&
        !_now().add(_refreshMargin).isBefore(expiresAt);
  }

  /// Supabase rotates refresh tokens, so concurrent callers share one refresh.
  Future<_RefreshOutcome> _refresh() {
    return _refreshInFlight ??=
        _doRefresh().whenComplete(() => _refreshInFlight = null);
  }

  Future<_RefreshOutcome> _doRefresh() async {
    final current = session.value;
    if (current == null || !config.isAuthConfigured) {
      return _RefreshOutcome.rejected;
    }
    final http.Response response;
    try {
      response = await _send(
        'POST',
        _authUri('token', {'grant_type': 'refresh_token'}),
        _authHeaders,
        jsonEncode({'refresh_token': current.refreshToken}),
        _defaultTimeout,
      );
    } on Object {
      return _RefreshOutcome.unavailable;
    }
    if (response.statusCode == 200) {
      final decoded = _decodeMap(response);
      final next = decoded == null
          ? null
          : AuthSession.tryFromTokenResponse(decoded, _now());
      if (next != null) {
        await _setSession(next.mergedWith(current));
        return _RefreshOutcome.refreshed;
      }
    }
    if (response.statusCode >= 400 &&
        response.statusCode < 500 &&
        response.statusCode != 429) {
      await _setSession(null);
      return _RefreshOutcome.rejected;
    }
    return _RefreshOutcome.unavailable;
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
    return Uri.parse('$base$path').replace(
      queryParameters: query == null || query.isEmpty ? null : query,
    );
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
        if (outcome == _RefreshOutcome.rejected) {
          return const ApiFailure(_sessionExpiredMessage, statusCode: 401);
        }
        if (outcome == _RefreshOutcome.unavailable) {
          return const ApiFailure(_offlineMessage);
        }
        current = session.value;
        if (current == null) {
          return const ApiFailure(_sessionExpiredMessage, statusCode: 401);
        }
      }

      final first = await sendWith(current.accessToken);
      if (first.statusCode != 401) return ApiSuccess(first);

      final outcome = await _refresh();
      if (outcome == _RefreshOutcome.rejected) {
        return const ApiFailure(_sessionExpiredMessage, statusCode: 401);
      }
      final refreshed = session.value;
      if (outcome == _RefreshOutcome.unavailable || refreshed == null) {
        return ApiSuccess(first);
      }
      return ApiSuccess(await sendWith(refreshed.accessToken));
    } on Object {
      return const ApiFailure(_offlineMessage);
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
      for (final key in const ['error_description', 'msg', 'message', 'error']) {
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
      _request('GET', '/public/events', query: {
        if (lat != null) 'lat': lat.toString(),
        if (lng != null) 'lng': lng.toString(),
        if (radiusKm != null) 'radiusKm': radiusKm.toString(),
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
      }),
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
    return _readJson(
      _request('GET', '/player/registrations', authed: true),
      (json) {
        final rows = json['registrations'];
        if (rows is! List) return null;
        return rows
            .whereType<Map<String, dynamic>>()
            .map(RegistrationRecord.fromJson)
            .toList();
      },
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
