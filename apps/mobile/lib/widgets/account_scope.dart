import 'package:flutter/widgets.dart';

import '../models/draft.dart';
import '../models/models.dart';

/// Which page the sign-in screen opens on.
enum AuthStart { signIn, createAccount }

/// Opens the full-screen sign-in. Completes with true once someone is signed
/// in, and false if they went back.
typedef OpenAuth = Future<bool> Function({AuthStart start, String? email});

/// The signed-in account as pages pushed over the tabs see it. It sits above
/// the navigator, so an event page that was open before sign-in sees the
/// account straight after, and can carry on with what the person was doing.
class AccountScope extends InheritedWidget {
  final bool signedIn;
  final List<MobilePlayerProfile> profiles;

  /// True once this account's players are known, from the server or this
  /// phone's copy, or their load has failed.
  final bool profilesSettled;

  /// Why [profiles] cannot be trusted right now: still loading, or the error.
  final String? profilesUnavailable;
  final Map<String, List<RegistrationRecord>> registrationsByEvent;
  final List<RegistrationDraft> drafts;
  final String? accountKey;
  final bool authAvailable;
  final OpenAuth openAuth;

  const AccountScope({
    super.key,
    required this.signedIn,
    required this.profiles,
    required this.profilesSettled,
    required this.profilesUnavailable,
    required this.registrationsByEvent,
    required this.drafts,
    required this.accountKey,
    required this.authAvailable,
    required this.openAuth,
    required super.child,
  });

  static AccountScope of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AccountScope>();
    assert(scope != null, 'No AccountScope above this page.');
    return scope!;
  }

  RegistrationDraft? draftFor(String eventId) =>
      drafts.where((d) => d.eventId == eventId).firstOrNull;

  @override
  bool updateShouldNotify(AccountScope old) =>
      signedIn != old.signedIn ||
      profiles != old.profiles ||
      profilesSettled != old.profilesSettled ||
      profilesUnavailable != old.profilesUnavailable ||
      registrationsByEvent != old.registrationsByEvent ||
      drafts != old.drafts ||
      accountKey != old.accountKey ||
      authAvailable != old.authAvailable;
}
