import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config.dart';

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

/// What came of creating an account: a session straight away, or a confirmation
/// email has to be followed first.
sealed class SignUpOutcome {
  const SignUpOutcome();
}

final class SignedUpWithSession extends SignUpOutcome {
  final AuthSession session;

  const SignedUpWithSession(this.session);
}

final class ConfirmationRequired extends SignUpOutcome {
  final String email;

  const ConfirmationRequired(this.email);
}

enum RefreshOutcome { refreshed, rejected, unavailable }

class RefreshResult {
  final RefreshOutcome outcome;
  final AuthSession? session;

  const RefreshResult(this.outcome, [this.session]);
}

const String offlineMessage =
    'Could not reach the server. Check your connection and try again.';
const String notConfiguredMessage =
    "Sign-in isn't available in this version of the app. You can still browse "
    'events.';

const String emailNotConfirmedMessage =
    'Please confirm your email first. Open the link we sent you, then sign in.';

/// Every call to the sign-in provider goes through this class, so the provider
/// can be changed in one place.
class AuthService {
  static const Duration _timeout = Duration(seconds: 15);

  final AppConfig config;
  final http.Client _http;
  final DateTime Function() _now;

  AuthService({
    required this.config,
    required http.Client httpClient,
    required DateTime Function() clock,
  }) : _http = httpClient,
       _now = clock;

  bool get isConfigured => config.isAuthConfigured;

  Uri _uri(String path, [Map<String, String>? query]) {
    final base = config.supabaseUrl.trim().replaceAll(RegExp(r'/+$'), '');
    return Uri.parse('$base/auth/v1/$path').replace(queryParameters: query);
  }

  Map<String, String> get _headers => {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'apikey': config.supabaseAnonKey.trim(),
  };

  Future<http.Response> _post(
    Uri uri, {
    Map<String, Object?>? body,
    Map<String, String>? extraHeaders,
  }) async {
    final request = http.Request('POST', uri)
      ..headers.addAll({..._headers, ...?extraHeaders});
    if (body != null) request.body = jsonEncode(body);
    final streamed = await _http.send(request).timeout(_timeout);
    return http.Response.fromStream(streamed).timeout(_timeout);
  }

  Map<String, dynamic>? _decode(http.Response response) {
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      return decoded is Map<String, dynamic> ? decoded : null;
    } on Object {
      return null;
    }
  }

  /// The provider's own wording when it gave any, in plain words for the cases
  /// a person can act on.
  String _errorText(http.Response response) {
    final body = _decode(response);
    final code = body?['error_code'] ?? body?['code'];
    switch (code) {
      case 'email_not_confirmed':
        return emailNotConfirmedMessage;
      case 'invalid_credentials':
        return 'That email and password do not match.';
      case 'user_already_exists':
      case 'email_exists':
        return 'There is already an account with this email. Sign in instead, '
            'or reset your password.';
      case 'weak_password':
        return 'That password is too weak. Use a longer one.';
      case 'over_email_send_rate_limit':
      case 'over_request_rate_limit':
        return 'Too many attempts. Please wait a few minutes and try again.';
      case 'signup_disabled':
        return 'New accounts are not being accepted right now.';
    }
    if (body != null) {
      for (final key in const ['error_description', 'msg', 'message', 'error']) {
        final value = body[key];
        if (value is String && value.trim().isNotEmpty) return value.trim();
      }
    }
    return 'The server returned HTTP ${response.statusCode}.';
  }

  Future<ApiResult<AuthSession>> signInWithPassword({
    required String email,
    required String password,
  }) async {
    if (!isConfigured) return const ApiFailure(notConfiguredMessage);
    final http.Response response;
    try {
      response = await _post(
        _uri('token', {'grant_type': 'password'}),
        body: {'email': email.trim(), 'password': password},
      );
    } on Object {
      return const ApiFailure(offlineMessage);
    }
    if (response.statusCode != 200) {
      return ApiFailure(_errorText(response), statusCode: response.statusCode);
    }
    final decoded = _decode(response);
    final session = decoded == null
        ? null
        : AuthSession.tryFromTokenResponse(decoded, _now());
    return session == null
        ? const ApiFailure('The sign-in service returned no session.')
        : ApiSuccess(session);
  }

  /// With email confirmation on, the provider answers with a user and no
  /// tokens, and it does the same for an email already in use so as not to
  /// reveal who has an account. The two can't be told apart here, so the app
  /// never claims the account was created, only what to do next.
  Future<ApiResult<SignUpOutcome>> signUp({
    required String email,
    required String password,
  }) async {
    if (!isConfigured) return const ApiFailure(notConfiguredMessage);
    final address = email.trim();
    final http.Response response;
    try {
      response = await _post(
        _uri('signup'),
        body: {'email': address, 'password': password},
      );
    } on Object {
      return const ApiFailure(offlineMessage);
    }
    if (response.statusCode != 200 && response.statusCode != 201) {
      return ApiFailure(_errorText(response), statusCode: response.statusCode);
    }
    final decoded = _decode(response);
    if (decoded == null) {
      return const ApiFailure('The sign-in service sent an unreadable reply.');
    }
    final session = AuthSession.tryFromTokenResponse(decoded, _now());
    return ApiSuccess(
      session == null
          ? ConfirmationRequired(address)
          : SignedUpWithSession(session),
    );
  }

  Future<ApiResult<void>> resendConfirmation(String email) async {
    if (!isConfigured) return const ApiFailure(notConfiguredMessage);
    return _sendEmail(_uri('resend'), {'type': 'signup', 'email': email.trim()});
  }

  /// The provider answers the same whether or not the account exists.
  Future<ApiResult<void>> requestPasswordReset(String email) async {
    if (!isConfigured) return const ApiFailure(notConfiguredMessage);
    return _sendEmail(_uri('recover'), {'email': email.trim()});
  }

  Future<ApiResult<void>> _sendEmail(Uri uri, Map<String, Object?> body) async {
    final http.Response response;
    try {
      response = await _post(uri, body: body);
    } on Object {
      return const ApiFailure(offlineMessage);
    }
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return const ApiSuccess(null);
    }
    return ApiFailure(_errorText(response), statusCode: response.statusCode);
  }

  Future<RefreshResult> refresh(AuthSession current) async {
    if (!isConfigured) return const RefreshResult(RefreshOutcome.rejected);
    final http.Response response;
    try {
      response = await _post(
        _uri('token', {'grant_type': 'refresh_token'}),
        body: {'refresh_token': current.refreshToken},
      );
    } on Object {
      return const RefreshResult(RefreshOutcome.unavailable);
    }
    if (response.statusCode == 200) {
      final decoded = _decode(response);
      final next = decoded == null
          ? null
          : AuthSession.tryFromTokenResponse(decoded, _now());
      if (next != null) {
        return RefreshResult(RefreshOutcome.refreshed, next.mergedWith(current));
      }
    }
    if (response.statusCode >= 400 &&
        response.statusCode < 500 &&
        response.statusCode != 429) {
      return const RefreshResult(RefreshOutcome.rejected);
    }
    return const RefreshResult(RefreshOutcome.unavailable);
  }

  /// Best effort: the token stays valid until it expires, but it is already
  /// gone from this device. Other devices stay signed in.
  Future<void> signOut(AuthSession session) async {
    if (!isConfigured) return;
    try {
      await _post(
        _uri('logout', {'scope': 'local'}),
        extraHeaders: {'Authorization': 'Bearer ${session.accessToken}'},
      );
    } on Object {
      // Nothing more to do.
    }
  }
}
