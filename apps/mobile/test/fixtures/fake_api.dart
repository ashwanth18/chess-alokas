import 'dart:convert';

import 'package:chess_alokas_mobile/config.dart';
import 'package:chess_alokas_mobile/services/local_store.dart';
import 'package:chess_alokas_mobile/services/preferences.dart';
import 'package:chess_alokas_mobile/services/session_storage.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Test data only. Every name is obviously fake, and nothing here resembles a
/// real bank account, national ID or FIDE ID.
const String fakeEventId = '00000000-0000-4000-8000-00000000e001';
const String fakeCategoryOpenId = '00000000-0000-4000-8000-00000000c001';
const String fakeCategoryU12Id = '00000000-0000-4000-8000-00000000c002';
const String fakeProfileId = '00000000-0000-4000-8000-00000000a001';
const String fakeUserId = '00000000-0000-4000-8000-00000000b001';
const String fakeCertificateId = '00000000-0000-4000-8000-00000000d001';

const AppConfig fakeConfig = AppConfig(
  apiBaseUrl: 'https://api.example.test/api',
  supabaseUrl: 'https://auth.example.test',
  supabaseAnonKey: 'fake-anon-key-for-tests',
);

/// A published event with every field filled in.
Map<String, dynamic> fakeEvent({
  int entryFeeCents = 0,
  Map<String, dynamic> overrides = const {},
}) {
  return {
    'id': fakeEventId,
    'publicSlug': 'fake-open',
    'name': 'Fake Open Test Event',
    'date': '2099-01-02',
    'style': 'dutch',
    'rounds': 5,
    'status': 'ready',
    'registrationOpen': true,
    'registeredCount': 2,
    'venueName': 'Test Hall',
    'city': 'Testville',
    'state': 'Test State',
    'country': 'Testland',
    'latitude': 3.2,
    'longitude': 101.7,
    'timeControl': 'Test control',
    'entryFeeCents': entryFeeCents,
    'currency': 'TST',
    'organizationName': 'Fake Organizer',
    'categories': [
      {'id': fakeCategoryOpenId, 'name': 'Open'},
      {'id': fakeCategoryU12Id, 'name': 'Under 12 (U12)'},
    ],
    ...overrides,
  };
}

/// The nested `{event, categories, participants}` detail response.
Map<String, dynamic> fakeEventDetail(
  Map<String, dynamic> event, {
  String? paymentInstructions,
}) {
  return {
    'event': {
      ...Map<String, dynamic>.of(event)..remove('categories'),
      'paymentInstructions': paymentInstructions,
      'paymentQrUrl': null,
    },
    'categories': event['categories'] ?? const [],
    'participants': const [],
  };
}

/// An event row with only an id: everything else is unknown.
const Map<String, dynamic> sparseEvent = {
  'id': fakeEventId,
  'registrationOpen': true,
};

Map<String, dynamic> fakeProfile({int? yearOfBirth = 2000}) {
  return {
    'id': fakeProfileId,
    'accountUserId': fakeUserId,
    'isPrimary': true,
    'relationship': 'self',
    'fullName': 'Test Player One',
    'yearOfBirth': yearOfBirth,
    'alokasRating': 1000,
  };
}

Map<String, dynamic> fakeRegistration({
  String status = 'pending',
  String paymentStatus = 'not_required',
  bool hasReceipt = false,
}) {
  return {
    'id': '00000000-0000-4000-8000-00000000f001',
    'tournamentId': fakeEventId,
    'playerProfileId': fakeProfileId,
    'playerSnapshot': {'name': 'Test Player One'},
    'status': status,
    'paymentStatus': paymentStatus,
    'hasReceipt': hasReceipt,
  };
}

Map<String, dynamic> emptyDashboard() {
  return {
    'profiles': const [],
    'selectedProfile': fakeProfile(),
    'liveMatches': const [],
    'stats': const {
      'tournamentsCount': 0,
      'gamesPlayed': 0,
      'wins': 0,
      'draws': 0,
      'losses': 0,
      'totalPoints': 0,
    },
    'tournaments': const [],
    'certificates': const [],
  };
}

Map<String, dynamic> tokenResponse({
  String accessToken = 'fake-access-token',
  String refreshToken = 'fake-refresh-token',
  int expiresIn = 3600,
}) {
  return {
    'access_token': accessToken,
    'refresh_token': refreshToken,
    'expires_in': expiresIn,
    'user': {'id': fakeUserId, 'email': 'player@example.test'},
  };
}

http.Response jsonResponse(Object? body, [int status = 200]) {
  return http.Response.bytes(
    utf8.encode(jsonEncode(body)),
    status,
    headers: const {'content-type': 'application/json'},
  );
}

class InMemorySessionStorage implements SessionStorage {
  String? value;

  InMemorySessionStorage([this.value]);

  @override
  Future<String?> read() async => value;

  @override
  Future<void> write(String next) async => value = next;

  @override
  Future<void> delete() async => value = null;
}

class InMemoryLocalStore implements LocalStore {
  final Map<String, String> texts = {};
  final Map<String, Uint8List> blobs = {};

  @override
  Future<String?> read(String key) async => texts[key];

  @override
  Future<void> write(String key, String value) async => texts[key] = value;

  @override
  Future<Uint8List?> readBytes(String key) async => blobs[key];

  @override
  Future<void> writeBytes(String key, Uint8List bytes) async =>
      blobs[key] = bytes;

  @override
  Future<void> delete(String key) async {
    texts.remove(key);
    blobs.remove(key);
  }

  @override
  Future<List<String>> keysWithPrefix(String prefix) async => [
    ...texts.keys,
    ...blobs.keys,
  ].where((k) => k.startsWith(prefix)).toList();
}

/// Starts as a returning guest, so most tests open straight on Discover. A
/// first-launch test sets [entry] to null.
class MemoryPreferences implements AppPreferences {
  bool nearMe = false;
  String? theme;
  EntryChoice? entry = EntryChoice.guest;

  @override
  Future<bool> readNearMe() async => nearMe;

  @override
  Future<void> writeNearMe(bool on) async => nearMe = on;

  @override
  Future<String?> readThemeName() async => theme;

  @override
  Future<void> writeThemeName(String name) async => theme = name;

  @override
  Future<EntryChoice?> readEntry() async => entry;

  @override
  Future<void> writeEntry(EntryChoice? choice) async => entry = choice;
}

typedef FakeHandler = http.Response Function(http.Request request);

/// Answers requests from a `'METHOD /path'` table and records all of them. A
/// request with no entry fails, so a test cannot quietly depend on one.
class FakeBackend {
  final Map<String, FakeHandler> routes;
  final List<http.Request> requests = [];

  FakeBackend(this.routes);

  late final http.Client client = MockClient((request) async {
    requests.add(request);
    final handler = routes['${request.method} ${request.url.path}'];
    if (handler == null) {
      return jsonResponse({'error': 'No fake route for ${request.url}'}, 404);
    }
    return handler(request);
  });

  List<http.Request> sent(String method, String path) =>
      requests.where((r) => r.method == method && r.url.path == path).toList();
}
