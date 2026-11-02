import 'dart:convert';
import 'dart:io';

import 'package:chess_alokas_mobile/main.dart';
import 'package:chess_alokas_mobile/models/draft.dart';
import 'package:chess_alokas_mobile/models/models.dart';
import 'package:chess_alokas_mobile/services/alokas_api.dart';
import 'package:chess_alokas_mobile/services/device_location.dart';
import 'package:chess_alokas_mobile/services/preferences.dart';
import 'package:chess_alokas_mobile/widgets/venue_actions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fixtures/fake_api.dart';

const String _events = 'GET /api/public/events';
const String _token = 'POST /auth/v1/token';

/// Routes a signed-in account needs on startup.
Map<String, FakeHandler> _account({List<Map<String, dynamic>>? profiles}) => {
  'GET /api/player/profiles': (_) => jsonResponse({
    'profiles': profiles ?? [fakeProfile()],
  }),
  'GET /api/player/registrations': (_) =>
      jsonResponse({'registrations': const []}),
  'GET /api/player/dashboard': (_) => jsonResponse(emptyDashboard()),
};

Map<String, FakeHandler> _noEvents() => {
  _events: (_) => jsonResponse({'events': const []}),
};

InMemorySessionStorage _signedIn({
  Duration expiresIn = const Duration(hours: 1),
}) => InMemorySessionStorage(
  AuthSession(
    accessToken: 'fake-access-token',
    refreshToken: 'fake-refresh-token',
    expiresAt: DateTime.now().add(expiresIn),
    userId: fakeUserId,
    email: 'player@example.test',
  ).encode(),
);

class _Launch {
  final MemoryPreferences prefs;
  final InMemorySessionStorage storage;
  final InMemoryLocalStore store;
  final List<String> emailAppOpens;

  _Launch(this.prefs, this.storage, this.store, this.emailAppOpens);
}

Future<_Launch> _pump(
  WidgetTester tester,
  FakeBackend backend, {
  MemoryPreferences? prefs,
  InMemorySessionStorage? storage,
  InMemoryLocalStore? store,
  Size size = const Size(1080, 2400),
  double textScale = 1,
  bool emailApp = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 2.0;
  tester.platformDispatcher.textScaleFactorTestValue = textScale;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
  final launch = _Launch(
    prefs ?? MemoryPreferences(),
    storage ?? InMemorySessionStorage(),
    store ?? InMemoryLocalStore(),
    [],
  );
  await tester.pumpWidget(
    ChessAlokasMobileApp(
      key: UniqueKey(),
      apiClient: AlokasApiClient(
        config: fakeConfig,
        httpClient: backend.client,
        sessionStorage: launch.storage,
      ),
      preferences: launch.prefs,
      localStore: launch.store,
      locateDevice: ({bool prompt = true}) async =>
          const DeviceLocationProblem('Not used in this test.'),
      namePlace: (_, _) async => null,
      receiptPicker: () async => null,
      certificateSaver: (_, _) async => true,
      openEmailApp: emailApp
          ? () async {
              launch.emailAppOpens.add('opened');
              return true;
            }
          : null,
    ),
  );
  await tester.pumpAndSettle();
  return launch;
}

MemoryPreferences _firstLaunch() => MemoryPreferences()..entry = null;

Future<void> _tap(WidgetTester tester, String key) async {
  final target = find.byKey(Key(key));
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

Future<void> _type(WidgetTester tester, String key, String text) async {
  await tester.enterText(find.byKey(Key(key)), text);
  await tester.pump();
}

Future<void> _signInWith(
  WidgetTester tester, {
  String password = 'right-password',
}) async {
  await _type(tester, 'sign-in-email', 'player@example.test');
  await _type(tester, 'sign-in-password', password);
  await _tap(tester, 'sign-in-submit');
}

void main() {
  group('First launch', () {
    testWidgets('shows the welcome screen, full screen, with three ways in', (
      tester,
    ) async {
      await _pump(tester, FakeBackend(_noEvents()), prefs: _firstLaunch());

      expect(find.byKey(const Key('welcome-screen')), findsOneWidget);
      expect(find.text('Chess Alokas'), findsOneWidget);
      expect(find.text('Your chess life, in one app.'), findsOneWidget);
      expect(find.byKey(const Key('welcome-sign-in')), findsOneWidget);
      expect(find.byKey(const Key('welcome-create-account')), findsOneWidget);
      expect(find.byKey(const Key('welcome-browse')), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);
      expect(find.byKey(const Key('brand-crown')), findsOneWidget);
    });

    testWidgets('browse is the least prominent of the three', (tester) async {
      await _pump(tester, FakeBackend(_noEvents()), prefs: _firstLaunch());
      final signIn = tester.getSize(find.byKey(const Key('welcome-sign-in')));
      final create = tester.getSize(
        find.byKey(const Key('welcome-create-account')),
      );
      final browse = tester.getSize(find.byKey(const Key('welcome-browse')));
      expect(browse.height, lessThan(signIn.height));
      expect(browse.height, lessThan(create.height));
      expect(find.byType(TextButton), findsWidgets);
      expect(
        tester.widget(find.byKey(const Key('welcome-browse'))),
        isA<TextButton>(),
      );
    });

    testWidgets(
      'choosing to browse is remembered: next launch opens Discover',
      (tester) async {
        final prefs = _firstLaunch();
        await _pump(tester, FakeBackend(_noEvents()), prefs: prefs);
        await _tap(tester, 'welcome-browse');

        expect(find.byKey(const Key('welcome-screen')), findsNothing);
        expect(find.byType(NavigationBar), findsOneWidget);
        expect(find.byKey(const Key('appbar-sign-in')), findsOneWidget);
        expect(prefs.entry, EntryChoice.guest);

        await _pump(tester, FakeBackend(_noEvents()), prefs: prefs);
        expect(find.byKey(const Key('welcome-screen')), findsNothing);
        expect(find.text('Discover'), findsOneWidget);
      },
    );

    testWidgets('signing in from welcome opens the app and is remembered', (
      tester,
    ) async {
      final backend = FakeBackend({
        ..._noEvents(),
        ..._account(),
        _token: (_) => jsonResponse(tokenResponse()),
      });
      final prefs = _firstLaunch();
      final launch = await _pump(tester, backend, prefs: prefs);
      await _tap(tester, 'welcome-sign-in');
      expect(find.text('Welcome back'), findsOneWidget);
      await _signInWith(tester);

      expect(find.byKey(const Key('welcome-screen')), findsNothing);
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(find.byKey(const Key('appbar-sign-in')), findsNothing);
      expect(prefs.entry, EntryChoice.member);
      expect(launch.storage.value, isNotNull);

      // Next launch goes straight in.
      await _pump(tester, backend, prefs: prefs, storage: launch.storage);
      expect(find.byKey(const Key('welcome-screen')), findsNothing);
      expect(find.byType(NavigationBar), findsOneWidget);
    });

    testWidgets('the back arrow on sign-in returns to welcome', (tester) async {
      await _pump(tester, FakeBackend(_noEvents()), prefs: _firstLaunch());
      await _tap(tester, 'welcome-create-account');
      expect(find.text('Create your account'), findsOneWidget);
      await _tap(tester, 'auth-back');
      expect(find.byKey(const Key('welcome-screen')), findsOneWidget);
    });
  });

  group('Sign in', () {
    Future<FakeBackend> open(
      WidgetTester tester,
      Map<String, FakeHandler> routes,
    ) async {
      final backend = FakeBackend({..._noEvents(), ...routes});
      await _pump(tester, backend, prefs: _firstLaunch());
      await _tap(tester, 'welcome-sign-in');
      return backend;
    }

    testWidgets('fields have the right keyboards and autofill', (tester) async {
      await open(tester, const {});
      final email = tester.widget<TextField>(
        find.byKey(const Key('sign-in-email')),
      );
      final password = tester.widget<TextField>(
        find.byKey(const Key('sign-in-password')),
      );
      expect(email.keyboardType, TextInputType.emailAddress);
      expect(email.autofillHints, [AutofillHints.email]);
      expect(email.textInputAction, TextInputAction.next);
      expect(password.obscureText, isTrue);
      expect(password.autofillHints, [AutofillHints.password]);
      expect(password.textInputAction, TextInputAction.done);
    });

    testWidgets('show and hide the password', (tester) async {
      await open(tester, const {});
      await _tap(tester, 'toggle-password');
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('sign-in-password')))
            .obscureText,
        isFalse,
      );
      expect(find.byTooltip('Hide password'), findsOneWidget);
      await _tap(tester, 'toggle-password');
      expect(find.byTooltip('Show password'), findsOneWidget);
    });

    testWidgets('empty fields are pointed out on the field, nothing is sent', (
      tester,
    ) async {
      final backend = await open(tester, const {});
      await _tap(tester, 'sign-in-submit');
      expect(find.text('Enter your email.'), findsOneWidget);
      expect(find.text('Enter your password.'), findsOneWidget);
      expect(backend.sent('POST', '/auth/v1/token'), isEmpty);
    });

    testWidgets('Enter on the password field submits', (tester) async {
      final backend = await open(tester, {
        _token: (_) => jsonResponse({
          'error_code': 'invalid_credentials',
          'msg': 'Invalid login credentials',
        }, 400),
      });
      await _type(tester, 'sign-in-email', 'player@example.test');
      await tester.tap(find.byKey(const Key('sign-in-password')));
      await _type(tester, 'sign-in-password', 'wrong');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();

      expect(backend.sent('POST', '/auth/v1/token'), hasLength(1));
      expect(
        find.text('That email and password do not match.'),
        findsOneWidget,
      );
      expect(find.text('Welcome back'), findsOneWidget);
    });

    testWidgets('an unconfirmed email offers to resend the link', (
      tester,
    ) async {
      final backend = await open(tester, {
        _token: (_) => jsonResponse({
          'error_code': 'email_not_confirmed',
          'msg': 'Email not confirmed',
        }, 400),
        'POST /auth/v1/resend': (_) => jsonResponse(const {}),
      });
      await _signInWith(tester);
      expect(find.text(emailNotConfirmedMessage), findsOneWidget);
      await _tap(tester, 'resend-confirmation');
      expect(backend.sent('POST', '/auth/v1/resend'), hasLength(1));
      expect(find.byKey(const Key('sign-in-notice')), findsOneWidget);
    });

    testWidgets('no signal says so and stays on the page', (tester) async {
      await open(tester, {
        _token: (_) => throw const SocketException('offline for tests'),
      });
      await _signInWith(tester);
      expect(find.text(offlineMessage), findsOneWidget);
      expect(find.text('Welcome back'), findsOneWidget);
    });

    testWidgets('forgot password sends a link and goes back to sign in', (
      tester,
    ) async {
      final backend = await open(tester, {
        'POST /auth/v1/recover': (_) => jsonResponse(const {}),
      });
      await _type(tester, 'sign-in-email', 'who@example.test');
      await _tap(tester, 'open-reset');
      expect(find.text('Reset your password'), findsOneWidget);
      await _tap(tester, 'reset-submit');
      expect(find.byKey(const Key('reset-sent-message')), findsOneWidget);
      expect(jsonDecode(backend.sent('POST', '/auth/v1/recover').single.body), {
        'email': 'who@example.test',
      });
      await _tap(tester, 'back-to-sign-in');
      expect(find.text('Welcome back'), findsOneWidget);
    });
  });

  group('Create account', () {
    testWidgets('confirmation on: a check-email screen with the address', (
      tester,
    ) async {
      final backend = FakeBackend({
        ..._noEvents(),
        'POST /auth/v1/signup': (_) => jsonResponse({
          'id': fakeUserId,
          'email': 'new@example.test',
          'identities': [
            {'id': 'x'},
          ],
        }),
        'POST /auth/v1/resend': (_) => jsonResponse(const {}),
      });
      final launch = await _pump(tester, backend, prefs: _firstLaunch());
      await _tap(tester, 'welcome-create-account');
      expect(find.byKey(const Key('signup-agreement')), findsOneWidget);
      final password = tester.widget<TextField>(
        find.byKey(const Key('sign-in-password')),
      );
      expect(password.autofillHints, [AutofillHints.newPassword]);

      await _type(tester, 'sign-in-email', 'new@example.test');
      await _type(tester, 'sign-in-password', 'long-enough-1');
      await _tap(tester, 'sign-up-submit');

      expect(find.text('Check your email'), findsOneWidget);
      expect(find.text('new@example.test'), findsOneWidget);
      expect(launch.storage.value, isNull);

      await _tap(tester, 'resend-confirmation');
      expect(backend.sent('POST', '/auth/v1/resend'), hasLength(1));
      expect(find.text('Sent again to new@example.test.'), findsOneWidget);

      await _tap(tester, 'open-email-app');
      expect(launch.emailAppOpens, hasLength(1));

      await _tap(tester, 'confirmed-sign-in');
      expect(find.text('Welcome back'), findsOneWidget);
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('sign-in-email')))
            .controller!
            .text,
        'new@example.test',
      );
    });

    testWidgets('without an email app, the sign-in button leads', (
      tester,
    ) async {
      await _pump(
        tester,
        FakeBackend({
          ..._noEvents(),
          'POST /auth/v1/signup': (_) =>
              jsonResponse({'id': fakeUserId, 'email': 'new@example.test'}),
        }),
        prefs: _firstLaunch(),
        emailApp: false,
      );
      await _tap(tester, 'welcome-create-account');
      await _type(tester, 'sign-in-email', 'new@example.test');
      await _type(tester, 'sign-in-password', 'long-enough-1');
      await _tap(tester, 'sign-up-submit');
      expect(find.byKey(const Key('open-email-app')), findsNothing);
      expect(
        tester.widget(find.byKey(const Key('confirmed-sign-in'))),
        isA<ElevatedButton>(),
      );
    });

    testWidgets('an email already in use says so and offers sign in', (
      tester,
    ) async {
      await _pump(
        tester,
        FakeBackend({
          ..._noEvents(),
          'POST /auth/v1/signup': (_) => jsonResponse({
            'id': fakeUserId,
            'email': 'player@example.test',
            'identities': const [],
          }),
        }),
        prefs: _firstLaunch(),
      );
      await _tap(tester, 'welcome-create-account');
      await _type(tester, 'sign-in-email', 'player@example.test');
      await _type(tester, 'sign-in-password', 'long-enough-1');
      await _tap(tester, 'sign-up-submit');

      expect(find.text(accountExistsMessage), findsOneWidget);
      await _tap(tester, 'use-sign-in');
      expect(find.text('Welcome back'), findsOneWidget);
    });

    testWidgets('a bad email and short password are caught on the phone', (
      tester,
    ) async {
      final backend = FakeBackend(_noEvents());
      await _pump(tester, backend, prefs: _firstLaunch());
      await _tap(tester, 'welcome-create-account');
      await _type(tester, 'sign-in-email', 'not-an-email');
      await _type(tester, 'sign-in-password', 'short');
      await _tap(tester, 'sign-up-submit');
      expect(find.text('Enter a valid email address.'), findsOneWidget);
      expect(find.text('Use at least 8 characters.'), findsOneWidget);
      expect(backend.sent('POST', '/auth/v1/signup'), isEmpty);
    });
  });

  group('Guests', () {
    testWidgets('Matchday, Career and Account show one locked state each', (
      tester,
    ) async {
      final backend = FakeBackend(_noEvents());
      await _pump(tester, backend);
      for (final (tab, title) in const [
        ('Matchday', 'Follow your games'),
        ('Career', 'Your chess record'),
        ('Account', 'Your account'),
      ]) {
        await tester.tap(find.text(tab));
        await tester.pumpAndSettle();
        expect(find.text(title), findsOneWidget, reason: tab);
        expect(find.byKey(const Key('locked-sign-in')), findsOneWidget);
        expect(find.byKey(const Key('locked-create-account')), findsOneWidget);
        expect(find.byKey(const Key('sign-in-email')), findsNothing);
      }
      // Sunlight works for guests too.
      expect(find.byKey(const Key('theme-sun')), findsOneWidget);
      expect(backend.sent('GET', '/api/player/dashboard'), isEmpty);
      expect(backend.sent('GET', '/api/player/profiles'), isEmpty);
    });

    testWidgets('signing in from a locked tab comes back to that tab', (
      tester,
    ) async {
      final backend = FakeBackend({
        ..._noEvents(),
        ..._account(),
        _token: (_) => jsonResponse(tokenResponse()),
      });
      await _pump(tester, backend);
      await tester.tap(find.text('Career'));
      await tester.pumpAndSettle();
      await _tap(tester, 'locked-sign-in');
      await _signInWith(tester);

      expect(find.byKey(const Key('locked-tab')), findsNothing);
      final bar = tester.widget<NavigationBar>(find.byType(NavigationBar));
      expect(bar.selectedIndex, 2);
      expect(find.text('Test Player One'), findsWidgets);
    });

    testWidgets('create account from a locked tab opens the sign-up page', (
      tester,
    ) async {
      await _pump(tester, FakeBackend(_noEvents()));
      await tester.tap(find.text('Matchday'));
      await tester.pumpAndSettle();
      await _tap(tester, 'locked-create-account');
      expect(find.text('Create your account'), findsOneWidget);
    });

    testWidgets(
      'registering as a guest signs in, then opens registration with the draft',
      (tester) async {
        final event = fakeEvent(entryFeeCents: 5000);
        final store = InMemoryLocalStore();
        // Started on this phone before the sign-in ran out.
        final draft = RegistrationDraft(
          accountKey: fakeUserId,
          eventId: fakeEventId,
          slugOrId: 'fake-open',
          eventName: 'Fake Open Test Event',
          step: 1,
          selectedProfileIds: const [fakeProfileId],
          categoryByProfile: const {fakeProfileId: fakeCategoryOpenId},
          detailJson: fakeEventDetail(event),
          updatedAt: DateTime.now(),
        );
        store.texts['draft_${fakeUserId}_$fakeEventId.json'] = jsonEncode(
          draft.toJson(),
        );
        final backend = FakeBackend({
          _events: (_) => jsonResponse({
            'events': [event],
          }),
          'GET /api/public/events/fake-open': (_) =>
              jsonResponse(fakeEventDetail(event)),
          ..._account(),
          _token: (_) => jsonResponse(tokenResponse()),
        });
        await _pump(tester, backend, store: store);
        final open = find.text('View & Register').first;
        await tester.ensureVisible(open);
        await tester.tap(open);
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('register-needs-account')), findsOneWidget);
        await _tap(tester, 'start-register-button');
        await _signInWith(tester);

        expect(find.byKey(const Key('step-title')), findsOneWidget);
        expect(find.text('Pay the entry fee'), findsOneWidget);
        expect(
          backend.sent('POST', '/api/public/events/fake-open/register'),
          isEmpty,
        );
      },
    );

    testWidgets(
      'a guest with no players lands back on the event, asked to add one',
      (tester) async {
        final event = fakeEvent();
        final backend = FakeBackend({
          _events: (_) => jsonResponse({
            'events': [event],
          }),
          'GET /api/public/events/fake-open': (_) =>
              jsonResponse(fakeEventDetail(event)),
          ..._account(profiles: const []),
          _token: (_) => jsonResponse(tokenResponse()),
        });
        await _pump(tester, backend);
        final open = find.text('View & Register').first;
        await tester.ensureVisible(open);
        await tester.tap(open);
        await tester.pumpAndSettle();
        await _tap(tester, 'start-register-button');
        await _signInWith(tester);

        expect(find.text('Event'), findsOneWidget);
        expect(find.text('Add a player profile first'), findsOneWidget);
      },
    );
  });

  group('Signed in', () {
    testWidgets('Account is a proper account page with no sign-in form', (
      tester,
    ) async {
      await _pump(
        tester,
        FakeBackend({..._noEvents(), ..._account()}),
        storage: _signedIn(),
      );
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('account-header')), findsOneWidget);
      expect(find.text('player@example.test'), findsOneWidget);
      expect(find.text('Test Player One'), findsWidgets);
      expect(find.byKey(const Key('theme-sun')), findsOneWidget);
      expect(find.byKey(const Key('sign-out-button')), findsOneWidget);
      expect(find.byKey(const Key('open-delete-account')), findsOneWidget);
      expect(find.byKey(const Key('sign-in-email')), findsNothing);
      expect(find.byKey(const Key('appbar-sign-in')), findsNothing);
    });

    testWidgets('signing out returns to the welcome screen', (tester) async {
      final prefs = MemoryPreferences()..entry = EntryChoice.member;
      final launch = await _pump(
        tester,
        FakeBackend({..._noEvents(), ..._account()}),
        storage: _signedIn(),
        prefs: prefs,
      );
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      await _tap(tester, 'sign-out-button');

      expect(find.byKey(const Key('welcome-screen')), findsOneWidget);
      expect(find.byKey(const Key('session-ended')), findsNothing);
      expect(launch.storage.value, isNull);
      expect(prefs.entry, isNull);
    });

    testWidgets('offline at launch still opens the app with saved data', (
      tester,
    ) async {
      final store = InMemoryLocalStore();
      // A first run online saves the account's copy.
      await _pump(
        tester,
        FakeBackend({..._noEvents(), ..._account()}),
        storage: _signedIn(),
        store: store,
      );
      final offlineClient = FakeBackend({
        for (final route in const [
          _events,
          _token,
          'GET /api/player/profiles',
          'GET /api/player/registrations',
          'GET /api/player/dashboard',
        ])
          route: (_) => throw const SocketException('offline for tests'),
      });
      await _pump(
        tester,
        offlineClient,
        storage: _signedIn(expiresIn: const Duration(minutes: -5)),
        store: store,
        prefs: MemoryPreferences()..entry = EntryChoice.member,
      );

      expect(find.byKey(const Key('welcome-screen')), findsNothing);
      expect(find.byKey(const Key('session-ended')), findsNothing);
      expect(find.byKey(const Key('appbar-sign-in')), findsNothing);
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      expect(find.text('Test Player One'), findsWidgets);
    });
  });

  group('Session ends', () {
    testWidgets('one calm prompt, no errors on the pages', (tester) async {
      var rejected = false;
      final backend = FakeBackend({
        ..._noEvents(),
        ..._account(),
        'GET /api/player/dashboard': (_) => rejected
            ? jsonResponse({'error': 'Unauthorized'}, 401)
            : jsonResponse(emptyDashboard()),
        _token: (_) => jsonResponse({'error': 'invalid_grant'}, 400),
      });
      await _pump(
        tester,
        backend,
        storage: _signedIn(),
        prefs: MemoryPreferences()..entry = EntryChoice.member,
      );
      rejected = true;
      await tester.tap(find.text('Matchday'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('session-ended')), findsOneWidget);
      expect(find.text('Please sign in again'), findsOneWidget);
      expect(find.textContaining('expired'), findsNothing);
      expect(find.textContaining('Could not load'), findsNothing);

      await _tap(tester, 'session-not-now');
      expect(find.byKey(const Key('session-ended')), findsNothing);
      expect(find.text('Follow your games'), findsOneWidget);
      expect(find.byKey(const Key('appbar-sign-in')), findsOneWidget);

      // Other tabs show their locked state, not another prompt.
      await tester.tap(find.text('Career'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('session-ended')), findsNothing);
      expect(find.text('Your chess record'), findsOneWidget);
    });

    testWidgets('sign in again from the prompt, with the email filled in', (
      tester,
    ) async {
      var rejectRefresh = true;
      final backend = FakeBackend({
        ..._noEvents(),
        ..._account(),
        _token: (request) =>
            request.url.queryParameters['grant_type'] == 'refresh_token' &&
                rejectRefresh
            ? jsonResponse({'error': 'invalid_grant'}, 400)
            : jsonResponse(tokenResponse()),
      });
      // Expired before launch, and the refresh is refused.
      await _pump(
        tester,
        backend,
        storage: _signedIn(expiresIn: const Duration(minutes: -5)),
        prefs: MemoryPreferences()..entry = EntryChoice.member,
      );
      expect(find.byKey(const Key('welcome-screen')), findsNothing);
      expect(find.byKey(const Key('session-ended')), findsOneWidget);
      rejectRefresh = false;
      await _tap(tester, 'session-sign-in');
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('sign-in-email')))
            .controller!
            .text,
        'player@example.test',
      );
      await _type(tester, 'sign-in-password', 'right-password');
      await _tap(tester, 'sign-in-submit');
      expect(find.byKey(const Key('appbar-sign-in')), findsNothing);
      expect(find.byType(NavigationBar), findsOneWidget);
    });
  });

  group('Venue', () {
    testWidgets('copy address and directions on the event page', (
      tester,
    ) async {
      final copied = <String>[];
      final opened = <Uri>[];
      final previousCopier = VenueActions.copier;
      final previousOpener = VenueActions.opener;
      VenueActions.copier = (text) async => copied.add(text);
      VenueActions.opener = (uri) async {
        opened.add(uri);
        return true;
      };
      addTearDown(() {
        VenueActions.copier = previousCopier;
        VenueActions.opener = previousOpener;
      });
      final event = fakeEvent(
        overrides: {'venueAddress': '12 Test Road, Testville'},
      );
      await _pump(
        tester,
        FakeBackend({
          _events: (_) => jsonResponse({
            'events': [event],
          }),
          'GET /api/public/events/fake-open': (_) =>
              jsonResponse(fakeEventDetail(event)),
        }),
      );
      final open = find.text('View & Register').first;
      await tester.ensureVisible(open);
      await tester.tap(open);
      await tester.pumpAndSettle();

      await _tap(tester, 'copy-address-$fakeEventId');
      expect(copied, ['Test Hall, 12 Test Road, Testville']);
      expect(find.text('Address copied'), findsOneWidget);

      await _tap(tester, 'directions-$fakeEventId');
      expect(opened.single.scheme, 'geo');
      expect(opened.single.toString(), startsWith('geo:3.2,101.7?q=3.2,101.7'));
    });

    test('directions fall back to the address, then to the web', () {
      const noPin = MobileEventItem(
        id: 'e',
        venueName: 'Test Hall',
        city: 'Testville',
      );
      final uris = directionsUrisFor(noPin);
      expect(uris.first.toString(), 'geo:0,0?q=Test%20Hall%2C%20Testville');
      expect(uris.last.host, 'www.google.com');
      expect(venueAddressFor(noPin), 'Test Hall, Testville');
    });

    testWidgets('an event with no address or pin shows neither action', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: VenueActions(event: MobileEventItem(id: 'e')),
          ),
        ),
      );
      expect(find.text('Copy address'), findsNothing);
      expect(find.text('Directions'), findsNothing);
      expect(directionsUrisFor(const MobileEventItem(id: 'e')), isEmpty);
    });
  });

  group('Small phones and large text', () {
    for (final (name, scale) in const [
      ('normal text', 1.0),
      ('large text', 2.0),
    ]) {
      testWidgets(
        'welcome, sign-in, sign-up and locked tabs fit at 360 wide, $name',
        (tester) async {
          final backend = FakeBackend({
            ..._noEvents(),
            'POST /auth/v1/signup': (_) =>
                jsonResponse({'id': fakeUserId, 'email': 'new@example.test'}),
          });
          await _pump(
            tester,
            backend,
            prefs: _firstLaunch(),
            size: const Size(720, 1280),
            textScale: scale,
          );
          expect(tester.takeException(), isNull);
          await _tap(tester, 'welcome-create-account');
          expect(tester.takeException(), isNull);
          await _type(tester, 'sign-in-email', 'new@example.test');
          await _type(tester, 'sign-in-password', 'long-enough-1');
          await _tap(tester, 'sign-up-submit');
          expect(find.text('Check your email'), findsOneWidget);
          expect(tester.takeException(), isNull);
          await _tap(tester, 'confirmed-sign-in');
          await _tap(tester, 'auth-back');
          await _tap(tester, 'welcome-browse');
          for (final tab in const ['Matchday', 'Career', 'Account']) {
            await tester.tap(find.text(tab));
            await tester.pumpAndSettle();
            expect(tester.takeException(), isNull, reason: tab);
          }
        },
      );
    }

    testWidgets('every button on the auth pages is at least 44 px', (
      tester,
    ) async {
      await _pump(
        tester,
        FakeBackend(_noEvents()),
        prefs: _firstLaunch(),
        size: const Size(720, 1280),
      );
      void check(String where) {
        for (final type in const [
          ElevatedButton,
          OutlinedButton,
          TextButton,
          IconButton,
        ]) {
          for (final element in find.byType(type).evaluate()) {
            final size = (element.renderObject! as RenderBox).size;
            expect(
              size.height,
              greaterThanOrEqualTo(44),
              reason: '$where $type',
            );
            expect(
              size.width,
              greaterThanOrEqualTo(44),
              reason: '$where $type',
            );
          }
        }
      }

      check('welcome');
      await _tap(tester, 'welcome-sign-in');
      check('sign in');
      await _tap(tester, 'open-sign-up');
      check('sign up');
    });
  });
}
