import 'dart:convert';

import 'package:chess_alokas_mobile/config.dart';
import 'package:chess_alokas_mobile/services/auth_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

AuthService serviceReturning(Map<String, Object?> body) => AuthService(
  config: const AppConfig(
    apiBaseUrl: 'https://example.invalid/api',
    supabaseUrl: 'https://example.invalid',
    supabaseAnonKey: 'public-test-key',
  ),
  httpClient: MockClient((_) async => http.Response(jsonEncode(body), 200)),
  clock: () => DateTime.utc(2026, 11, 2),
);

void main() {
  test('an address already in use says so instead of asking to confirm', () async {
    final result = await serviceReturning({
      'id': 'x',
      'email': 'taken@example.invalid',
      'identities': <Object?>[],
    }).signUp(email: 'taken@example.invalid', password: 'long-enough-1');
    expect(result, isA<ApiFailure<SignUpOutcome>>());
    expect((result as ApiFailure<SignUpOutcome>).message, accountExistsMessage);
  });

  test('a new address asks for confirmation', () async {
    final result = await serviceReturning({
      'id': 'x',
      'email': 'new@example.invalid',
      'identities': <Object?>[
        {'provider': 'email'},
      ],
    }).signUp(email: 'new@example.invalid', password: 'long-enough-1');
    expect(result, isA<ApiSuccess<SignUpOutcome>>());
    expect((result as ApiSuccess<SignUpOutcome>).value, isA<ConfirmationRequired>());
  });
}
