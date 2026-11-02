import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:chess_alokas_mobile/main.dart';
import 'package:chess_alokas_mobile/models/draft.dart';
import 'package:chess_alokas_mobile/models/live.dart';
import 'package:chess_alokas_mobile/models/models.dart';
import 'package:chess_alokas_mobile/screens/checkin_pass_screen.dart';
import 'package:chess_alokas_mobile/services/alokas_api.dart';
import 'package:chess_alokas_mobile/services/device_location.dart';
import 'package:chess_alokas_mobile/services/local_store.dart';
import 'package:chess_alokas_mobile/theme/alokas_theme.dart';
import 'package:chess_alokas_mobile/theme/alokas_tokens.dart';
import 'package:chess_alokas_mobile/widgets/legal.dart';
import 'package:chess_alokas_mobile/widgets/player_name.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import 'fixtures/fake_api.dart';

const String _eventsPath = '/api/public/events';
const String _detailPath = '/api/public/events/fake-open';
const String _registerPath = '/api/public/events/fake-open/register';
const String _liveToken = 'fake-live-token-1';

InMemorySessionStorage _signedIn() => InMemorySessionStorage(
  AuthSession(
    accessToken: 'fake-access-token',
    refreshToken: 'fake-refresh-token',
    expiresAt: DateTime.now().add(const Duration(hours: 1)),
    userId: fakeUserId,
    email: 'player@example.test',
  ).encode(),
);

Map<String, FakeHandler> _account({Map<String, dynamic>? dashboard}) => {
  'GET /api/player/profiles': (_) => jsonResponse({
    'profiles': [fakeProfile()],
  }),
  'GET /api/player/registrations': (_) =>
      jsonResponse({'registrations': const []}),
  'GET /api/player/dashboard': (_) =>
      jsonResponse(dashboard ?? emptyDashboard()),
};

Map<String, dynamic> _eventDetail(
  Map<String, dynamic> event, {
  List<Map<String, dynamic>> questions = const [],
  String? paymentInstructions,
}) {
  final detail = fakeEventDetail(
    event,
    paymentInstructions: paymentInstructions,
  );
  (detail['event'] as Map<String, dynamic>)['registrationFormSchema'] = {
    'customQuestions': questions,
  };
  return detail;
}

Map<String, dynamic> _liveMatch({
  String color = 'white',
  int board = 14,
  String result = 'pending',
}) => {
  'tournamentId': fakeEventId,
  'tournamentName': 'Fake Live Event',
  'tournamentStatus': 'in_progress',
  'publicToken': _liveToken,
  'participantId': 'p1',
  'round': 2,
  'board': board,
  'color': color,
  'opponentId': 'p2',
  'opponentName': 'Tan Zwischen Zug',
  'result': result,
  'isBye': false,
  'currentScore': 1.5,
};

Map<String, dynamic> _liveSnapshot() => {
  'tournament': {
    'name': 'Fake Live Event',
    'rounds': 5,
    'currentRound': 2,
    'mixCategories': true,
  },
  'categories': [
    {'id': 'u12', 'name': 'Under 12'},
  ],
  'players': [
    {
      'id': 'p1',
      'name': 'Test Player One',
      'seed': 12,
      'categoryIds': ['u12'],
    },
    {
      'id': 'p2',
      'name': 'Tan Zwischen Zug',
      'seed': 7,
      'categoryIds': ['u12'],
    },
    {
      'id': 'p3',
      'name': 'Lim Gambit Ling',
      'seed': 3,
      'categoryIds': ['u12'],
    },
    {
      'id': 'p4',
      'name': 'Goh En Passant',
      'seed': 4,
      'categoryIds': ['u12'],
    },
  ],
  'games': [
    {
      'round': 1,
      'board': 1,
      'whiteId': 'p1',
      'blackId': 'p3',
      'result': '1-0',
      'isBye': false,
    },
    {
      'round': 1,
      'board': 2,
      'whiteId': 'p2',
      'blackId': 'p4',
      'result': '1-0',
      'isBye': false,
    },
    {
      'round': 2,
      'board': 14,
      'whiteId': 'p1',
      'blackId': 'p2',
      'result': 'pending',
      'isBye': false,
    },
    {
      'round': 2,
      'board': 15,
      'whiteId': 'p3',
      'blackId': 'p4',
      'result': '1/2-1/2',
      'isBye': false,
    },
  ],
};

Future<LocalStore> _pump(
  WidgetTester tester,
  FakeBackend backend, {
  InMemorySessionStorage? storage,
  LocalStore? store,
  DeviceLocator? locator,
  Future<PickedReceipt?> Function()? picker,
}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final local = store ?? InMemoryLocalStore();
  await tester.pumpWidget(
    ChessAlokasMobileApp(
      // A new key: a fresh launch, as after the app was killed.
      key: UniqueKey(),
      apiClient: AlokasApiClient(
        config: fakeConfig,
        httpClient: backend.client,
        sessionStorage: storage ?? InMemorySessionStorage(),
      ),
      preferences: MemoryPreferences(),
      localStore: local,
      locateDevice:
          locator ??
          ({bool prompt = true}) async =>
              const DeviceLocationProblem('Not used in this test.'),
      namePlace: (_, _) async => null,
      receiptPicker: picker ?? () async => null,
      certificateSaver: (_, _) async => true,
    ),
  );
  await tester.pumpAndSettle();
  return local;
}

Future<void> _tapKey(WidgetTester tester, String key) async {
  final target = find.byKey(Key(key));
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

Future<void> _startRegistering(WidgetTester tester) async {
  final open = find.text('View & Register').first;
  await tester.ensureVisible(open);
  await tester.tap(open);
  await tester.pumpAndSettle();
  await _tapKey(tester, 'start-register-button');
}

Widget _themed(Widget child, {double width = 320}) => MaterialApp(
  theme: AlokasTheme.build(AlokasPalette.forest, Brightness.dark),
  home: Scaffold(
    body: Center(
      child: SizedBox(width: width, child: child),
    ),
  ),
);

/// All the text a [PlayerName] shows, wherever it wrapped to.
String _nameText(WidgetTester tester) => tester
    .widgetList<Text>(find.byType(Text))
    .map((t) => t.data ?? t.textSpan!.toPlainText())
    .join(' ');

void main() {
  group('PlayerName', () {
    test('splits at bin, binti, a/l and a/p, whatever the case', () {
      for (final (raw, given, rest) in const [
        (
          'Puteri Alekhine Damia binti Queen Gambit',
          'Puteri Alekhine Damia',
          'binti Queen Gambit',
        ),
        ('Goh Bin Caro Kann', 'Goh', 'Bin Caro Kann'),
        ('Ravi Sicilian a/l Najdorf', 'Ravi Sicilian', 'a/l Najdorf'),
        ('Devi Nimzo a/p Indian', 'Devi Nimzo', 'a/p Indian'),
      ]) {
        final parts = splitPlayerName(raw);
        expect(parts.given, given);
        expect(parts.patronym, rest);
      }
    });

    test('a marker needs a name on both sides', () {
      expect(splitPlayerName('Binti Queen').patronym, isNull);
      expect(splitPlayerName('Ali bin').patronym, isNull);
      expect(splitPlayerName('Robin Hood').patronym, isNull);
    });

    test('capitals become Title Case; mixed case stays as typed', () {
      expect(
        displayPlayerName('SITI AMINAH BINTI QUEEN GAMBIT'),
        'Siti Aminah binti Queen Gambit',
      );
      expect(displayPlayerName('RAVI A/L NAJDORF'), 'Ravi a/l Najdorf');
      expect(
        displayPlayerName('McDonald van der Berg'),
        'McDonald van der Berg',
      );
    });

    testWidgets('never truncates, even in a very narrow space', (tester) async {
      const name =
          'Puteri Alekhine Damia Extraordinarily Long Name binti Queen Gambit Accepted Variation';
      await tester.pumpWidget(_themed(const PlayerName(name), width: 120));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      for (final word in name.split(' ')) {
        expect(_nameText(tester), contains(word));
      }
      for (final text in tester.widgetList<Text>(find.byType(Text))) {
        expect(text.overflow, isNot(TextOverflow.ellipsis));
        expect(text.overflow, isNot(TextOverflow.fade));
        expect(text.maxLines, isNull);
      }
    });

    testWidgets('wraps at the patronym when one line is not enough', (
      tester,
    ) async {
      await tester.pumpWidget(
        _themed(
          const PlayerName('Puteri Alekhine Damia binti Queen Gambit'),
          width: 200,
        ),
      );
      expect(find.text('Puteri Alekhine Damia'), findsOneWidget);
      expect(find.text('binti Queen Gambit'), findsOneWidget);
    });

    testWidgets('two similar children cannot look identical', (tester) async {
      await tester.pumpWidget(
        _themed(
          const Column(
            children: [
              PlayerName(
                'Puteri Alekhine Damia binti Queen Gambit',
                number: 12,
                section: 'Under 12',
              ),
              PlayerName(
                'Puteri Alekhine Damia binti Queen Indian',
                number: 31,
                section: 'Under 12',
              ),
            ],
          ),
          width: 200,
        ),
      );
      expect(find.text('#12 · Under 12'), findsOneWidget);
      expect(find.text('#31 · Under 12'), findsOneWidget);
      expect(find.text('binti Queen Gambit'), findsOneWidget);
      expect(find.text('binti Queen Indian'), findsOneWidget);
    });

    test('a number of 0 or no section adds nothing invented', () {
      expect(disambiguatorFor(null, null), isNull);
      expect(disambiguatorFor(0, null), isNull);
      expect(disambiguatorFor(7, null), '#7');
      expect(disambiguatorFor(null, 'Open'), 'Open');
    });
  });

  group('Pairing Sheet design', () {
    test(
      'lib/ has no raw colours outside the theme, and no emoji or chess glyphs',
      () {
        final glyphs = RegExp(r'[♔-♟\u{1F300}-\u{1FAFF}☀-➿]', unicode: true);
        final raw = RegExp(r'\bColor\(0x|\bColors\.|AlokasColors|Color\.from');
        final truncation = RegExp(r'TextOverflow\.(ellipsis|fade)');
        final sources = Directory('lib')
            .listSync(recursive: true)
            .whereType<File>()
            .where((f) => f.path.endsWith('.dart'));
        for (final file in sources) {
          final text = file.readAsStringSync();
          final path = file.path.replaceAll(r'\', '/');
          expect(glyphs.hasMatch(text), isFalse, reason: 'glyph in $path');
          expect(
            truncation.hasMatch(text),
            isFalse,
            reason: 'cut text in $path',
          );
          if (!path.contains('lib/theme/')) {
            expect(raw.hasMatch(text), isFalse, reason: 'raw colour in $path');
          }
        }
      },
    );

    test(
      'green by default, whatever the phone says; Sunlight is an option',
      () {
        final forest = AlokasTheme.of(AlokasThemeChoice.forest);
        expect(forest.scaffoldBackgroundColor, AlokasTokens.forestPaper);
        expect(forest.colorScheme.primary, AlokasTokens.forestAccent);
        expect(forest.colorScheme.onPrimary, AlokasTokens.forestOnAccent);
        expect(AlokasThemeChoice.fromName(null), AlokasThemeChoice.forest);
        expect(AlokasThemeChoice.fromName('dark'), AlokasThemeChoice.forest);

        final sun = AlokasTheme.of(AlokasThemeChoice.sun);
        expect(sun.scaffoldBackgroundColor, AlokasTokens.sunPaper);
      },
    );

    test('every text pair meets WCAG AA on every surface', () {
      double lin(double c) => c <= 0.03928
          ? c / 12.92
          : math.pow((c + 0.055) / 1.055, 2.4).toDouble();
      double lum(Color c) =>
          0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
      double ratio(Color a, Color b) {
        final (x, y) = (lum(a), lum(b));
        return (math.max(x, y) + 0.05) / (math.min(x, y) + 0.05);
      }

      for (final p in const [AlokasPalette.forest, AlokasPalette.sun]) {
        final surfaces = [
          p.paper,
          p.paper2,
          p.paper3,
          p.elevated,
          p.gradientStart,
          p.gradientEnd,
        ];
        for (final surface in surfaces) {
          for (final text in [
            p.ink,
            p.ink2,
            p.ink3,
            p.accent,
            p.pen,
            p.flag,
            p.go,
            p.wait,
          ]) {
            expect(
              ratio(text, surface),
              greaterThanOrEqualTo(4.5),
              reason: '$text on $surface',
            );
          }
          expect(ratio(p.ruleStrong, surface), greaterThanOrEqualTo(3));
        }
        expect(ratio(p.onAccent, p.accent), greaterThanOrEqualTo(4.5));
        expect(ratio(p.ink, p.accentWash), greaterThanOrEqualTo(4.5));
        expect(ratio(p.accent, p.accentWash), greaterThanOrEqualTo(4.5));
        expect(ratio(p.flag, p.flagWash), greaterThanOrEqualTo(4.5));
        expect(ratio(p.go, p.goWash), greaterThanOrEqualTo(4.5));
        expect(ratio(p.wait, p.waitWash), greaterThanOrEqualTo(4.5));
        expect(ratio(p.pen, p.penWash), greaterThanOrEqualTo(4.5));
      }
      expect(
        ratio(AlokasTokens.pieceWhite, AlokasTokens.pieceBlack),
        greaterThanOrEqualTo(21),
      );
    });

    test('Archivo is in the bundle with tabular figures', () {
      final pubspec = File('pubspec.yaml').readAsStringSync();
      expect(pubspec, contains('assets/fonts/Archivo-Latin.ttf'));
      expect(File('assets/fonts/Archivo-Latin.ttf').existsSync(), isTrue);
      expect(File('assets/fonts/OFL-Archivo.txt').existsSync(), isTrue);
      expect(
        atype(16, tabular: true).fontFeatures,
        contains(const FontFeature.tabularFigures()),
      );
    });

    testWidgets('the board hero is literally the colour they play', (
      tester,
    ) async {
      Color heroColor(String key) {
        final box = tester.widget<Container>(find.byKey(Key(key)));
        return (box.decoration! as BoxDecoration).color!;
      }

      var match = _liveMatch();
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(),
        'GET /api/player/dashboard': (_) => jsonResponse({
          ...emptyDashboard(),
          'liveMatches': [match],
        }),
        'GET /api/public/live/$_liveToken': (_) =>
            jsonResponse(_liveSnapshot()),
      });
      await _pump(tester, backend, storage: _signedIn());
      await tester.tap(find.text('Matchday'));
      await tester.pumpAndSettle();

      expect(heroColor('hero-white'), AlokasTokens.pieceWhite);
      expect(find.text('14'), findsOneWidget);
      expect(find.text('Plays White'), findsOneWidget);
      expect(find.byKey(const Key('hero-card')), findsOneWidget);

      match = _liveMatch(color: 'black');
      await tester.tap(find.text('Career'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Matchday'));
      await tester.pumpAndSettle();
      expect(heroColor('hero-black'), AlokasTokens.pieceBlack);
    });

    testWidgets('no-pairing yet is not shown as board 0 or a bye', (
      tester,
    ) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(
          dashboard: {
            ...emptyDashboard(),
            'liveMatches': [
              {
                'tournamentName': 'Fake Live Event',
                'round': 1,
                'board': 0,
                'color': 'bye',
                'isBye': false,
                'result': 'pending',
                'currentScore': 0,
              },
            ],
          },
        ),
      });
      await _pump(tester, backend, storage: _signedIn());
      await tester.tap(find.text('Matchday'));
      await tester.pumpAndSettle();

      expect(find.text('Pairings are not out yet'), findsOneWidget);
      expect(find.textContaining('Bye'), findsNothing);
      expect(find.byKey(const Key('hero-board')), findsNothing);
      expect(find.byKey(const Key('current-score')), findsOneWidget);
    });

    testWidgets('choosing a theme changes the page at once and is kept', (
      tester,
    ) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
      });
      await _pump(tester, backend);
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();

      Color page() => tester
          .widget<Material>(
            find
                .descendant(
                  of: find.byType(Scaffold),
                  matching: find.byType(Material),
                )
                .first,
          )
          .color!;
      expect(page(), AlokasTokens.forestPaper);
      await _tapKey(tester, 'theme-sun');
      expect(page(), AlokasTokens.sunPaper);
      await _tapKey(tester, 'theme-forest');
      expect(page(), AlokasTokens.forestPaper);
    });

    testWidgets('controls on the main screens are at least 44 px', (
      tester,
    ) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({
          'events': [fakeEvent(entryFeeCents: 5000)],
        }),
        'GET $_detailPath': (_) => jsonResponse(_eventDetail(fakeEvent())),
        ..._account(
          dashboard: {
            ...emptyDashboard(),
            'liveMatches': [_liveMatch()],
          },
        ),
        'GET /api/public/live/$_liveToken': (_) =>
            jsonResponse(_liveSnapshot()),
      });
      await _pump(tester, backend, storage: _signedIn());

      void checkAll(String where) {
        final buttons = find.byWidgetPredicate(
          (w) =>
              w is ButtonStyleButton ||
              w is IconButton ||
              w is NavigationDestination ||
              (w is InkWell && w.onTap != null),
        );
        for (final element in buttons.evaluate()) {
          final box = element.renderObject as RenderBox?;
          if (box == null || !box.hasSize) continue;
          expect(
            box.size.height,
            greaterThanOrEqualTo(44),
            reason: '$where: ${element.widget}',
          );
          expect(
            box.size.width,
            greaterThanOrEqualTo(44),
            reason: '$where: ${element.widget}',
          );
        }
      }

      checkAll('Discover');
      for (final tab in const ['Matchday', 'Career', 'Account']) {
        await tester.tap(find.text(tab));
        await tester.pumpAndSettle();
        checkAll(tab);
      }
    });
  });

  group('Account', () {
    Future<void> openSheet(WidgetTester tester) async {
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('open-sign-in-button')));
      await tester.pumpAndSettle();
    }

    Map<String, FakeHandler> noEvents() => {
      'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
    };

    testWidgets('sign-up with confirmation on waits for the email', (
      tester,
    ) async {
      final backend = FakeBackend({
        ...noEvents(),
        'POST /auth/v1/signup': (_) =>
            jsonResponse({'id': fakeUserId, 'email': 'new@example.test'}),
        'POST /auth/v1/resend': (_) => jsonResponse(const {}),
      });
      final storage = InMemorySessionStorage();
      await _pump(tester, backend, storage: storage);
      await openSheet(tester);
      await _tapKey(tester, 'open-sign-up');
      await tester.enterText(
        find.byKey(const Key('sign-in-email')),
        'new@example.test',
      );
      await tester.enterText(
        find.byKey(const Key('sign-in-password')),
        'long-enough-1',
      );
      await _tapKey(tester, 'sign-up-submit');

      expect(find.byKey(const Key('check-email-message')), findsOneWidget);
      expect(storage.value, isNull, reason: 'no session without confirmation');
      final sent = jsonDecode(
        backend.sent('POST', '/auth/v1/signup').single.body,
      );
      expect(sent['email'], 'new@example.test');

      await _tapKey(tester, 'resend-confirmation');
      expect(backend.sent('POST', '/auth/v1/resend'), hasLength(1));
      expect(find.byKey(const Key('sign-in-notice')), findsOneWidget);
    });

    testWidgets('sign-up with no confirmation signs straight in', (
      tester,
    ) async {
      final backend = FakeBackend({
        ...noEvents(),
        ..._account(),
        'POST /auth/v1/signup': (_) => jsonResponse(tokenResponse()),
      });
      final storage = InMemorySessionStorage();
      await _pump(tester, backend, storage: storage);
      await openSheet(tester);
      await _tapKey(tester, 'open-sign-up');
      await tester.enterText(
        find.byKey(const Key('sign-in-email')),
        'new@example.test',
      );
      await tester.enterText(
        find.byKey(const Key('sign-in-password')),
        'long-enough-1',
      );
      await _tapKey(tester, 'sign-up-submit');

      expect(storage.value, isNotNull);
      expect(find.byKey(const Key('sign-out-button')), findsOneWidget);
    });

    testWidgets('a short password is refused before anything is sent', (
      tester,
    ) async {
      final backend = FakeBackend(noEvents());
      await _pump(tester, backend);
      await openSheet(tester);
      await _tapKey(tester, 'open-sign-up');
      await tester.enterText(
        find.byKey(const Key('sign-in-email')),
        'new@example.test',
      );
      await tester.enterText(
        find.byKey(const Key('sign-in-password')),
        'short',
      );
      await _tapKey(tester, 'sign-up-submit');

      expect(find.byKey(const Key('sign-in-error')), findsOneWidget);
      expect(backend.sent('POST', '/auth/v1/signup'), isEmpty);
    });

    testWidgets('an unconfirmed sign-in can ask for the email again', (
      tester,
    ) async {
      final backend = FakeBackend({
        ...noEvents(),
        'POST /auth/v1/token': (_) => jsonResponse({
          'error_code': 'email_not_confirmed',
          'msg': 'Email not confirmed',
        }, 400),
        'POST /auth/v1/resend': (_) => jsonResponse(const {}),
      });
      await _pump(tester, backend);
      await openSheet(tester);
      await tester.enterText(
        find.byKey(const Key('sign-in-email')),
        'new@example.test',
      );
      await tester.enterText(find.byKey(const Key('sign-in-password')), 'x');
      await _tapKey(tester, 'sign-in-submit');

      expect(find.text(emailNotConfirmedMessage), findsOneWidget);
      await _tapKey(tester, 'resend-confirmation');
      expect(backend.sent('POST', '/auth/v1/resend'), hasLength(1));
    });

    testWidgets('a reset request never reveals whether the account exists', (
      tester,
    ) async {
      final backend = FakeBackend({
        ...noEvents(),
        'POST /auth/v1/recover': (_) => jsonResponse(const {}),
      });
      await _pump(tester, backend);
      await openSheet(tester);
      await _tapKey(tester, 'open-reset');
      await tester.enterText(
        find.byKey(const Key('sign-in-email')),
        'who@example.test',
      );
      await _tapKey(tester, 'reset-submit');

      expect(find.byKey(const Key('reset-sent-message')), findsOneWidget);
      expect(find.textContaining('If an account exists'), findsOneWidget);
    });

    test('no other sign-in provider is left in the app', () {
      final text = Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))
          .map((f) => f.readAsStringSync().toLowerCase())
          .join();
      for (final term in const ['google', 'github', 'oauth', 'provider=']) {
        expect(text, isNot(contains(term)));
      }
    });
  });

  group('Registration flow and drafts', () {
    final questions = <Map<String, dynamic>>[
      {
        'id': 'tshirt',
        'label': 'T-shirt size',
        'type': 'select',
        'required': true,
        'options': ['S', 'M'],
      },
      {
        'id': 'note',
        'label': 'Anything we should know?',
        'type': 'text',
        'required': false,
      },
    ];

    FakeBackend backendFor(
      Map<String, dynamic> event, {
      List<Map<String, dynamic>> questions = const [],
      FakeHandler? register,
    }) => FakeBackend({
      'GET $_eventsPath': (_) => jsonResponse({
        'events': [event],
      }),
      'GET $_detailPath': (_) => jsonResponse(
        _eventDetail(
          event,
          questions: questions,
          paymentInstructions: 'Pay the fake test cashier',
        ),
      ),
      ..._account(),
      'POST $_registerPath':
          register ??
          (_) => jsonResponse({
            'registration': fakeRegistration(paymentStatus: 'pending_receipt'),
          }, 201),
    });

    testWidgets('required questions block Continue and answers are sent', (
      tester,
    ) async {
      final backend = backendFor(fakeEvent(), questions: questions);
      await _pump(tester, backend, storage: _signedIn());
      await _startRegistering(tester);
      await _tapKey(tester, 'register-next');
      expect(find.text("The organizer's questions"), findsOneWidget);

      // On the last step, sending is blocked until required ones are answered.
      await _tapKey(tester, 'confirm-register-button');
      expect(find.byKey(const Key('step-error')), findsOneWidget);
      expect(backend.sent('POST', _registerPath), isEmpty);

      await tester.tap(find.byKey(Key('question-$fakeProfileId-tshirt')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('M').last);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(Key('question-$fakeProfileId-note')),
        'Fake note',
      );
      await _tapKey(tester, 'confirm-register-button');

      final body = jsonDecode(backend.sent('POST', _registerPath).single.body);
      expect(body['customAnswers'], {'tshirt': 'M', 'note': 'Fake note'});
      expect(find.byKey(const Key('register-done')), findsOneWidget);
    });

    testWidgets('a draft survives a kill mid-payment, at the same step', (
      tester,
    ) async {
      final png = Uint8List.fromList([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
      final event = fakeEvent(entryFeeCents: 5000);
      final backend = backendFor(event, questions: questions);
      final store = InMemoryLocalStore();
      await _pump(
        tester,
        backend,
        storage: _signedIn(),
        store: store,
        picker: () async => PickedReceipt(name: 'fake-receipt.png', bytes: png),
      );
      await _startRegistering(tester);
      await _tapKey(tester, 'register-next');
      await tester.tap(find.byKey(Key('question-$fakeProfileId-tshirt')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('S').last);
      await tester.pumpAndSettle();
      await _tapKey(tester, 'register-next');
      expect(find.text('Pay the entry fee'), findsOneWidget);
      await _tapKey(tester, 'register-next');
      await _tapKey(tester, 'choose-receipt-button');
      await tester.pumpAndSettle();

      // Killed: a fresh app, the server unreachable, only this phone's files.
      final offline = FakeBackend({});
      await _pump(tester, offline, storage: _signedIn(), store: store);

      expect(find.byKey(Key('draft-$fakeEventId')), findsOneWidget);
      await _tapKey(tester, 'resume-draft');
      expect(find.text('Add your receipt'), findsOneWidget);
      expect(find.byKey(const Key('receipt-chosen')), findsOneWidget);

      await _tapKey(tester, 'register-back');
      expect(find.text('Pay the fake test cashier'), findsOneWidget);

      await _tapKey(tester, 'register-next');
      await _tapKey(tester, 'confirm-register-button');
      // Not reachable, so nothing is lost and the failure is plain.
      expect(find.textContaining('NOT registered'), findsOneWidget);
      expect(store.texts.keys.where((k) => k.startsWith('draft_')), isNotEmpty);
    });

    testWidgets('sending removes the draft; retrying skips accepted players', (
      tester,
    ) async {
      final backend = backendFor(fakeEvent());
      final store = InMemoryLocalStore();
      await _pump(tester, backend, storage: _signedIn(), store: store);
      await _startRegistering(tester);
      expect(store.texts.keys.where((k) => k.startsWith('draft_')), isNotEmpty);

      await _tapKey(tester, 'confirm-register-button');

      expect(find.byKey(const Key('register-done')), findsOneWidget);
      expect(store.texts.keys.where((k) => k.startsWith('draft_')), isEmpty);
    });

    testWidgets(
      'a draft is discarded even if the event came back with a new id',
      (tester) async {
        final event = fakeEvent();
        final store = InMemoryLocalStore();
        await _pump(
          tester,
          backendFor(event),
          storage: _signedIn(),
          store: store,
        );
        await _startRegistering(tester);
        expect(
          store.texts.keys.where((k) => k.startsWith('draft_')),
          hasLength(1),
        );

        // The next launch finds the same slug under a different id.
        final moved = fakeEvent(
          overrides: const {'id': '00000000-0000-4000-8000-00000000e999'},
        );
        await _pump(
          tester,
          backendFor(moved),
          storage: _signedIn(),
          store: store,
        );
        await _tapKey(tester, 'resume-draft');
        await _tapKey(tester, 'discard-draft');

        expect(store.texts.keys.where((k) => k.startsWith('draft_')), isEmpty);
        expect(find.byKey(const Key('resume-draft')), findsNothing);
      },
    );

    testWidgets('a damaged draft is ignored', (tester) async {
      expect(RegistrationDraft.tryDecode('not json'), isNull);
      expect(RegistrationDraft.tryDecode('{"eventId": 3}'), isNull);
    });

    testWidgets('signing out removes drafts and the offline copy', (
      tester,
    ) async {
      final backend = backendFor(fakeEvent());
      final store = InMemoryLocalStore();
      await _pump(tester, backend, storage: _signedIn(), store: store);
      await _startRegistering(tester);
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      expect(store.texts.keys.where((k) => k.startsWith('draft_')), isNotEmpty);

      await _tapKey(tester, 'sign-out-button');

      expect(store.texts.keys.where((k) => k.startsWith('draft_')), isEmpty);
      expect(
        store.texts.keys.where(
          (k) => k.startsWith('cache_') && k != 'cache_events.json',
        ),
        isEmpty,
      );
    });
  });

  group('Late receipt', () {
    final png = Uint8List.fromList([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const registrationId = '00000000-0000-4000-8000-00000000f001';
    const route = 'POST /api/player/registrations/$registrationId/receipt';

    Map<String, FakeHandler> routes(FakeHandler upload) => {
      'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
      ..._account(),
      'GET /api/player/registrations': (_) => jsonResponse({
        'registrations': [fakeRegistration(paymentStatus: 'pending_receipt')],
      }),
      'GET /api/public/events/$fakeEventId': (_) =>
          jsonResponse(_eventDetail(fakeEvent())),
      route: upload,
    };

    testWidgets('sends the file and says so', (tester) async {
      final backend = FakeBackend(
        routes(
          (_) => jsonResponse({
            'registration': fakeRegistration(
              paymentStatus: 'submitted',
              hasReceipt: true,
            ),
          }),
        ),
      );
      await _pump(
        tester,
        backend,
        storage: _signedIn(),
        picker: () async => PickedReceipt(name: 'fake.png', bytes: png),
      );
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      expect(find.text('Fake Open Test Event'), findsOneWidget);

      await _tapKey(tester, 'add-receipt-$registrationId');

      expect(find.textContaining('Receipt sent'), findsOneWidget);
      final body = jsonDecode(
        backend.sent('POST', route.substring(5)).single.body,
      );
      expect(body['receiptDataUrl'], startsWith('data:image/png;base64,'));
    });

    Future<void> tryUpload(WidgetTester tester, FakeHandler upload) async {
      await _pump(
        tester,
        FakeBackend(routes(upload)),
        storage: _signedIn(),
        picker: () async => PickedReceipt(name: 'fake.png', bytes: png),
      );
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      await _tapKey(tester, 'add-receipt-$registrationId');
    }

    testWidgets('a registration not on this account says nothing was sent', (
      tester,
    ) async {
      await tryUpload(
        tester,
        (_) => jsonResponse({'error': 'Registration not found'}, 404),
      );
      expect(find.textContaining('Nothing was sent'), findsOneWidget);
      expect(find.textContaining('Receipt sent'), findsNothing);
    });

    for (final (status, text) in const [
      (400, 'Receipt must be a PNG, JPEG, WebP or PDF file.'),
      (409, 'This registration was cancelled, so it cannot take a receipt.'),
      (429, 'Too many tries. Try again later.'),
    ]) {
      testWidgets('a $status shows the server\'s own words', (tester) async {
        await tryUpload(tester, (_) => jsonResponse({'error': text}, status));
        expect(find.text(text), findsOneWidget);
        expect(find.textContaining('Receipt sent'), findsNothing);
      });
    }
  });

  group('Offline', () {
    testWidgets(
      'a cold start with no server shows the last matchday and time',
      (tester) async {
        final store = InMemoryLocalStore();
        final online = FakeBackend({
          'GET $_eventsPath': (_) => jsonResponse({
            'events': [fakeEvent()],
          }),
          ..._account(
            dashboard: {
              ...emptyDashboard(),
              'liveMatches': [_liveMatch()],
            },
          ),
          'GET /api/public/live/$_liveToken': (_) =>
              jsonResponse(_liveSnapshot()),
        });
        await _pump(tester, online, storage: _signedIn(), store: store);
        await tester.tap(find.text('Matchday'));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('hero-white')), findsOneWidget);
        expect(find.byKey(const Key('fresh-line')), findsOneWidget);

        // The server goes away and the app starts from nothing.
        await _pump(
          tester,
          FakeBackend({}),
          storage: _signedIn(),
          store: store,
        );
        expect(find.text('Fake Open Test Event'), findsOneWidget);
        await tester.tap(find.text('Matchday'));
        await tester.pumpAndSettle();

        expect(find.byKey(const Key('hero-white')), findsOneWidget);
        expect(find.text('14'), findsOneWidget);
        expect(find.byKey(const Key('stale-notice')), findsOneWidget);
        expect(find.textContaining('as of'), findsWidgets);
        expect(find.text('#7 · Under 12'), findsWidgets);
      },
    );

    testWidgets('open Matchday polls for news', (tester) async {
      var requests = 0;
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(),
        'GET /api/player/dashboard': (_) {
          requests++;
          return jsonResponse(emptyDashboard());
        },
      });
      await _pump(tester, backend, storage: _signedIn());
      await tester.tap(find.text('Matchday'));
      await tester.pumpAndSettle();
      final before = requests;
      await tester.pump(const Duration(seconds: 31));
      await tester.pumpAndSettle();
      expect(requests, greaterThan(before));

      // Other tabs stop polling.
      await tester.tap(find.text('Discover'));
      await tester.pumpAndSettle();
      final after = requests;
      await tester.pump(const Duration(seconds: 61));
      await tester.pumpAndSettle();
      expect(requests, after);
    });
  });

  group('Standings and pairings', () {
    final live = LiveSnapshot.tryFromJson(_liveSnapshot())!;

    test('by points with shared ranks; pending games count for nothing', () {
      final rows = live.standings('u12');
      // Ties keep starting-number order: the lower number comes first.
      expect(rows.map((r) => r.player.id).toList(), ['p2', 'p1', 'p3', 'p4']);
      expect(rows[0].points, 1);
      expect(rows[0].rankLabel, '1=');
      expect(rows[1].rankLabel, '1=');
      expect(rows[2].points, 0.5);
      expect(rows[2].rankLabel, '3=');
    });

    test('byes and forfeits score as on the server', () {
      const bye = LiveGame(round: 1, whiteId: 'a', result: 'bye', isBye: true);
      const forfeit = LiveGame(
        round: 1,
        whiteId: 'a',
        blackId: 'b',
        result: '0-1F',
      );
      const none = LiveGame(
        round: 1,
        whiteId: 'a',
        blackId: 'b',
        result: '0-0',
      );
      expect(bye.pointsFor('a'), 1);
      expect(forfeit.pointsFor('a'), 0);
      expect(forfeit.pointsFor('b'), 1);
      expect(none.pointsFor('a'), 0);
    });

    test('points and results read as on a pairing sheet', () {
      expect(formatPoints(1.5), '1½');
      expect(formatPoints(0.5), '½');
      expect(formatPoints(2), '2');
      expect(formatResult('1/2-1/2'), '½ – ½');
      expect(formatResult('pending'), '');
    });

    testWidgets('the live page shows as-of, standings and pairings', (
      tester,
    ) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(
          dashboard: {
            ...emptyDashboard(),
            'liveMatches': [_liveMatch()],
          },
        ),
        'GET /api/public/live/$_liveToken': (_) =>
            jsonResponse(_liveSnapshot()),
      });
      await _pump(tester, backend, storage: _signedIn());
      await tester.tap(find.text('Matchday'));
      await tester.pumpAndSettle();
      await _tapKey(tester, 'open-standings');

      expect(find.byKey(const Key('live-as-of')), findsOneWidget);
      expect(find.text('Goh En Passant'), findsOneWidget);
      expect(find.text('#4 · Under 12'), findsOneWidget);

      await _tapKey(tester, 'tab-pairings');
      expect(find.text('Round 2'), findsOneWidget);
      expect(find.text('15'), findsOneWidget);
      expect(find.text('½ – ½'), findsOneWidget);
      await _tapKey(tester, 'round-1');
      expect(find.text('1 – 0'), findsWidgets);
    });

    testWidgets('no live token: says rank is unavailable, invents none', (
      tester,
    ) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(
          dashboard: {
            ...emptyDashboard(),
            'liveMatches': [
              {..._liveMatch(), 'publicToken': null},
            ],
          },
        ),
      });
      await _pump(tester, backend, storage: _signedIn());
      await tester.tap(find.text('Matchday'));
      await tester.pumpAndSettle();

      expect(
        find.textContaining('has not turned on the live page'),
        findsOneWidget,
      );
      expect(find.textContaining('Rank '), findsNothing);
      expect(find.byKey(const Key('open-standings')), findsNothing);
    });
  });

  group('Check-in pass', () {
    test('the code names the entry and nothing about the child', () {
      expect(checkInPayload('t-1', 'p-2'), 'alokas-checkin:v1:t-1:p-2');
    });

    testWidgets('says plainly that it does not check anyone in', (
      tester,
    ) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(
          dashboard: {
            ...emptyDashboard(),
            'liveMatches': [_liveMatch()],
          },
        ),
        'GET /api/public/live/$_liveToken': (_) =>
            jsonResponse(_liveSnapshot()),
      });
      await _pump(tester, backend, storage: _signedIn());
      await tester.tap(find.text('Matchday'));
      await tester.pumpAndSettle();
      await _tapKey(tester, 'open-checkin-pass');

      expect(find.byKey(const Key('checkin-qr')), findsOneWidget);
      expect(find.byKey(const Key('checkin-not-confirmed')), findsOneWidget);
      expect(find.text('#12 · Under 12'), findsOneWidget);
    });
  });

  group('Guardian consent', () {
    const childId = '00000000-0000-4000-8000-00000000a002';
    Map<String, dynamic> child() => {
      'id': childId,
      'isPrimary': false,
      'relationship': 'child',
      'fullName': 'Test Child One',
      'yearOfBirth': 2015,
    };

    test('the rule matches packages/shared/src/guardianConsent.ts', () {
      final now = DateTime(2026, 11, 1);
      bool need(String? rel, int? year) => guardianConsentRequired(
        relationship: rel,
        yearOfBirth: year,
        now: now,
      );
      expect(need('child', null), isTrue);
      expect(need('child', 1990), isTrue);
      expect(need('self', null), isFalse);
      expect(need('self', 2000), isFalse);
      expect(need('self', 2008), isTrue, reason: 'turning 18 this year');
      expect(need('self', 2007), isFalse);
      expect(need('student', null), isTrue);
      expect(need('family', 1990), isFalse);
      expect(need('family', 2015), isTrue);
      expect(
        guardianConsentRequired(
          relationship: 'self',
          dateOfBirth: '2008-12-31',
          now: now,
        ),
        isTrue,
      );
      expect(
        guardianConsentRequired(
          relationship: 'self',
          dateOfBirth: '2008-01-01',
          now: now,
        ),
        isFalse,
      );
    });

    FakeBackend backend() => FakeBackend({
      'GET $_eventsPath': (_) => jsonResponse({
        'events': [fakeEvent()],
      }),
      'GET $_detailPath': (_) => jsonResponse(_eventDetail(fakeEvent())),
      ..._account(),
      'GET /api/player/profiles': (_) => jsonResponse({
        'profiles': [child()],
      }),
      'POST $_registerPath': (_) =>
          jsonResponse({'registration': fakeRegistration()}, 201),
    });

    testWidgets('registering a child shows the line and sends consent', (
      tester,
    ) async {
      final api = backend();
      await _pump(tester, api, storage: _signedIn());
      await _startRegistering(tester);

      expect(find.byType(Checkbox), findsNothing);
      expect(find.byKey(const Key('guardian-consent-notice')), findsOneWidget);
      expect(find.textContaining('By submitting, you confirm'), findsOneWidget);

      await _tapKey(tester, 'confirm-register-button');
      final body = jsonDecode(api.sent('POST', _registerPath).single.body);
      expect(body['guardianConsent'], isTrue);
    });

    testWidgets('no line and no consent for an adult registering themselves', (
      tester,
    ) async {
      final api = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({
          'events': [fakeEvent()],
        }),
        'GET $_detailPath': (_) => jsonResponse(_eventDetail(fakeEvent())),
        ..._account(),
        'POST $_registerPath': (_) =>
            jsonResponse({'registration': fakeRegistration()}, 201),
      });
      await _pump(tester, api, storage: _signedIn());
      await _startRegistering(tester);
      expect(find.byKey(const Key('guardian-consent-notice')), findsNothing);
      await _tapKey(tester, 'confirm-register-button');
      final body = jsonDecode(api.sent('POST', _registerPath).single.body);
      expect(body.containsKey('guardianConsent'), isFalse);
    });

    testWidgets('a child profile shows the line and sends consent', (
      tester,
    ) async {
      Map<String, dynamic>? posted;
      final api = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(),
        'POST /api/player/profiles': (r) {
          posted = jsonDecode(r.body) as Map<String, dynamic>;
          return jsonResponse({'profile': fakeProfile()}, 201);
        },
      });
      await _pump(tester, api, storage: _signedIn());
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      await _tapKey(tester, 'open-add-profile-button');
      // There is already one profile, so a new one defaults to child.
      expect(find.byKey(const Key('guardian-consent-notice')), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('add-profile-fullname')),
        'Test Child Two',
      );
      await _tapKey(tester, 'save-profile-button');
      expect(posted!['guardianConsent'], isTrue);
    });
  });

  group('Legal and account deletion', () {
    Map<String, FakeHandler> routes(FakeHandler delete) => {
      'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
      ..._account(),
      'DELETE /api/me': delete,
    };

    Future<void> openDialog(WidgetTester tester) async {
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      await _tapKey(tester, 'open-delete-account');
    }

    testWidgets('links open the real pages', (tester) async {
      final opened = <String>[];
      final previous = LegalLink.opener;
      LegalLink.opener = (uri) async {
        opened.add(uri.toString());
        return true;
      };
      addTearDown(() => LegalLink.opener = previous);
      await _pump(tester, FakeBackend(routes((_) => jsonResponse(null, 204))));
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      await _tapKey(tester, 'link-$privacyUrl');
      await _tapKey(tester, 'link-$termsUrl');
      expect(opened, [privacyUrl, termsUrl]);
    });

    testWidgets('sign-up shows the agreement with its links', (tester) async {
      await _pump(tester, FakeBackend(routes((_) => jsonResponse(null, 204))));
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      await _tapKey(tester, 'open-sign-in-button');
      await _tapKey(tester, 'open-sign-up');
      expect(find.byKey(const Key('signup-agreement')), findsOneWidget);
      expect(find.byKey(const Key('link-$termsUrl')), findsWidgets);
    });

    testWidgets(
      'deleting needs the email typed, says what stays, then signs out',
      (tester) async {
        final api = FakeBackend(routes((_) => http.Response('', 204)));
        final storage = _signedIn();
        final store = await _pump(tester, api, storage: storage);
        await openDialog(tester);

        expect(find.textContaining('Results stay'), findsOneWidget);
        expect(
          find.byKey(const Key('link-$privacyRetentionUrl')),
          findsOneWidget,
        );
        final confirm = find.byKey(const Key('confirm-delete-account'));
        expect(tester.widget<ElevatedButton>(confirm).onPressed, isNull);

        await tester.enterText(
          find.byKey(const Key('delete-account-email')),
          'player@example.test',
        );
        await tester.pumpAndSettle();
        await _tapKey(tester, 'confirm-delete-account');

        expect(api.sent('DELETE', '/api/me'), hasLength(1));
        expect(storage.value, isNull);
        expect(find.byKey(const Key('open-sign-in-button')), findsOneWidget);
        final keys = (store as InMemoryLocalStore).texts.keys;
        expect(keys.where((k) => k.startsWith('draft_')), isEmpty);
        expect(
          keys.where((k) => k.startsWith('cache_') && k != 'cache_events.json'),
          isEmpty,
        );
      },
    );

    testWidgets('a refusal says it was not deleted and stays signed in', (
      tester,
    ) async {
      final api = FakeBackend(
        routes(
          (_) => jsonResponse({'error': 'Auth admin not configured'}, 503),
        ),
      );
      final storage = _signedIn();
      await _pump(tester, api, storage: storage);
      await openDialog(tester);
      await tester.enterText(
        find.byKey(const Key('delete-account-email')),
        'player@example.test',
      );
      await tester.pumpAndSettle();
      await _tapKey(tester, 'confirm-delete-account');

      expect(find.byKey(const Key('delete-account-error')), findsOneWidget);
      expect(storage.value, isNotNull);
    });
  });

  group('Player-first wording', () {
    testWidgets('the Alokas rating is not shown; real ratings are', (
      tester,
    ) async {
      final profile = {
        ...fakeProfile(),
        'alokasRating': 1000,
        'fideRapid': 1500,
      };
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': const []}),
        ..._account(),
        'GET /api/player/profiles': (_) => jsonResponse({
          'profiles': [profile],
        }),
      });
      await _pump(tester, backend, storage: _signedIn());
      await tester.tap(find.text('Career'));
      await tester.pumpAndSettle();
      expect(find.text('1000'), findsNothing);
      expect(find.text('1500'), findsOneWidget);
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Alokas 1000'), findsNothing);
      expect(find.textContaining('FIDE Rapid 1500'), findsOneWidget);
    });

    test('family is not a label in headings or navigation', () {
      final text = Directory('lib')
          .listSync(recursive: true)
          .whereType<File>()
          .where((f) => f.path.endsWith('.dart'))
          .map((f) => f.readAsStringSync())
          .join();
      expect(text, isNot(contains('family member')));
      expect(text, isNot(contains('& Family')));
      expect(text, isNot(contains('Family &')));
    });
  });
}
