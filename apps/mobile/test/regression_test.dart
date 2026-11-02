import 'package:chess_alokas_mobile/main.dart';
import 'package:chess_alokas_mobile/models/models.dart';
import 'package:chess_alokas_mobile/services/alokas_api.dart';
import 'package:chess_alokas_mobile/services/preferences.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fixtures/fake_api.dart';

const String _eventsPath = '/api/public/events';
const String _detailPath = '/api/public/events/fake-open';
const String _profilesPath = '/api/player/profiles';

InMemorySessionStorage _signedIn() {
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

Map<String, FakeHandler> _account({
  List<Map<String, dynamic>>? registrations,
  Map<String, dynamic>? dashboard,
}) {
  return {
    'GET $_profilesPath': (_) => jsonResponse({
      'profiles': [fakeProfile()],
    }),
    'GET /api/player/registrations': (_) =>
        jsonResponse({'registrations': registrations ?? const []}),
    'GET /api/player/dashboard': (_) =>
        jsonResponse(dashboard ?? emptyDashboard()),
  };
}

Map<String, FakeHandler> _event(Map<String, dynamic> event) {
  return {
    'GET $_eventsPath': (_) => jsonResponse({
      'events': [event],
    }),
    'GET $_detailPath': (_) => jsonResponse(fakeEventDetail(event)),
  };
}

Future<void> _pump(
  WidgetTester tester,
  FakeBackend backend, {
  InMemorySessionStorage? storage,
  AppPreferences? preferences,
}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ChessAlokasMobileApp(
      apiClient: AlokasApiClient(
        config: fakeConfig,
        httpClient: backend.client,
        sessionStorage: storage ?? InMemorySessionStorage(),
      ),
      preferences: preferences ?? MemoryPreferences(),
      localStore: InMemoryLocalStore(),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _openEvent(WidgetTester tester) async {
  final button = find.byType(ElevatedButton).first;
  await tester.ensureVisible(button);
  await tester.tap(button);
  await tester.pumpAndSettle();
}

Future<void> _startFlow(WidgetTester tester) async {
  final start = find.byKey(const Key('start-register-button'));
  await tester.ensureVisible(start);
  await tester.tap(start);
  await tester.pumpAndSettle();
}

Future<void> _goTo(WidgetTester tester, String tab) async {
  await tester.tap(find.text(tab));
  await tester.pumpAndSettle();
}

String _iso(Duration fromNow) =>
    DateTime.now().toUtc().add(fromNow).toIso8601String();

void main() {
  group('#1 and #2: profile form errors', () {
    Future<void> openForm(WidgetTester tester, FakeBackend backend) async {
      await _pump(tester, backend, storage: _signedIn());
      await _goTo(tester, 'Account');
      await tester.tap(find.byKey(const Key('open-add-profile-button')));
      await tester.pumpAndSettle();
    }

    testWidgets('an API field error appears on that field and takes focus', (
      tester,
    ) async {
      const reason = 'Username may only contain letters and numbers';
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(),
        'POST $_profilesPath': (_) => jsonResponse({
          'error': 'Invalid request',
          'details': {
            '_errors': const [],
            'username': {
              '_errors': const [reason],
            },
          },
        }, 400),
      });
      await openForm(tester, backend);
      await tester.enterText(
        find.byKey(const Key('add-profile-fullname')),
        'Test Player Two',
      );
      await tester.enterText(
        find.byKey(const Key('add-profile-username')),
        'not valid',
      );
      await tester.tap(find.byKey(const Key('save-profile-button')));
      await tester.pumpAndSettle();

      expect(find.text(reason), findsOneWidget);
      expect(find.text('Invalid request'), findsNothing);
      expect(
        find.ancestor(
          of: find.text(reason),
          matching: find.byKey(const Key('add-profile-username')),
        ),
        findsOneWidget,
      );
      final field = tester.widget<TextField>(
        find.byKey(const Key('add-profile-username')),
      );
      expect(field.focusNode!.hasFocus, isTrue);
    });

    testWidgets('an API error for a field not on the form is still shown', (
      tester,
    ) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(),
        'POST $_profilesPath': (_) => jsonResponse({
          'error': 'Invalid request',
          'details': {
            'phone': {
              '_errors': const ['Too long'],
            },
          },
        }, 400),
      });
      await openForm(tester, backend);
      await tester.enterText(
        find.byKey(const Key('add-profile-fullname')),
        'Test Player Two',
      );
      await tester.tap(find.byKey(const Key('save-profile-button')));
      await tester.pumpAndSettle();

      expect(find.text('phone: Too long'), findsOneWidget);
    });

    testWidgets('a local error is in view, focused, and sends nothing', (
      tester,
    ) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(),
      });
      await openForm(tester, backend);
      // Leaves very little room, as an open keyboard does.
      tester.view.physicalSize = const Size(1080, 1100);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('add-profile-fullname')),
        'Test Player Two',
      );
      await tester.enterText(find.byKey(const Key('add-profile-fideid')), '-5');
      await tester.tap(find.byKey(const Key('save-profile-button')));
      await tester.pumpAndSettle();

      final error = find.textContaining('FIDE ID must be a number');
      expect(error, findsOneWidget);
      expect(tester.getRect(error).bottom, lessThan(550));
      final field = tester.widget<TextField>(
        find.byKey(const Key('add-profile-fideid')),
      );
      expect(field.focusNode!.hasFocus, isTrue);
      expect(backend.sent('POST', _profilesPath), isEmpty);
    });
  });

  group('#3: a failed refresh never erases what is known', () {
    testWidgets('events stay with a notice, and recover', (tester) async {
      var healthy = true;
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => healthy
            ? jsonResponse({
                'events': [fakeEvent()],
              })
            : jsonResponse({'error': 'Feed is down for tests'}, 500),
      });
      await _pump(tester, backend);
      expect(find.text('Tournaments (1)'), findsOneWidget);

      healthy = false;
      await _goTo(tester, 'Matchday');
      await _goTo(tester, 'Discover');

      expect(find.text('Fake Open Test Event'), findsOneWidget);
      expect(find.byKey(const Key('stale-notice')), findsOneWidget);
      expect(find.textContaining('Feed is down for tests'), findsOneWidget);
      expect(find.textContaining('Tournaments (0)'), findsNothing);

      healthy = true;
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('stale-notice')), findsNothing);
      expect(find.text('Fake Open Test Event'), findsOneWidget);
    });

    testWidgets('with nothing known, there is no zero count', (tester) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) =>
            jsonResponse({'error': 'Feed is down for tests'}, 500),
        'GET $_profilesPath': (_) =>
            jsonResponse({'error': 'Profiles are down for tests'}, 500),
        'GET /api/player/registrations': (_) => jsonResponse({}, 500),
      });
      await _pump(tester, backend, storage: _signedIn());

      expect(find.text('Could not load events'), findsOneWidget);
      expect(find.text('Tournaments'), findsOneWidget);
      expect(find.textContaining('Tournaments (0)'), findsNothing);

      await _goTo(tester, 'Account');
      expect(find.text('Could not load profiles'), findsOneWidget);
      expect(find.textContaining('PROFILES (0)'), findsNothing);
    });

    testWidgets('a matchday board stays with a notice', (tester) async {
      var healthy = true;
      final dashboard = {
        ...emptyDashboard(),
        'liveMatches': [
          {
            'tournamentName': 'Fake Live Event',
            'round': 2,
            'board': 7,
            'color': 'white',
            'opponentName': 'Fake Opponent',
            'result': 'pending',
          },
        ],
      };
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(),
        'GET /api/player/dashboard': (_) => healthy
            ? jsonResponse(dashboard)
            : jsonResponse({'error': 'Dashboard is down for tests'}, 500),
      });
      await _pump(tester, backend, storage: _signedIn());
      await _goTo(tester, 'Matchday');
      expect(find.text('7'), findsOneWidget);

      healthy = false;
      await _goTo(tester, 'Career');
      await _goTo(tester, 'Matchday');

      expect(find.text('7'), findsOneWidget);
      expect(find.byKey(const Key('stale-notice')), findsOneWidget);
      expect(find.text('Could not load your matches'), findsNothing);
    });

    testWidgets('Retry reloads the profiles after a failed start', (
      tester,
    ) async {
      var healthy = false;
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(),
        'GET $_profilesPath': (_) => healthy
            ? jsonResponse({
                'profiles': [fakeProfile()],
              })
            : jsonResponse({'error': 'Profiles are down for tests'}, 500),
      });
      await _pump(tester, backend, storage: _signedIn());
      await _goTo(tester, 'Matchday');
      expect(find.text('Could not load your matches'), findsOneWidget);

      healthy = true;
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();

      expect(find.text('Could not load your matches'), findsNothing);
      expect(find.text('No match right now'), findsOneWidget);
    });

    testWidgets('a matchday board never loaded shows the error', (
      tester,
    ) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(),
        'GET /api/player/dashboard': (_) =>
            jsonResponse({'error': 'Dashboard is down for tests'}, 500),
      });
      await _pump(tester, backend, storage: _signedIn());
      await _goTo(tester, 'Matchday');

      expect(find.text('Could not load your matches'), findsOneWidget);
      expect(find.byKey(const Key('stale-notice')), findsNothing);
    });
  });

  group('#5: expired and closed events', () {
    test('deadlines and dates read naturally', () {
      expect(
        formatDateTimeForPeople(DateTime(2026, 10, 31, 14, 5)),
        '31 Oct 2026, 2:05 PM',
      );
      expect(
        formatDateTimeForPeople(DateTime(2026, 1, 2, 0, 30)),
        '2 Jan 2026, 12:30 AM',
      );
      expect(formatDateForPeople('2026-11-15'), '15 Nov 2026');
      expect(formatDateForPeople('not a date'), 'not a date');
      expect(formatDateForPeople(null), isNull);
    });

    testWidgets('a passed deadline offers no way to register', (tester) async {
      final event = fakeEvent(
        entryFeeCents: 5000,
        overrides: {'registrationDeadline': _iso(const Duration(days: -1))},
      );
      final backend = FakeBackend({..._event(event), ..._account()});
      await _pump(tester, backend, storage: _signedIn());

      expect(find.text('View & Register'), findsNothing);
      expect(find.text('View details'), findsOneWidget);
      expect(find.text('Registration closed'), findsOneWidget);

      await _openEvent(tester);

      expect(find.text('Registration closed'), findsOneWidget);
      expect(find.byKey(const Key('start-register-button')), findsNothing);
      expect(find.byKey(const Key('confirm-register-button')), findsNothing);
      expect(find.byKey(const Key('choose-receipt-button')), findsNothing);
      expect(find.textContaining('PAYMENT:'), findsNothing);
      expect(find.textContaining('T00:'), findsNothing);
      expect(find.textContaining(RegExp(r'\d{4}-\d{2}-\d{2}T')), findsNothing);
    });

    testWidgets('a closed event offers no way to register', (tester) async {
      final backend = FakeBackend({
        ..._event(fakeEvent(overrides: {'registrationOpen': false})),
        ..._account(),
      });
      await _pump(tester, backend, storage: _signedIn());
      await _openEvent(tester);

      expect(find.text('Registration closed'), findsWidgets);
      expect(find.byKey(const Key('confirm-register-button')), findsNothing);
    });

    testWidgets('a future deadline can still register', (tester) async {
      final backend = FakeBackend({
        ..._event(
          fakeEvent(
            overrides: {'registrationDeadline': _iso(const Duration(days: 2))},
          ),
        ),
        ..._account(),
      });
      await _pump(tester, backend, storage: _signedIn());

      expect(find.textContaining('2 days left'), findsOneWidget);
      await _openEvent(tester);
      await _startFlow(tester);
      expect(find.byKey(const Key('confirm-register-button')), findsOneWidget);
    });
  });

  group('#6: full events', () {
    Map<String, dynamic> event(int count) =>
        fakeEvent(overrides: {'registeredCount': count, 'maxParticipants': 2});

    testWidgets('warns before Confirm that the player will be waitlisted', (
      tester,
    ) async {
      final backend = FakeBackend({..._event(event(2)), ..._account()});
      await _pump(tester, backend, storage: _signedIn());
      expect(find.text('View & Join Waitlist'), findsOneWidget);

      await _openEvent(tester);
      await _startFlow(tester);

      final warning = find.byKey(const Key('event-full-warning'));
      expect(warning, findsOneWidget);
      expect(
        tester.widget<Text>(warning).data,
        contains('Test Player One will be waitlisted'),
      );
      expect(find.textContaining('Join waitlist (1 player)'), findsOneWidget);
      expect(
        tester.getTopLeft(warning).dy,
        lessThan(
          tester
              .getTopLeft(find.byKey(const Key('confirm-register-button')))
              .dy,
        ),
      );
    });

    testWidgets('an event with places left has no warning', (tester) async {
      final backend = FakeBackend({..._event(event(1)), ..._account()});
      await _pump(tester, backend, storage: _signedIn());
      await _openEvent(tester);
      await _startFlow(tester);

      expect(find.byKey(const Key('event-full-warning')), findsNothing);
      expect(
        find.textContaining('Send registration (1 player)'),
        findsOneWidget,
      );
    });
  });

  group('#7 and #8', () {
    testWidgets('returning to a tab reloads it', (tester) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(),
      });
      await _pump(tester, backend, storage: _signedIn());
      final before = backend.sent('GET', _eventsPath).length;

      await _goTo(tester, 'Account');
      await _goTo(tester, 'Discover');

      expect(backend.sent('GET', _eventsPath).length, before + 1);
    });

    testWidgets('new events appear after pull to refresh', (tester) async {
      var events = <Map<String, dynamic>>[];
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': events}),
      });
      await _pump(tester, backend);
      expect(find.text('No events yet'), findsOneWidget);

      events = [fakeEvent()];
      await tester.fling(find.byType(ListView), const Offset(0, 600), 1000);
      await tester.pumpAndSettle();

      expect(find.text('Fake Open Test Event'), findsOneWidget);
    });

    testWidgets('delete warns about active registrations', (tester) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(
          registrations: [
            fakeRegistration(),
            {...fakeRegistration(), 'tournamentId': 'another-event'},
          ],
        ),
      });
      await _pump(tester, backend, storage: _signedIn());
      await _goTo(tester, 'Account');
      await tester.tap(find.byKey(const Key('delete-$fakeProfileId')));
      await tester.pumpAndSettle();

      expect(
        tester
            .widget<Text>(find.byKey(const Key('delete-profile-message')))
            .data,
        contains('has 2 active registrations'),
      );
    });

    testWidgets('registrations read Pending in full, and games are counted', (
      tester,
    ) async {
      final backend = FakeBackend({
        ..._event(fakeEvent()),
        ..._account(
          registrations: [fakeRegistration()],
          dashboard: {
            ...emptyDashboard(),
            'stats': const {
              'tournamentsCount': 1,
              'gamesPlayed': 1,
              'wins': 1,
              'draws': 0,
              'losses': 0,
              'totalPoints': 1,
            },
          },
        ),
      });
      await _pump(tester, backend, storage: _signedIn());
      expect(find.text('Pending: Test Player One'), findsOneWidget);
      expect(find.textContaining('Registered: '), findsNothing);

      await _goTo(tester, 'Career');
      expect(find.text('100% Win Rate (1 Game)'), findsOneWidget);
    });

    testWidgets('Career has no overflow at font scale 1.3', (tester) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(),
      });
      tester.platformDispatcher.textScaleFactorTestValue = 1.3;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await _pump(tester, backend, storage: _signedIn());
      await _goTo(tester, 'Career');

      expect(tester.takeException(), isNull);
      expect(find.text('Ratings'), findsOneWidget);
    });
  });
}
