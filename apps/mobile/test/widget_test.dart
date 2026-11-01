import 'package:chess_alokas_mobile/main.dart';
import 'package:chess_alokas_mobile/models/models.dart';
import 'package:chess_alokas_mobile/services/alokas_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Chess Alokas Mobile — Unit & Widget Tests', () {
    test('Haversine distance and age-group category auto-matching work accurately', () {
      // Kuala Lumpur (3.1390, 101.6869) to Bangsar South (3.1142, 101.6634) ~ 3.8 km
      final distKlToBangsar = haversineDistanceKm(
        3.1390,
        101.6869,
        3.1142,
        101.6634,
      );
      expect(distKlToBangsar, greaterThan(2.0));
      expect(distKlToBangsar, lessThan(6.0));

      final profiles = AlokasApiClient.seedFamilyProfiles();
      final events = AlokasApiClient.seedEvents();
      final arccCategories = events.first.categories;

      final aarav = profiles.firstWhere((p) => p.username == 'aarav_u12');
      expect(aarav.matchCategory(arccCategories).code, equals('U12'));

      final meera = profiles.firstWhere((p) => p.username == 'meera_u8');
      expect(meera.matchCategory(arccCategories).code, equals('U8'));

      final ashwanth = profiles.firstWhere((p) => p.username == 'ashwanth');
      expect(ashwanth.matchCategory(arccCategories).code, equals('Open'));
    });

    testWidgets(
      'Renders Discover tab with GPS nearby events and completes 1-Tap Family Registration',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(1080, 2400);
        tester.view.devicePixelRatio = 2.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final offlineApi = AlokasApiClient(enableNetwork: false);
        await tester.pumpWidget(ChessAlokasMobileApp(apiClient: offlineApi));
        await tester.pumpAndSettle();

        expect(find.text('Chess Alokas'), findsOneWidget);
        expect(find.textContaining('NEARBY TOURNAMENTS'), findsOneWidget);
        expect(
          find.textContaining('ARCC Kuala Lumpur Junior & Open Rapid Championship 2026'),
          findsOneWidget,
        );
        expect(find.textContaining('km away'), findsWidgets);

        // Open 1-Tap Registration Bottom Sheet
        final registerBtn = find.text('View & 1-Tap Register').first;
        await tester.ensureVisible(registerBtn);
        await tester.tap(registerBtn);
        await tester.pumpAndSettle();

        expect(
          find.text('1-TAP FAMILY & PLAYER PROFILE AUTOFILL'),
          findsOneWidget,
        );
        expect(
          find.textContaining('Auto-Matched: Under 12 (U12)'),
          findsOneWidget,
        );

        // Scroll and submit 1-Tap Registration
        final confirmFinder = find.textContaining('Confirm 1-Tap Registration');
        await tester.ensureVisible(confirmFinder);
        await tester.tap(confirmFinder);
        await tester.pumpAndSettle();

        expect(
          find.textContaining('Registered (Aarav Ashwanth)'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'Switches to Matchday tab, shows Next Match board hero card and Morning Check-In QR Pass',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(1080, 2400);
        tester.view.devicePixelRatio = 2.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final offlineApi = AlokasApiClient(enableNetwork: false);
        await tester.pumpWidget(ChessAlokasMobileApp(apiClient: offlineApi));
        await tester.pumpAndSettle();

        await tester.tap(find.text('Matchday'));
        await tester.pumpAndSettle();

        expect(find.text('ACTIVE FAMILY PLAYERS TODAY'), findsOneWidget);
        expect(find.text('LIVE ROUND 3 OF 6'), findsOneWidget);
        expect(find.text('#4'), findsWidgets);
        expect(find.text('WHITE'), findsOneWidget);
        expect(
          find.textContaining('Opponent: Danish Hakim (1448)'),
          findsOneWidget,
        );

        // Open Morning Check-In QR Pass Modal
        await tester.tap(find.text('QR Pass'));
        await tester.pumpAndSettle();

        expect(find.text('Morning Check-In QR Pass'), findsOneWidget);
        expect(
          find.text('Checked In for Round 1 Roll Call'),
          findsOneWidget,
        );

        await tester.tap(find.text('Done'));
        await tester.pumpAndSettle();
      },
    );

    testWidgets(
      'Switches to Career & Certs tab, renders ratings and opens Digital Certificate preview',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(1080, 2400);
        tester.view.devicePixelRatio = 2.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final offlineApi = AlokasApiClient(enableNetwork: false);
        await tester.pumpWidget(ChessAlokasMobileApp(apiClient: offlineApi));
        await tester.pumpAndSettle();

        await tester.tap(find.text('Career & Certs'));
        await tester.pumpAndSettle();

        expect(find.text('ALOKAS RATING'), findsOneWidget);
        expect(find.text('1460'), findsWidgets);

        final certSerialFinder = find.text('ARCC/001/2026');
        await tester.ensureVisible(certSerialFinder);
        expect(certSerialFinder, findsOneWidget);

        final previewBtn = find.text('Preview Certificate').first;
        await tester.ensureVisible(previewBtn);
        await tester.tap(previewBtn);
        await tester.pumpAndSettle();

        expect(
          find.text('CHESS ALOKAS OFFICIAL CERTIFICATE'),
          findsOneWidget,
        );
        expect(find.text('CERTIFICATE OF EXCELLENCE'), findsOneWidget);

        await tester.tap(find.text('Verified Authentic'));
        await tester.pumpAndSettle();
      },
    );

    testWidgets(
      'Switches to Family & Auth tab and adds a new child sub-profile',
      (WidgetTester tester) async {
        tester.view.physicalSize = const Size(1080, 2400);
        tester.view.devicePixelRatio = 2.0;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);

        final offlineApi = AlokasApiClient(enableNetwork: false);
        await tester.pumpWidget(ChessAlokasMobileApp(apiClient: offlineApi));
        await tester.pumpAndSettle();

        await tester.tap(find.text('Family & Auth'));
        await tester.pumpAndSettle();

        expect(
          find.text('MANAGED FAMILY & STUDENT PROFILES (3)'),
          findsOneWidget,
        );

        await tester.tap(find.byKey(const Key('open-add-profile-button')));
        await tester.pumpAndSettle();

        await tester.enterText(
          find.byKey(const Key('add-profile-fullname')),
          'Kabir Ashwanth',
        );
        await tester.enterText(
          find.byKey(const Key('add-profile-username')),
          'kabir_u10',
        );
        await tester.tap(find.byKey(const Key('save-profile-button')));
        await tester.pumpAndSettle();

        expect(
          find.text('MANAGED FAMILY & STUDENT PROFILES (4)'),
          findsOneWidget,
        );
        expect(find.text('Kabir Ashwanth'), findsOneWidget);
      },
    );
  });
}
