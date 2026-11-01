import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:chess_alokas_mobile/config.dart';
import 'package:chess_alokas_mobile/main.dart';
import 'package:chess_alokas_mobile/models/models.dart';
import 'package:chess_alokas_mobile/services/alokas_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'fixtures/fake_api.dart';

const String _eventsPath = '/api/public/events';
const String _detailPath = '/api/public/events/fake-open';
const String _registerPath = '/api/public/events/fake-open/register';
const String _profilesPath = '/api/player/profiles';
const String _tokenPath = '/auth/v1/token';

/// Routes a signed-in account needs on startup, on top of a test's own.
Map<String, FakeHandler> _accountRoutes({
  List<Map<String, dynamic>>? profiles,
  Map<String, dynamic>? dashboard,
}) {
  return {
    'GET $_profilesPath': (_) =>
        jsonResponse({'profiles': profiles ?? [fakeProfile()]}),
    'GET /api/player/registrations': (_) =>
        jsonResponse({'registrations': const []}),
    'GET /api/player/dashboard': (_) =>
        jsonResponse(dashboard ?? emptyDashboard()),
  };
}

Map<String, FakeHandler> _eventRoutes(
  Map<String, dynamic> event, {
  String? paymentInstructions,
}) {
  return {
    'GET $_eventsPath': (_) => jsonResponse({
          'events': [event],
        }),
    'GET $_detailPath': (_) => jsonResponse(
          fakeEventDetail(event, paymentInstructions: paymentInstructions),
        ),
  };
}

InMemorySessionStorage _signedInStorage() {
  return InMemorySessionStorage(
    AuthSession(
      accessToken: 'fake-access-token',
      refreshToken: 'fake-refresh-token',
      expiresAt: DateTime.now().add(const Duration(hours: 1)),
      userId: fakeUserId,
      email: 'player@example.test',
    ).encode(),
  );
}

Future<void> _pumpApp(
  WidgetTester tester,
  FakeBackend backend, {
  InMemorySessionStorage? storage,
  AppConfig config = fakeConfig,
  Future<PickedReceipt?> Function()? picker,
  Future<bool> Function(String, Uint8List)? saver,
}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final api = AlokasApiClient(
    config: config,
    httpClient: backend.client,
    sessionStorage: storage ?? InMemorySessionStorage(),
  );
  await tester.pumpWidget(
    ChessAlokasMobileApp(
      apiClient: api,
      receiptPicker: picker ?? () async => null,
      certificateSaver: saver ?? (_, _) async => true,
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _openFirstEvent(WidgetTester tester) async {
  final button = find.text('View & Register').first;
  await tester.ensureVisible(button);
  await tester.tap(button);
  await tester.pumpAndSettle();
}

Future<void> _tapConfirm(WidgetTester tester) async {
  final confirm = find.byKey(const Key('confirm-register-button'));
  await tester.ensureVisible(confirm);
  await tester.pumpAndSettle();
  await tester.tap(confirm);
  await tester.pumpAndSettle();
}

Iterable<String> _visibleTexts(WidgetTester tester) {
  return tester
      .widgetList<Text>(find.byType(Text))
      .map((t) => t.data ?? t.textSpan?.toPlainText() ?? '');
}

void main() {
  group('Discover', () {
    testWidgets('an empty feed shows the empty state', (tester) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
      });
      await _pumpApp(tester, backend);

      expect(find.text('No events yet'), findsOneWidget);
      expect(find.text('View & Register'), findsNothing);
    });

    testWidgets('a failed feed shows the server error, and Retry works', (
      tester,
    ) async {
      var healthy = false;
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => healthy
            ? jsonResponse({
                'events': [fakeEvent()],
              })
            : jsonResponse({'error': 'Feed is down for tests'}, 500),
      });
      await _pumpApp(tester, backend);

      expect(find.text('Could not load events'), findsOneWidget);
      expect(find.text('Feed is down for tests'), findsOneWidget);
      expect(find.text('Fake Open Test Event'), findsNothing);

      healthy = true;
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();

      expect(find.text('Fake Open Test Event'), findsOneWidget);
      expect(find.text('Could not load events'), findsNothing);
    });

    testWidgets('unknown fields are not invented', (tester) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({
              'events': [sparseEvent],
            }),
      });
      await _pumpApp(tester, backend);

      expect(find.text('Unnamed event'), findsOneWidget);
      expect(find.text('Venue not listed'), findsOneWidget);
      expect(find.text('Date not listed'), findsOneWidget);
      expect(find.text('Fee not listed'), findsOneWidget);
      expect(find.textContaining('km from'), findsNothing);
      expect(find.byIcon(Icons.verified), findsNothing);
      for (final text in _visibleTexts(tester)) {
        expect(text.toLowerCase(), isNot(contains('verified')));
      }
    });

    test('the event model keeps unknown fields null', () {
      final event = MobileEventItem.tryFromJson(sparseEvent)!;

      expect(event.name, isNull);
      expect(event.date, isNull);
      expect(event.organizationName, isNull);
      expect(event.venueName, isNull);
      expect(event.city, isNull);
      expect(event.latitude, isNull);
      expect(event.longitude, isNull);
      expect(event.timeControl, isNull);
      expect(event.rounds, isNull);
      expect(event.entryFeeCents, isNull);
      expect(event.currency, isNull);
      expect(event.descriptionMd, isNull);
      expect(event.categories, isEmpty);
      expect(event.distanceFrom(3.1, 101.6), isNull);
      expect(event.registrationOpen, isTrue);

      final closed = MobileEventItem.tryFromJson({'id': fakeEventId})!;
      expect(closed.registrationOpen, isFalse);
    });

    test('categories without a real UUID are dropped', () {
      final categories = EventCategoryInfo.listFromJson([
        {'id': 'cat-open', 'name': 'Open'},
        {'id': fakeCategoryU12Id, 'name': 'Under 12 (U12)'},
        {'name': 'No id'},
      ]);

      expect(categories.map((c) => c.id), [fakeCategoryU12Id]);
      expect(categories.single.maxAge, 12);
      expect(categories.single.code, 'U12');
    });

    testWidgets('the location label is honest', (tester) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
      });
      await _pumpApp(tester, backend);

      expect(find.text('Near: Kuala Lumpur'), findsOneWidget);
      expect(find.textContaining('GPS'), findsNothing);
    });
  });

  group('Payment details', () {
    final bankNumber = RegExp(r'\d{4}[- ]\d{4}|\b\d{8,}\b');

    testWidgets('no bank number appears unless the API provides one', (
      tester,
    ) async {
      final event = fakeEvent(entryFeeCents: 5000);
      final backend = FakeBackend(_eventRoutes(event));
      await _pumpApp(tester, backend);
      await _openFirstEvent(tester);

      expect(
        find.byKey(const Key('payment-contact-organizer')),
        findsOneWidget,
      );
      expect(find.byKey(const Key('payment-instructions')), findsNothing);
      for (final text in _visibleTexts(tester)) {
        expect(text, isNot(matches(bankNumber)));
      }
    });

    testWidgets('instructions come from the event detail, as given', (
      tester,
    ) async {
      final event = fakeEvent(entryFeeCents: 5000);
      final backend = FakeBackend(
        _eventRoutes(event, paymentInstructions: 'Pay the fake test cashier'),
      );
      await _pumpApp(tester, backend);
      expect(find.text('Pay the fake test cashier'), findsNothing);

      await _openFirstEvent(tester);

      expect(find.text('Pay the fake test cashier'), findsOneWidget);
      expect(find.byKey(const Key('payment-contact-organizer')), findsNothing);
    });

    testWidgets('instructions in the feed row are not shown', (tester) async {
      final event = fakeEvent(
        entryFeeCents: 5000,
        overrides: {'paymentInstructions': 'Feed row should not be used'},
      );
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({
              'events': [event],
            }),
        'GET $_detailPath': (_) => jsonResponse(fakeEventDetail(event)),
      });
      await _pumpApp(tester, backend);
      await _openFirstEvent(tester);

      expect(find.text('Feed row should not be used'), findsNothing);
      expect(
        find.byKey(const Key('payment-contact-organizer')),
        findsOneWidget,
      );
    });

    testWidgets('a failed detail load shows an error and blocks registering', (
      tester,
    ) async {
      final event = fakeEvent(entryFeeCents: 5000);
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({
              'events': [event],
            }),
        'GET $_detailPath': (_) =>
            jsonResponse({'error': 'Event not found'}, 404),
      });
      await _pumpApp(tester, backend);
      await _openFirstEvent(tester);

      expect(find.text('Event not found'), findsOneWidget);
      expect(find.byKey(const Key('confirm-register-button')), findsNothing);
      expect(find.byKey(const Key('payment-contact-organizer')), findsNothing);
    });
  });

  group('Registration', () {
    Map<String, FakeHandler> routes(
      Map<String, dynamic> event,
      FakeHandler register,
    ) {
      return {
        ..._eventRoutes(event),
        ..._accountRoutes(),
        'POST $_registerPath': register,
      };
    }

    testWidgets('a server rejection shows failure and marks nothing', (
      tester,
    ) async {
      final backend = FakeBackend(
        routes(
          fakeEvent(),
          (_) => jsonResponse(
            {'error': 'Registration is currently closed for this tournament.'},
            400,
          ),
        ),
      );
      await _pumpApp(tester, backend, storage: _signedInStorage());
      await _openFirstEvent(tester);
      await _tapConfirm(tester);

      expect(
        find.textContaining(
          'NOT registered. Registration is currently closed for this tournament.',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('Submitted.'), findsNothing);

      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
      expect(find.textContaining('Pending: '), findsNothing);
    });

    testWidgets('a network failure shows failure, never success', (
      tester,
    ) async {
      final backend = FakeBackend(
        routes(
          fakeEvent(),
          (_) => throw const SocketException('offline for tests'),
        ),
      );
      await _pumpApp(tester, backend, storage: _signedInStorage());
      await _openFirstEvent(tester);
      await _tapConfirm(tester);

      expect(find.textContaining('NOT registered.'), findsOneWidget);
      expect(find.textContaining('Could not reach the server'), findsOneWidget);
      expect(find.textContaining('Submitted.'), findsNothing);
    });

    testWidgets('a 200 is not treated as registered', (tester) async {
      final backend = FakeBackend(
        routes(
          fakeEvent(),
          (_) => jsonResponse({'registration': fakeRegistration()}, 200),
        ),
      );
      await _pumpApp(tester, backend, storage: _signedInStorage());
      await _openFirstEvent(tester);
      await _tapConfirm(tester);

      expect(find.textContaining('NOT registered.'), findsOneWidget);
    });

    testWidgets('a 201 sends the real ids and marks the event', (tester) async {
      final backend = FakeBackend(
        routes(
          fakeEvent(),
          (_) => jsonResponse({'registration': fakeRegistration()}, 201),
        ),
      );
      await _pumpApp(tester, backend, storage: _signedInStorage());
      await _openFirstEvent(tester);
      await _tapConfirm(tester);

      final request = backend.sent('POST', _registerPath).single;
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      expect(body['playerProfileId'], fakeProfileId);
      expect(body['selectedCategoryId'], fakeCategoryOpenId);
      expect(body.containsKey('receiptDataUrl'), isFalse);
      expect(request.headers['Authorization'], 'Bearer fake-access-token');

      expect(
        find.text('Pending: Test Player One'),
        findsOneWidget,
      );
    });

    testWidgets('a waitlisted response is shown as waitlisted', (tester) async {
      final backend = FakeBackend(
        routes(
          fakeEvent(),
          (_) => jsonResponse(
            {'registration': fakeRegistration(status: 'waitlisted')},
            201,
          ),
        ),
      );
      await _pumpApp(tester, backend, storage: _signedInStorage());
      await _openFirstEvent(tester);
      await _tapConfirm(tester);

      expect(find.text('Waitlisted: Test Player One'), findsOneWidget);
      expect(find.textContaining('Pending: '), findsNothing);
    });

    testWidgets('signed out, the sheet asks for sign-in and posts nothing', (
      tester,
    ) async {
      final backend = FakeBackend(_eventRoutes(fakeEvent()));
      await _pumpApp(tester, backend);
      await _openFirstEvent(tester);

      expect(find.text('Sign in to register'), findsOneWidget);
      expect(find.byKey(const Key('confirm-register-button')), findsNothing);
      expect(backend.sent('POST', _registerPath), isEmpty);
    });

    testWidgets('a paid event warns when no receipt is chosen', (tester) async {
      final backend = FakeBackend(
        routes(
          fakeEvent(entryFeeCents: 5000),
          (_) => jsonResponse(
            {
              'registration': fakeRegistration(
                paymentStatus: 'pending_receipt',
              ),
            },
            201,
          ),
        ),
      );
      await _pumpApp(tester, backend, storage: _signedInStorage());
      await _openFirstEvent(tester);

      expect(find.byKey(const Key('receipt-pending-note')), findsOneWidget);
    });

    testWidgets('a chosen receipt is sent as a real data URL', (tester) async {
      final png = Uint8List.fromList([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
      final backend = FakeBackend(
        routes(
          fakeEvent(entryFeeCents: 5000),
          (_) => jsonResponse(
            {
              'registration': fakeRegistration(
                paymentStatus: 'submitted',
                hasReceipt: true,
              ),
            },
            201,
          ),
        ),
      );
      await _pumpApp(
        tester,
        backend,
        storage: _signedInStorage(),
        picker: () async => PickedReceipt(name: 'test-receipt.png', bytes: png),
      );
      await _openFirstEvent(tester);

      final choose = find.byKey(const Key('choose-receipt-button'));
      await tester.ensureVisible(choose);
      await tester.pumpAndSettle();
      await tester.tap(choose);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('receipt-chosen')), findsOneWidget);
      expect(find.byKey(const Key('receipt-pending-note')), findsNothing);

      await _tapConfirm(tester);

      final body = jsonDecode(backend.sent('POST', _registerPath).single.body)
          as Map<String, dynamic>;
      expect(body['receiptDataUrl'], 'data:image/png;base64,${base64Encode(png)}');
    });

    testWidgets('a receipt the server did not record is reported', (
      tester,
    ) async {
      final png = Uint8List.fromList([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
      final backend = FakeBackend(
        routes(
          fakeEvent(entryFeeCents: 5000),
          (_) => jsonResponse(
            {'registration': fakeRegistration(hasReceipt: false)},
            201,
          ),
        ),
      );
      await _pumpApp(
        tester,
        backend,
        storage: _signedInStorage(),
        picker: () async => PickedReceipt(name: 'test-receipt.png', bytes: png),
      );
      await _openFirstEvent(tester);

      final choose = find.byKey(const Key('choose-receipt-button'));
      await tester.ensureVisible(choose);
      await tester.pumpAndSettle();
      await tester.tap(choose);
      await tester.pumpAndSettle();
      await _tapConfirm(tester);

      expect(
        find.textContaining('the server did not record the receipt'),
        findsOneWidget,
      );
    });

    test('receipt validation enforces type and size on the client', () {
      Uint8List sized(int length, List<int> head) {
        final bytes = Uint8List(length);
        bytes.setAll(0, head);
        return bytes;
      }

      const png = [0x89, 0x50, 0x4e, 0x47];
      final (ok, okError) = ReceiptFile.validate(
        PickedReceipt(name: 'a.png', bytes: sized(100, png)),
      );
      expect(okError, isNull);
      expect(ok!.contentType, 'image/png');

      final (big, bigError) = ReceiptFile.validate(
        PickedReceipt(
          name: 'a.png',
          bytes: sized(ReceiptFile.maxBytes + 1, png),
        ),
      );
      expect(big, isNull);
      expect(bigError, ReceiptFile.tooLargeMessage);

      final (fake, fakeError) = ReceiptFile.validate(
        PickedReceipt(
          name: 'renamed.png',
          bytes: Uint8List.fromList(utf8.encode('<html>not an image</html>')),
        ),
      );
      expect(fake, isNull);
      expect(fakeError, ReceiptFile.wrongTypeMessage);

      const webp = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
      const pdf = [0x25, 0x50, 0x44, 0x46];
      const jpeg = [0xff, 0xd8, 0xff];
      expect(
        ReceiptFile.validate(PickedReceipt(name: 'w', bytes: sized(20, webp)))
            .$1!
            .contentType,
        'image/webp',
      );
      expect(
        ReceiptFile.validate(PickedReceipt(name: 'p', bytes: sized(20, pdf)))
            .$1!
            .contentType,
        'application/pdf',
      );
      expect(
        ReceiptFile.validate(PickedReceipt(name: 'j', bytes: sized(20, jpeg)))
            .$1!
            .contentType,
        'image/jpeg',
      );
    });
  });

  group('Sign-in', () {
    Future<void> attemptSignIn(WidgetTester tester) async {
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('open-sign-in-button')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('sign-in-email')),
        'player@example.test',
      );
      await tester.enterText(
        find.byKey(const Key('sign-in-password')),
        'not-a-real-password',
      );
      await tester.tap(find.byKey(const Key('sign-in-submit')));
      await tester.pumpAndSettle();
    }

    testWidgets('a wrong password leaves you signed out with the real error', (
      tester,
    ) async {
      final storage = InMemorySessionStorage();
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        'POST $_tokenPath': (_) => jsonResponse(
              {
                'error': 'invalid_grant',
                'error_description': 'Invalid login credentials',
              },
              400,
            ),
      });
      await _pumpApp(tester, backend, storage: storage);
      await attemptSignIn(tester);

      expect(find.text('Invalid login credentials'), findsOneWidget);
      expect(storage.value, isNull);

      await tester.tapAt(const Offset(10, 10));
      await tester.pumpAndSettle();
      expect(find.text('Not signed in'), findsWidgets);
      expect(find.byKey(const Key('sign-out-button')), findsNothing);
      expect(backend.sent('GET', _profilesPath), isEmpty);
    });

    testWidgets('a network error leaves you signed out', (tester) async {
      final storage = InMemorySessionStorage();
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        'POST $_tokenPath': (_) =>
            throw const SocketException('offline for tests'),
      });
      await _pumpApp(tester, backend, storage: storage);
      await attemptSignIn(tester);

      expect(find.textContaining('Could not reach the server'), findsOneWidget);
      expect(storage.value, isNull);
      expect(backend.sent('GET', _profilesPath), isEmpty);
    });

    testWidgets('success stores the session and loads real profiles', (
      tester,
    ) async {
      final storage = InMemorySessionStorage();
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        'POST $_tokenPath': (_) => jsonResponse(tokenResponse()),
        ..._accountRoutes(),
      });
      await _pumpApp(tester, backend, storage: storage);
      await attemptSignIn(tester);

      expect(find.text('player@example.test'), findsOneWidget);
      expect(find.text('Test Player One'), findsOneWidget);
      expect(storage.value, contains('fake-refresh-token'));
      expect(
        backend.sent('GET', _profilesPath).single.headers['Authorization'],
        'Bearer fake-access-token',
      );
    });

    testWidgets('missing config shows a clear message and sends nothing', (
      tester,
    ) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
      });
      await _pumpApp(
        tester,
        backend,
        config: const AppConfig(apiBaseUrl: 'https://api.example.test/api'),
      );
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();

      expect(find.textContaining("isn't available"), findsOneWidget);

      await tester.tap(find.byKey(const Key('open-sign-in-button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('sign-in-not-configured')), findsOneWidget);
      expect(find.byKey(const Key('sign-in-submit')), findsNothing);
      expect(backend.sent('POST', _tokenPath), isEmpty);
    });

    test('signing in without config fails', () async {
      final backend = FakeBackend({});
      final api = AlokasApiClient(
        config: const AppConfig(),
        httpClient: backend.client,
        sessionStorage: InMemorySessionStorage(),
      );

      final result = await api.signInWithPassword(
        email: 'player@example.test',
        password: 'not-a-real-password',
      );

      expect(result, isA<ApiFailure<AuthSession>>());
      expect(api.isSignedIn, isFalse);
      expect(backend.requests, isEmpty);
    });
  });

  group('Session refresh', () {
    AuthSession expiredSession() => AuthSession(
          accessToken: 'old-access-token',
          refreshToken: 'old-refresh-token',
          expiresAt: DateTime.now().subtract(const Duration(minutes: 5)),
          userId: fakeUserId,
          email: 'player@example.test',
        );

    test('an expired session refreshes on restore and is stored', () async {
      final storage = InMemorySessionStorage(expiredSession().encode());
      final backend = FakeBackend({
        'POST $_tokenPath': (_) => jsonResponse(
              tokenResponse(
                accessToken: 'new-access-token',
                refreshToken: 'new-refresh-token',
              ),
            ),
      });
      final api = AlokasApiClient(
        config: fakeConfig,
        httpClient: backend.client,
        sessionStorage: storage,
      );

      await api.restoreSession();

      expect(api.session.value?.accessToken, 'new-access-token');
      expect(storage.value, contains('new-refresh-token'));
      final request = backend.sent('POST', _tokenPath).single;
      expect(request.url.queryParameters['grant_type'], 'refresh_token');
    });

    test('a rejected refresh signs out and clears storage', () async {
      final storage = InMemorySessionStorage(expiredSession().encode());
      final backend = FakeBackend({
        'POST $_tokenPath': (_) =>
            jsonResponse({'error': 'invalid_grant'}, 400),
      });
      final api = AlokasApiClient(
        config: fakeConfig,
        httpClient: backend.client,
        sessionStorage: storage,
      );

      await api.restoreSession();

      expect(api.isSignedIn, isFalse);
      expect(storage.value, isNull);
    });

    test('a 401 refreshes once and retries with the new token', () async {
      final storage = _signedInStorage();
      final seenTokens = <String?>[];
      final backend = FakeBackend({
        'POST $_tokenPath': (_) =>
            jsonResponse(tokenResponse(accessToken: 'new-access-token')),
        'GET $_profilesPath': (request) {
          seenTokens.add(request.headers['Authorization']);
          return seenTokens.length == 1
              ? jsonResponse({'error': 'Unauthorized'}, 401)
              : jsonResponse({'profiles': const []});
        },
      });
      final api = AlokasApiClient(
        config: fakeConfig,
        httpClient: backend.client,
        sessionStorage: storage,
      );
      await api.restoreSession();

      final result = await api.fetchProfiles();

      expect(result, isA<ApiSuccess<List<MobilePlayerProfile>>>());
      expect(seenTokens, [
        'Bearer fake-access-token',
        'Bearer new-access-token',
      ]);
    });

    test('concurrent callers share a single refresh', () async {
      final storage = InMemorySessionStorage(expiredSession().encode());
      final backend = FakeBackend({
        'POST $_tokenPath': (_) => jsonResponse(tokenResponse()),
        'GET $_profilesPath': (_) => jsonResponse({'profiles': const []}),
        'GET /api/player/registrations': (_) =>
            jsonResponse({'registrations': const []}),
      });
      final api = AlokasApiClient(
        config: fakeConfig,
        httpClient: backend.client,
        sessionStorage: storage,
      );
      api.session.value = expiredSession();

      await Future.wait([api.fetchProfiles(), api.fetchMyRegistrations()]);

      expect(backend.sent('POST', _tokenPath), hasLength(1));
    });
  });

  group('Profiles', () {
    testWidgets('signed out shows a prompt and calls no profile API', (
      tester,
    ) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
      });
      await _pumpApp(tester, backend);
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();

      expect(find.text('Sign in to manage player profiles'), findsOneWidget);
      expect(find.byKey(const Key('open-add-profile-button')), findsNothing);
      expect(backend.sent('GET', _profilesPath), isEmpty);
    });

    testWidgets('create posts to the API and a failure keeps the form open', (
      tester,
    ) async {
      var created = false;
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._accountRoutes(),
        'GET $_profilesPath': (_) => jsonResponse({
              'profiles': created ? [fakeProfile()] : const [],
            }),
        'POST $_profilesPath': (request) {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          if (body['username'] == 'taken_name') {
            return jsonResponse(
              {'message': 'Username "@taken_name" is already taken.'},
              409,
            );
          }
          created = true;
          return jsonResponse({'profile': fakeProfile()}, 201);
        },
      });
      await _pumpApp(tester, backend, storage: _signedInStorage());
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      expect(find.text('No player profiles yet'), findsOneWidget);

      await tester.tap(find.byKey(const Key('open-add-profile-button')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('add-profile-fullname')),
        'Test Player One',
      );
      await tester.enterText(
        find.byKey(const Key('add-profile-username')),
        'taken_name',
      );
      await tester.tap(find.byKey(const Key('save-profile-button')));
      await tester.pumpAndSettle();

      expect(
        find.text('Username "@taken_name" is already taken.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('save-profile-button')), findsOneWidget);

      await tester.enterText(find.byKey(const Key('add-profile-username')), '');
      await tester.tap(find.byKey(const Key('save-profile-button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('save-profile-button')), findsNothing);
      expect(find.text('Test Player One'), findsWidgets);
      expect(find.text('FAMILY & STUDENT PROFILES (1)'), findsOneWidget);
    });

    testWidgets('the new-profile form starts with nothing filled in', (
      tester,
    ) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._accountRoutes(profiles: const []),
      });
      await _pumpApp(tester, backend, storage: _signedInStorage());
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('open-add-profile-button')));
      await tester.pumpAndSettle();

      for (final key in const [
        'add-profile-fullname',
        'add-profile-username',
        'add-profile-yob',
        'add-profile-rating',
        'add-profile-fideid',
        'add-profile-school',
      ]) {
        final field = tester.widget<TextField>(find.byKey(Key(key)));
        expect(field.controller!.text, isEmpty, reason: key);
      }
    });

    testWidgets('edit sends a PATCH to the profile', (tester) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._accountRoutes(),
        'PATCH $_profilesPath/$fakeProfileId': (_) =>
            jsonResponse({'profile': fakeProfile()}),
      });
      await _pumpApp(tester, backend, storage: _signedInStorage());
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('edit-$fakeProfileId')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('add-profile-yob')), '2001');
      await tester.tap(find.byKey(const Key('save-profile-button')));
      await tester.pumpAndSettle();

      final request =
          backend.sent('PATCH', '$_profilesPath/$fakeProfileId').single;
      expect(jsonDecode(request.body)['yearOfBirth'], 2001);
    });

    testWidgets('delete sends a DELETE and reports a failure', (tester) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._accountRoutes(),
        'DELETE $_profilesPath/$fakeProfileId': (_) =>
            jsonResponse({'error': 'Player profile not found'}, 404),
      });
      await _pumpApp(tester, backend, storage: _signedInStorage());
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('delete-$fakeProfileId')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('confirm-delete-profile-button')));
      await tester.pumpAndSettle();

      expect(
        find.textContaining('Could not delete Test Player One'),
        findsOneWidget,
      );
      expect(find.text('Test Player One'), findsOneWidget);
    });

    testWidgets('claim shows the real claimedCount', (tester) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._accountRoutes(),
        'POST $_profilesPath/$fakeProfileId/claim': (_) =>
            jsonResponse({'claimedCount': 7, 'participantIds': const []}),
      });
      await _pumpApp(tester, backend, storage: _signedInStorage());
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('claim-$fakeProfileId')));
      await tester.pumpAndSettle();

      expect(
        find.text('Claimed 7 past tournament entries for Test Player One.'),
        findsOneWidget,
      );
    });

    testWidgets('a failed claim reports failure, not a count', (tester) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._accountRoutes(),
        'POST $_profilesPath/$fakeProfileId/claim': (_) =>
            jsonResponse({'error': 'Player profile not found'}, 404),
      });
      await _pumpApp(tester, backend, storage: _signedInStorage());
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('claim-$fakeProfileId')));
      await tester.pumpAndSettle();

      expect(
        find.text('Claim failed: Player profile not found'),
        findsOneWidget,
      );
      expect(find.textContaining('Claimed '), findsNothing);
    });

    test('age uses the given year, and an unknown birth year stays unknown', () {
      final known = MobilePlayerProfile.tryFromJson(fakeProfile())!;
      expect(known.ageInYear(2030), 30);
      expect(known.ageInYear(2040), 40);
      expect(known.age, DateTime.now().year - 2000);

      final unknown = MobilePlayerProfile.tryFromJson(
        fakeProfile(yearOfBirth: null),
      )!;
      expect(unknown.age, isNull);
      expect(unknown.gender, isNull);
      expect(unknown.school, isNull);
      expect(unknown.city, isNull);
      expect(unknown.bestRating, isNull);
    });

    test('category suggestions do not guess', () {
      const open = EventCategoryInfo(id: fakeCategoryOpenId, name: 'Open');
      const u12 = EventCategoryInfo(
        id: fakeCategoryU12Id,
        name: 'Under 12 (U12)',
      );
      final thisYear = DateTime.now().year;

      final child = MobilePlayerProfile.tryFromJson(
        fakeProfile(yearOfBirth: thisYear - 10),
      )!;
      expect(child.suggestCategory([open, u12]), u12);

      final adult = MobilePlayerProfile.tryFromJson(
        fakeProfile(yearOfBirth: thisYear - 30),
      )!;
      expect(adult.suggestCategory([open, u12]), open);
      expect(adult.suggestCategory([u12, u12]), isNull);

      final unknown = MobilePlayerProfile.tryFromJson(
        fakeProfile(yearOfBirth: null),
      )!;
      expect(unknown.suggestCategory([open, u12]), isNull);
      expect(unknown.suggestCategory([]), isNull);
    });
  });

  group('Matchday and Career', () {
    testWidgets('signed out shows sign-in prompts and no player data', (
      tester,
    ) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
      });
      await _pumpApp(tester, backend);

      await tester.tap(find.text('Matchday'));
      await tester.pumpAndSettle();
      expect(find.text('Sign in to see your matches'), findsOneWidget);

      await tester.tap(find.text('Career'));
      await tester.pumpAndSettle();
      expect(find.text('Sign in to see your career'), findsOneWidget);
      expect(backend.sent('GET', '/api/player/dashboard'), isEmpty);
    });

    testWidgets('an empty dashboard shows honest empty states', (tester) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._accountRoutes(),
      });
      await _pumpApp(tester, backend, storage: _signedInStorage());

      await tester.tap(find.text('Matchday'));
      await tester.pumpAndSettle();
      expect(find.text('No match right now'), findsOneWidget);
      expect(find.text('QR Pass'), findsNothing);
      expect(find.textContaining('Dispute'), findsNothing);
      expect(find.textContaining('STANDINGS'), findsNothing);

      await tester.tap(find.text('Career'));
      await tester.pumpAndSettle();
      expect(
        find.text('No completed games on record for this player.'),
        findsOneWidget,
      );
      expect(
        find.text('No certificates issued to this player yet.'),
        findsOneWidget,
      );
      expect(find.text('Verified Authentic'), findsNothing);
      expect(find.textContaining('RATING PROGRESSION'), findsNothing);
      expect(find.textContaining('last 30d'), findsNothing);
    });

    testWidgets('a live match shows what the dashboard returned', (
      tester,
    ) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._accountRoutes(
          dashboard: {
            ...emptyDashboard(),
            'liveMatches': [
              {
                'tournamentId': fakeEventId,
                'tournamentName': 'Fake Open Test Event',
                'tournamentStatus': 'in_progress',
                'round': 2,
                'board': 9,
                'color': 'black',
                'opponentName': 'Test Opponent',
                'opponentRating': null,
                'result': 'pending',
                'isBye': false,
                'currentScore': 1,
              },
            ],
          },
        ),
      });
      await _pumpApp(tester, backend, storage: _signedInStorage());
      await tester.tap(find.text('Matchday'));
      await tester.pumpAndSettle();

      expect(find.text('Fake Open Test Event'), findsOneWidget);
      expect(find.text('ROUND 2'), findsOneWidget);
      expect(find.text('#9'), findsOneWidget);
      expect(find.text('BLACK'), findsOneWidget);
      expect(find.text('Opponent: Test Opponent'), findsOneWidget);
      expect(find.text('Result pending'), findsOneWidget);
    });

    testWidgets('a failed dashboard shows an error with retry', (tester) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._accountRoutes(),
        'GET /api/player/dashboard': (_) =>
            jsonResponse({'error': 'Dashboard down for tests'}, 500),
      });
      await _pumpApp(tester, backend, storage: _signedInStorage());
      await tester.tap(find.text('Career'));
      await tester.pumpAndSettle();

      expect(find.text('Could not load this career'), findsOneWidget);
      expect(find.text('Dashboard down for tests'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('certificates download through the API, and failures show', (
      tester,
    ) async {
      final saved = <String>[];
      var healthy = false;
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._accountRoutes(
          dashboard: {
            ...emptyDashboard(),
            'certificates': [
              {
                'id': fakeCertificateId,
                'tournamentName': 'Fake Open Test Event',
                'recipientName': 'Test Player One',
                'type': 'participation',
                'serial': 'TEST/1',
              },
            ],
          },
        ),
        'GET /api/certificates/$fakeCertificateId/download': (_) => healthy
            ? http.Response.bytes(const [0x25, 0x50, 0x44, 0x46], 200)
            : jsonResponse({'error': 'PDF file missing'}, 404),
      });
      await _pumpApp(
        tester,
        backend,
        storage: _signedInStorage(),
        saver: (name, _) async {
          saved.add(name);
          return true;
        },
      );
      await tester.tap(find.text('Career'));
      await tester.pumpAndSettle();
      final download = find.text('Download PDF');
      await tester.ensureVisible(download);
      await tester.pumpAndSettle();

      await tester.tap(download);
      await tester.pumpAndSettle();
      expect(
        find.text('Certificate download failed: PDF file missing'),
        findsOneWidget,
      );
      expect(saved, isEmpty);

      healthy = true;
      await tester.tap(download);
      await tester.pumpAndSettle();
      expect(saved, ['TEST_1.pdf']);
    });
  });

  group('Source', () {
    test('lib/ holds no invented data', () {
      const forbidden = [
        'seed',
        'maybank',
        'cimb',
        'ashwanth',
        'alokas-session',
        'ivborw',
      ];
      final sources = Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))
          .toList();
      expect(sources, isNotEmpty);

      for (final file in sources) {
        final text = file.readAsStringSync().toLowerCase();
        for (final term in forbidden) {
          expect(text, isNot(contains(term)), reason: '$term in ${file.path}');
        }
      }
    });
  });
}
