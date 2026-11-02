import 'dart:convert';

import 'package:chess_alokas_mobile/main.dart';
import 'package:chess_alokas_mobile/models/models.dart';
import 'package:chess_alokas_mobile/screens/events_map.dart';
import 'package:chess_alokas_mobile/services/alokas_api.dart';
import 'package:chess_alokas_mobile/services/device_location.dart';
import 'package:chess_alokas_mobile/services/map_style.dart';
import 'package:chess_alokas_mobile/services/place_search.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'fixtures/fake_api.dart';

const _eventsPath = '/api/public/events';

MobileEventItem _at({
  String? name,
  String? city,
  String? state,
  String? venue,
}) => MobileEventItem(
  id: 'e-${name ?? city ?? state}',
  name: name,
  city: city,
  state: state,
  venueName: venue,
);

Future<void> _pump(
  WidgetTester tester,
  List<Map<String, dynamic>> events, {
  DeviceLocator? locator,
  PlaceNamer? namer,
  MapStyleLoader? style,
  MapSurfaceBuilder? surface,
  MemoryPreferences? preferences,
  void Function()? onPrecise,
  FakeBackend? backend,
}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final api =
      backend ??
      FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': events}),
      });
  await tester.pumpWidget(
    ChessAlokasMobileApp(
      apiClient: AlokasApiClient(
        config: fakeConfig,
        httpClient: api.client,
        sessionStorage: InMemorySessionStorage(),
      ),
      preferences: preferences ?? MemoryPreferences(),
      localStore: InMemoryLocalStore(),
      locateDevice:
          locator ??
          ({bool prompt = true}) async =>
              const DeviceLocationProblem('Not used in this test.'),
      namePlace: namer ?? (_, _) async => null,
      requestPreciseLocation: () async => onPrecise?.call(),
      loadMapStyle: style ?? ({required bool sunlight}) async => '{}',
      mapSurfaceBuilder: surface ?? (_) => const SizedBox.shrink(),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tapKey(WidgetTester tester, String key) async {
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

Future<void> _openMap(WidgetTester tester) async {
  await tester.tap(find.text('Map'));
  await tester.pumpAndSettle();
}

DeviceLocator _foundAt(double lat, double lng, {bool approximate = false}) =>
    ({bool prompt = true}) async => DeviceLocationFound(
      lat,
      lng,
      accuracyMeters: 12,
      fixedAt: DateTime.now(),
      isApproximate: approximate,
    );

void main() {
  group('City matching', () {
    String? best(String query) {
      final found = matchPlaces(query, placesFor(const []));
      return found.isEmpty ? null : found.first.name;
    }

    test('short names people really use', () {
      expect(best('kl'), 'Kuala Lumpur');
      expect(best('KL'), 'Kuala Lumpur');
      expect(best('pj'), 'Petaling Jaya');
      expect(best('jb'), 'Johor Bahru');
      expect(best('kk'), 'Kota Kinabalu');
    });

    test('Penang under either name', () {
      expect(best('penang'), 'Penang');
      expect(best('pulau pinang'), 'Penang');
      expect(best('PULAU PINANG'), 'Penang');
    });

    test('typos, missing spaces and case', () {
      expect(best('kuala lumpr'), 'Kuala Lumpur');
      expect(best('kualalumpur'), 'Kuala Lumpur');
      expect(best('KUALA  LUMPUR'), 'Kuala Lumpur');
      expect(best('petaling jaya'), 'Petaling Jaya');
      expect(best('petalingjaya'), 'Petaling Jaya');
      expect(best('petalng jaya'), 'Petaling Jaya');
      expect(best('penag'), 'Penang');
      expect(best('ipho'), 'Ipoh');
      expect(best('george twon'), 'George Town');
    });

    test('partly typed', () {
      expect(best('kuala l'), 'Kuala Lumpur');
      expect(best('shah'), 'Shah Alam');
      expect(best('georget'), 'George Town');
    });

    test('a correct name does not drag in near misses', () {
      final names = matchPlaces(
        'klang',
        placesFor(const []),
      ).map((p) => p.name);
      expect(names, contains('Klang'));
      expect(names, isNot(contains('Kluang')));
      expect(names, isNot(contains('Kajang')));
    });

    test('nonsense finds nothing, and very short text is not guessed at', () {
      expect(best('xyzzy'), isNull);
      expect(best(''), isNull);
      expect(best('zq'), isNull);
    });

    test('edit distance counts a swap as one', () {
      expect(editDistance('ipoh', 'ipho'), 1);
      expect(editDistance('penag', 'penang'), 1);
      expect(editDistance('abc', 'abc'), 0);
      expect(editDistance('', 'abc'), 3);
    });

    test('cities on events join the built-in list', () {
      final places = placesFor([_at(city: 'Cheltenham')]);
      expect(matchPlaces('cheltenam', places).first.name, 'Cheltenham');
      // Already covered under another spelling: not listed twice.
      final penang = placesFor([_at(state: 'Pulau Pinang')]);
      expect(
        penang.where((p) => normalizeForSearch(p.name) == 'pulaupinang'),
        isEmpty,
      );
    });

    test('a state includes its cities, under any spelling', () {
      final penang = builtInPlaces.firstWhere((p) => p.name == 'Penang');
      expect(penang.matchesEvent(_at(city: 'George Town')), isTrue);
      expect(penang.matchesEvent(_at(state: 'Pulau Pinang')), isTrue);
      expect(penang.matchesEvent(_at(state: 'Penang')), isTrue);
      expect(penang.matchesEvent(_at(city: 'Ipoh', state: 'Perak')), isFalse);

      final selangor = builtInPlaces.firstWhere((p) => p.name == 'Selangor');
      expect(selangor.matchesEvent(_at(city: 'Petaling Jaya')), isTrue);
    });

    test('Kuala Lumpur matches the way the API writes it', () {
      final kl = builtInPlaces.firstWhere((p) => p.name == 'Kuala Lumpur');
      expect(kl.matchesEvent(_at(state: 'WP Kuala Lumpur')), isTrue);
      expect(kl.matchesEvent(_at(city: 'Kuala Lumpur')), isTrue);
      expect(kl.matchesEvent(_at(city: 'Klang')), isFalse);
    });

    test('typing filters events by place and by text, forgiving typos', () {
      final places = placesFor(const []);
      final inKl = _at(name: 'Spring Rapid', city: 'Kuala Lumpur');
      final atHall = _at(name: 'Autumn Blitz', venue: 'Imaginary Hall');
      expect(eventMatchesQuery(inKl, 'kl', places), isTrue);
      expect(eventMatchesQuery(inKl, 'kuala lumpr', places), isTrue);
      expect(eventMatchesQuery(atHall, 'kl', places), isFalse);
      expect(eventMatchesQuery(atHall, 'imaginary', places), isTrue);
      expect(eventMatchesQuery(atHall, 'imagnary', places), isTrue);
      expect(eventMatchesQuery(inKl, 'rapid spring', places), isTrue);
      expect(eventMatchesQuery(inKl, 'springrapid', places), isTrue);
      expect(eventMatchesQuery(inKl, 'zzz', places), isFalse);
      expect(eventMatchesQuery(inKl, '  ', places), isTrue);
    });

    test('suggestions: places with events first, then events', () {
      final events = [
        _at(name: 'Klang Valley Open', city: 'Klang'),
        _at(name: 'Other', city: 'Ipoh'),
      ];
      final found = suggestionsFor('kl', events);
      expect(found.first.title, 'Klang');
      expect(found.first.eventCount, 1);
      expect(found.map((s) => s.title), contains('Kuala Lumpur'));
      expect(found.last.event?.name, 'Klang Valley Open');
      expect(suggestionsFor('', events), isEmpty);
    });
  });

  group('Event labels', () {
    test('money says RM and an entry fee says Entry', () {
      const paid = MobileEventItem(
        id: 'a',
        entryFeeCents: 3000,
        currency: 'MYR',
      );
      expect(paid.entryLabel, 'Entry RM 30');
      expect(paid.feeLabel(), 'RM 30');
      expect(paid.feeLabel(players: 2), 'RM 60');
      expect(formatMoney(1550, 'MYR'), 'RM 15.50');
      expect(formatMoney(1000, 'GBP'), 'GBP 10');
      expect(
        const MobileEventItem(id: 'a', entryFeeCents: 0).entryLabel,
        'Free',
      );
      expect(const MobileEventItem(id: 'a').entryLabel, 'Entry not listed');
    });

    test('a limit is never shown as a count', () {
      expect(
        const MobileEventItem(
          id: 'a',
          registeredCount: 8,
          maxParticipants: 64,
        ).playersLabel,
        '8 confirmed · 64 places',
      );
      expect(
        const MobileEventItem(id: 'a', registeredCount: 8).playersLabel,
        '8 confirmed',
      );
      expect(
        const MobileEventItem(id: 'a', maxParticipants: 64).playersLabel,
        '64 places',
      );
      expect(
        const MobileEventItem(
          id: 'a',
          registeredCount: 1,
          maxParticipants: 1,
        ).playersLabel,
        '1 confirmed \u00b7 1 place',
      );
      expect(const MobileEventItem(id: 'a').playersLabel, isNull);
    });

    group('deadline', () {
      final now = DateTime(2026, 12, 9, 10);
      MobileEventItem closing(DateTime at, {bool open = true}) =>
          MobileEventItem(
            id: 'a',
            registrationOpen: open,
            registrationDeadline: at.toUtc().toIso8601String(),
          );

      test('days left, by the calendar', () {
        final soon = closing(DateTime(2026, 12, 14, 18)).deadlineAt(now)!;
        expect(soon.text, 'Closes 14 Dec · 5 days left');
        expect(soon.urgency, DeadlineUrgency.calm);
      });

      test('turns urgent under three days', () {
        final three = closing(DateTime(2026, 12, 12, 9)).deadlineAt(now)!;
        expect(three.urgency, DeadlineUrgency.calm);
        final two = closing(DateTime(2026, 12, 11, 9)).deadlineAt(now)!;
        expect(two.text, 'Closes 11 Dec · 2 days left');
        expect(two.urgency, DeadlineUrgency.soon);
        final one = closing(DateTime(2026, 12, 10, 0, 30)).deadlineAt(now)!;
        expect(one.text, 'Closes 10 Dec · 1 day left');
      });

      test('today, with the time', () {
        final today = closing(DateTime(2026, 12, 9, 18)).deadlineAt(now)!;
        expect(today.text, 'Closes today, 6:00 PM');
        expect(today.urgency, DeadlineUrgency.soon);
      });

      test('another year says so', () {
        expect(
          closing(DateTime(2027, 1, 3, 9)).deadlineAt(now)!.text,
          contains('3 Jan 2027'),
        );
      });

      test('closed', () {
        final passed = closing(DateTime(2026, 12, 8)).deadlineAt(now)!;
        expect(passed.text, 'Registration closed');
        expect(passed.urgency, DeadlineUrgency.closed);
        expect(
          const MobileEventItem(id: 'a').deadlineAt(now)!.text,
          'Registration closed',
        );
      });

      test('no deadline, no banner: nothing is invented', () {
        expect(
          const MobileEventItem(
            id: 'a',
            registrationOpen: true,
          ).deadlineAt(now),
          isNull,
        );
      });
    });

    test('distance always reads "away"', () {
      expect(formatDistanceAway(1.94), '1.9 km away');
      expect(formatDistanceAway(0), 'Under 0.1 km away');
      expect(formatDistanceAway(10812.2), '10,812 km away');
      expect(formatDistanceAway(2, approximate: true), 'Under 5 km away');
      expect(formatDistanceAway(12.4, approximate: true), '12 km away');
      expect(formatDistanceAway(245.4, approximate: true), '245 km away');
    });
  });

  group('Near me', () {
    final events = [
      fakeEvent(), // Coordinates near Kuala Lumpur.
      fakeEvent(
        overrides: {
          'id': '00000000-0000-4000-8000-00000000e002',
          'name': 'Second Event With No Pin',
          'latitude': null,
          'longitude': null,
        },
      ),
    ];

    testWidgets('off by default: no distance, no pretend place, no request', (
      tester,
    ) async {
      var asked = 0;
      await _pump(
        tester,
        events,
        locator: ({bool prompt = true}) async {
          asked++;
          return const DeviceLocationProblem('x');
        },
      );
      expect(asked, 0);
      expect(find.byKey(const Key('near-me-off')), findsOneWidget);
      expect(find.byKey(const Key('near-me-dot')), findsNothing);
      expect(find.textContaining('km away'), findsNothing);
      expect(find.textContaining('Near you'), findsNothing);
      expect(find.textContaining('from '), findsNothing);
      expect(find.text('Soonest first'), findsOneWidget);
    });

    testWidgets('a real fix: the place name, a green dot, distance from it', (
      tester,
    ) async {
      await _pump(
        tester,
        events,
        locator: _foundAt(3.15, 101.7),
        namer: (_, _) async => 'Cheltenham',
      );
      await _tapKey(tester, 'near-me-toggle');

      expect(find.text('Near you · Cheltenham'), findsOneWidget);
      expect(find.byKey(const Key('near-me-dot')), findsOneWidget);
      expect(find.text('Updated just now'), findsOneWidget);
      expect(find.textContaining('km away'), findsOneWidget);
      expect(find.text('Nearest first'), findsOneWidget);
    });

    testWidgets('no place name: rounded coordinates and accuracy as proof', (
      tester,
    ) async {
      await _pump(tester, events, locator: _foundAt(51.8994, -2.0783));
      await _tapKey(tester, 'near-me-toggle');

      expect(find.text('Near you · 51.90, -2.08'), findsOneWidget);
      expect(find.text('±12 m · Updated just now'), findsOneWidget);
    });

    testWidgets('the position never leaves the phone', (tester) async {
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({'events': events}),
      });
      await _pump(
        tester,
        events,
        backend: backend,
        locator: _foundAt(3.15, 101.7),
      );
      await _tapKey(tester, 'near-me-toggle');
      await tester.fling(
        find.byType(ListView).first,
        const Offset(0, 600),
        1000,
      );
      await tester.pumpAndSettle();

      for (final request in backend.sent('GET', _eventsPath)) {
        expect(request.url.queryParameters, isNot(contains('lat')));
        expect(request.url.queryParameters, isNot(contains('lng')));
      }
    });

    testWidgets('far away: true distance, and never from a city', (
      tester,
    ) async {
      await _pump(tester, events, locator: _foundAt(51.5, -0.12));
      await _tapKey(tester, 'near-me-toggle');

      expect(
        find.textContaining(RegExp(r'^\d{1,2},\d{3} km away$')),
        findsOneWidget,
      );
      expect(find.textContaining('km from'), findsNothing);
    });

    testWidgets('refused: Location off, a way forward, and no distances', (
      tester,
    ) async {
      var granted = false;
      await _pump(
        tester,
        events,
        locator: ({bool prompt = true}) async => granted
            ? await _foundAt(3.15, 101.7)()
            : const DeviceLocationProblem(
                'Permission not given',
                fix: LocationProblemFix.permission,
              ),
      );
      await _tapKey(tester, 'near-me-toggle');

      expect(find.byKey(const Key('near-me-off')), findsOneWidget);
      expect(find.text('Permission not given'), findsOneWidget);
      expect(find.text('Allow'), findsOneWidget);
      expect(find.textContaining('km away'), findsNothing);

      granted = true;
      await _tapKey(tester, 'near-me-fix');
      expect(find.byKey(const Key('near-me-dot')), findsOneWidget);
      expect(find.textContaining('km away'), findsOneWidget);
    });

    testWidgets('losing the fix clears every distance', (tester) async {
      var works = true;
      await _pump(
        tester,
        events,
        locator: ({bool prompt = true}) async => works
            ? await _foundAt(3.15, 101.7)()
            : const DeviceLocationProblem('No GPS fix yet'),
      );
      await _tapKey(tester, 'near-me-toggle');
      expect(find.textContaining('km away'), findsOneWidget);

      works = false;
      await _tapKey(tester, 'near-me-refresh');
      expect(find.textContaining('km away'), findsNothing);
      expect(find.byKey(const Key('near-me-off')), findsOneWidget);
      expect(find.text('No GPS fix yet'), findsOneWidget);
    });

    testWidgets('turning it off clears the position', (tester) async {
      await _pump(tester, events, locator: _foundAt(3.15, 101.7));
      await _tapKey(tester, 'near-me-toggle');
      await _tapKey(tester, 'near-me-toggle');

      expect(find.textContaining('km away'), findsNothing);
      expect(find.byKey(const Key('near-me-off')), findsOneWidget);
    });

    testWidgets('approximate: says so, offers precise, shows no false detail', (
      tester,
    ) async {
      var asked = 0;
      await _pump(
        tester,
        events,
        locator: _foundAt(3.15, 101.7, approximate: true),
        onPrecise: () => asked++,
      );
      await _tapKey(tester, 'near-me-toggle');

      expect(find.textContaining('Approximate'), findsOneWidget);
      expect(find.text('Under 5 km away'), findsNothing);
      expect(find.textContaining(RegExp(r'^\d+ km away$')), findsOneWidget);
      await _tapKey(tester, 'near-me-precise');
      expect(asked, 1);
    });

    testWidgets('reopening: back on with no dialog, and no position stored', (
      tester,
    ) async {
      final preferences = MemoryPreferences();
      var prompted = false;
      Future<DeviceLocationResult> locate({bool prompt = true}) async {
        prompted = prompted || prompt;
        return DeviceLocationFound(3.15, 101.7, fixedAt: DateTime.now());
      }

      await _pump(tester, events, locator: locate, preferences: preferences);
      expect(preferences.nearMe, isFalse);
      await _tapKey(tester, 'near-me-toggle');
      expect(preferences.nearMe, isTrue);

      prompted = false;
      await _pump(tester, events, locator: locate, preferences: preferences);
      // A new app instance restores from the saved flag.
      expect(prompted, isFalse);
      expect(find.byKey(const Key('near-me-dot')), findsOneWidget);
    });

    testWidgets('survives changing tab', (tester) async {
      await _pump(tester, events, locator: _foundAt(3.15, 101.7));
      await _tapKey(tester, 'near-me-toggle');
      await tester.tap(find.text('Career'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Discover'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('near-me-dot')), findsOneWidget);
    });

    test('freshness reads naturally', () {
      final now = DateTime(2026, 1, 1, 12);
      expect(freshnessLabel(now, now), 'Updated just now');
      expect(
        freshnessLabel(now.subtract(const Duration(minutes: 5)), now),
        'Updated 5 min ago',
      );
      expect(
        freshnessLabel(now.subtract(const Duration(hours: 2)), now),
        'Updated 2 h ago',
      );
    });

    test('a place name takes the most specific part there is', () {
      expect(
        placeNameFrom([null, '  ', 'Cheltenham', 'England']),
        'Cheltenham',
      );
      expect(placeNameFrom([null, '']), isNull);
    });
  });

  group('Discover search', () {
    final events = [
      fakeEvent(
        overrides: {
          'name': 'Pretend Lumpur Open',
          'city': 'Kuala Lumpur',
          'state': 'WP Kuala Lumpur',
        },
      ),
      fakeEvent(
        overrides: {
          'id': '00000000-0000-4000-8000-00000000e002',
          'name': 'Pretend Island Rapid',
          'city': 'George Town',
          'state': 'Pulau Pinang',
        },
      ),
    ];

    testWidgets('has no location dropdown', (tester) async {
      await _pump(tester, events);
      expect(find.byKey(const Key('city-picker')), findsNothing);
      expect(find.textContaining('Search near'), findsNothing);
      expect(find.textContaining('your location'), findsNothing);
    });

    testWidgets('a typo suggests the city, and choosing it filters', (
      tester,
    ) async {
      await _pump(tester, events);
      await tester.enterText(
        find.byKey(const Key('event-search')),
        'pulau pinan',
      );
      await tester.pumpAndSettle();

      final dropdown = find.byKey(const Key('search-suggestions'));
      expect(dropdown, findsOneWidget);
      await tester.tap(
        find.descendant(of: dropdown, matching: find.text('Penang')),
      );
      await tester.pumpAndSettle();

      expect(find.text('Tournaments (1)'), findsOneWidget);
      expect(find.text('Pretend Island Rapid'), findsOneWidget);
      expect(find.text('Pretend Lumpur Open'), findsNothing);
      expect(find.byKey(const Key('search-suggestions')), findsNothing);

      await tester.tap(find.byTooltip('Clear search'));
      await tester.pumpAndSettle();
      expect(find.text('Tournaments (2)'), findsOneWidget);
    });

    testWidgets('tapping away closes the dropdown and keeps the filter', (
      tester,
    ) async {
      await _pump(tester, events);
      await tester.enterText(find.byKey(const Key('event-search')), 'penang');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('search-suggestions')), findsOneWidget);

      await tester.tapAt(const Offset(270, 1100));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('search-suggestions')), findsNothing);
      expect(find.text('Tournaments (1)'), findsOneWidget);
    });

    testWidgets('no matches offers a way back', (tester) async {
      await _pump(tester, events);
      await tester.enterText(find.byKey(const Key('event-search')), 'zzzzzz');
      await tester.pumpAndSettle();
      expect(find.text('No matches'), findsOneWidget);
      await tester.tap(find.text('Clear filters'));
      await tester.pumpAndSettle();
      expect(find.text('Tournaments (2)'), findsOneWidget);
    });
  });

  group('Event card', () {
    testWidgets('clear labels, on the card and the event page', (tester) async {
      final deadline = DateTime.now().add(const Duration(days: 10));
      final event = fakeEvent(
        entryFeeCents: 3000,
        overrides: {
          'currency': 'MYR',
          'registeredCount': 8,
          'maxParticipants': 64,
          'registrationDeadline': deadline.toUtc().toIso8601String(),
        },
      );
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({
          'events': [event],
        }),
        'GET $_eventsPath/fake-open': (_) =>
            jsonResponse(fakeEventDetail(event)),
      });
      await _pump(tester, [event], backend: backend);

      expect(find.text('Entry RM 30'), findsOneWidget);
      expect(find.text('8 confirmed · 64 places'), findsOneWidget);
      expect(find.textContaining('MYR'), findsNothing);
      expect(find.textContaining('10 days left'), findsOneWidget);

      await tester.tap(find.text('View & Register'));
      await tester.pumpAndSettle();
      expect(find.text('8 confirmed · 64 places'), findsOneWidget);
      expect(find.textContaining('10 days left'), findsOneWidget);
      expect(find.textContaining('MYR'), findsNothing);
    });

    testWidgets('no deadline, no banner', (tester) async {
      await _pump(tester, [fakeEvent()]);
      expect(find.byKey(const Key('deadline-banner')), findsNothing);
    });
  });

  group('Map', () {
    final events = [
      fakeEvent(),
      fakeEvent(
        overrides: {
          'id': '00000000-0000-4000-8000-00000000e002',
          'name': 'Same Hall Event',
        },
      ),
      fakeEvent(
        overrides: {
          'id': '00000000-0000-4000-8000-00000000e003',
          'name': 'No Pin Event',
          'latitude': null,
          'longitude': null,
        },
      ),
    ];

    testWidgets('list by default; pins, credit and a count of the rest', (
      tester,
    ) async {
      MapSurfaceConfig? shown;
      await _pump(
        tester,
        events,
        surface: (config) {
          shown = config;
          return const SizedBox.shrink();
        },
      );
      expect(shown, isNull);
      expect(find.text('Tournaments (3)'), findsOneWidget);

      await _openMap(tester);
      expect(shown!.pins, hasLength(2));
      expect(shown!.user, isNull);
      expect(find.text('1 not on the map'), findsOneWidget);
      expect(find.text(mapAttribution), findsOneWidget);
      expect(mapAttribution, contains('OpenStreetMap'));
      // No blue dot to go to without a real position.
      expect(find.byKey(const Key('map-go-to-me')), findsNothing);

      expect(find.byKey(const Key('map-loading')), findsOneWidget);
      shown!.onTilesShown();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('map-loading')), findsNothing);
    });

    testWidgets('a real fix reaches the map; filters do too', (tester) async {
      MapSurfaceConfig? shown;
      await _pump(
        tester,
        events,
        locator: _foundAt(3.15, 101.7),
        surface: (config) {
          shown = config;
          return const SizedBox.shrink();
        },
      );
      await _tapKey(tester, 'near-me-toggle');
      await _openMap(tester);
      expect(shown!.user!.latitude, 3.15);
      expect(find.byKey(const Key('map-go-to-me')), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('event-search')),
        'Same Hall',
      );
      await tester.pumpAndSettle();
      expect(shown!.pins.map((p) => p.eventId), [
        '00000000-0000-4000-8000-00000000e002',
      ]);
    });

    testWidgets('a pin opens a short card, and its button the event', (
      tester,
    ) async {
      final paid = fakeEvent(
        entryFeeCents: 3000,
        overrides: {
          'currency': 'MYR',
          'registrationDeadline': DateTime.now()
              .add(const Duration(days: 10))
              .toUtc()
              .toIso8601String(),
        },
      );
      MapSurfaceConfig? shown;
      final backend = FakeBackend({
        'GET $_eventsPath': (_) => jsonResponse({
          'events': [paid],
        }),
        'GET $_eventsPath/fake-open': (_) =>
            jsonResponse(fakeEventDetail(paid)),
      });
      await _pump(
        tester,
        [paid],
        backend: backend,
        locator: _foundAt(3.15, 101.7),
        surface: (config) {
          shown = config;
          return const SizedBox.shrink();
        },
      );
      await _tapKey(tester, 'near-me-toggle');
      await _openMap(tester);

      shown!.onPinsTapped([fakeEventId]);
      await tester.pumpAndSettle();
      expect(find.text('Fake Open Test Event'), findsOneWidget);
      expect(find.textContaining('km away'), findsOneWidget);
      expect(find.text('Entry RM 30'), findsOneWidget);
      expect(find.textContaining('10 days left'), findsOneWidget);

      await _tapKey(tester, 'map-open-$fakeEventId');
      expect(find.text('Event'), findsOneWidget);
    });

    testWidgets('no distance on the card without a real position', (
      tester,
    ) async {
      MapSurfaceConfig? shown;
      await _pump(
        tester,
        events,
        surface: (config) {
          shown = config;
          return const SizedBox.shrink();
        },
      );
      await _openMap(tester);
      shown!.onPinsTapped([fakeEventId]);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('map-event-card')), findsOneWidget);
      expect(find.textContaining('km away'), findsNothing);
    });

    testWidgets('far from every pin, it says how far and can show them', (
      tester,
    ) async {
      await _pump(tester, events, locator: _foundAt(51.5, -0.12));
      await _tapKey(tester, 'near-me-toggle');
      await _openMap(tester);
      expect(find.byKey(const Key('map-nearest')), findsOneWidget);
      expect(
        find.textContaining(RegExp(r'^Nearest .* km away$')),
        findsOneWidget,
      );
    });

    testWidgets('if the style cannot load, back to the list with a line', (
      tester,
    ) async {
      await _pump(
        tester,
        events,
        style: ({required bool sunlight}) async =>
            throw const MapStyleException('offline'),
      );
      await _openMap(tester);
      expect(find.byKey(const Key('map-unavailable')), findsOneWidget);
      expect(find.text('Tournaments (3)'), findsOneWidget);
    });

    testWidgets('if tiles fail later, back to the list with a line', (
      tester,
    ) async {
      MapSurfaceConfig? shown;
      await _pump(
        tester,
        events,
        surface: (config) {
          shown = config;
          return const SizedBox.shrink();
        },
      );
      await _openMap(tester);
      expect(find.byKey(const Key('map-loading')), findsOneWidget);
      shown!.onFailed();
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('map-unavailable')), findsOneWidget);
      expect(find.text('Tournaments (3)'), findsOneWidget);
    });

    test('pins leave out events with no coordinates', () {
      final found = pinsFor([
        const MobileEventItem(id: 'a', latitude: 1, longitude: 2),
        const MobileEventItem(id: 'b', latitude: 1),
        const MobileEventItem(id: 'c'),
      ]);
      expect(found.map((p) => p.eventId), ['a']);
    });

    test('GeoJSON is longitude first', () {
      final json = pinsGeoJson(const [MapPin('a', 3.1, 101.7)]);
      final feature = (json['features'] as List).single as Map;
      expect((feature['geometry'] as Map)['coordinates'], [101.7, 3.1]);
      expect((feature['properties'] as Map)['eventId'], 'a');
    });

    test('a shared venue offers every event there', () {
      const pins = [MapPin('a', 1, 2), MapPin('b', 1, 2), MapPin('c', 3, 4)];
      expect(eventsAtSameSpot('a', pins), ['a', 'b']);
      expect(eventsAtSameSpot('c', pins), ['c']);
      expect(eventsAtSameSpot('gone', pins), isEmpty);
    });

    test('the map follows a jump, but not GPS drift', () {
      const here = DeviceLocationFound(3.15, 101.7);
      expect(userMovedFar(null, here), isTrue);
      expect(
        userMovedFar(here, const DeviceLocationFound(3.1501, 101.7001)),
        isFalse,
      );
      expect(
        userMovedFar(here, const DeviceLocationFound(5.41, 100.33)),
        isTrue,
      );
    });
  });

  group('Map style', () {
    const style =
        '{"sources":{"openmaptiles":{"type":"vector","url":"https://tiles.test/planet"}},'
        '"layers":[{"id":"background","paint":{"background-color":"#000"}},'
        '{"id":"water","paint":{}},{"id":"other","paint":{"fill-color":"#123"}}]}';

    Map<String, (String, String)> paint() => forestMapPaint(
      land: '#111111',
      water: '#222222',
      green: '#333333',
      label: '#444444',
    );

    test('recolours what it knows, and leaves the rest', () {
      final out = jsonDecode(recolourStyle(style, paint())) as Map;
      final layers = {
        for (final l in out['layers'] as List) l['id']: l['paint'],
      };
      expect(layers['background'], {'background-color': '#111111'});
      expect(layers['water'], {'fill-color': '#222222'});
      expect(layers['other'], {'fill-color': '#123'});
    });

    test('rejects something that is not a style', () {
      expect(
        () => recolourStyle('[]', paint()),
        throwsA(isA<MapStyleException>()),
      );
    });

    test('finds the tile server', () {
      expect(vectorSourceUrl(style), 'https://tiles.test/planet');
      expect(vectorSourceUrl('{}'), isNull);
    });

    MockClient client(int styleStatus, int tilesStatus) =>
        MockClient((request) async {
          return request.url.path.endsWith('planet')
              ? http.Response('{}', tilesStatus)
              : http.Response(style, styleStatus);
        });

    test('uses the free dark style, recoloured, for Alokas green', () async {
      Uri? asked;
      final out = await fetchMapStyle(
        sunlight: false,
        forestPaint: paint(),
        client: MockClient((request) async {
          asked ??= request.url;
          return request.url.path.endsWith('planet')
              ? http.Response('{}', 200)
              : http.Response(style, 200);
        }),
      );
      expect(asked.toString(), 'https://tiles.openfreemap.org/styles/dark');
      expect(out, contains('#111111'));
    });

    test('fails when the style or the tile server does', () async {
      await expectLater(
        fetchMapStyle(
          sunlight: false,
          forestPaint: paint(),
          client: client(500, 200),
        ),
        throwsA(isA<MapStyleException>()),
      );
      await expectLater(
        fetchMapStyle(
          sunlight: false,
          forestPaint: paint(),
          client: client(200, 503),
        ),
        throwsA(isA<MapStyleException>()),
      );
    });
  });

  testWidgets('the app bar shows the crown, not a trophy', (tester) async {
    await _pump(tester, const []);
    expect(find.byKey(const Key('brand-crown')), findsOneWidget);
    expect(find.byIcon(Icons.emoji_events), findsNothing);
  });
}
