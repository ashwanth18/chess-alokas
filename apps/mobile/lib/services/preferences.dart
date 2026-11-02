import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// How someone last entered the app, so the welcome screen shows only once.
enum EntryChoice {
  /// Chose to browse tournaments without an account.
  guest,

  /// Signed in. With no session at launch, the sign-in has ended.
  member;

  static EntryChoice? fromName(String? name) =>
      EntryChoice.values.where((c) => c.name == name).firstOrNull;
}

/// Small choices the app remembers between launches.
abstract class AppPreferences {
  /// Only whether Near me was left on. A position is never stored.
  Future<bool> readNearMe();
  Future<void> writeNearMe(bool on);
  Future<String?> readThemeName();
  Future<void> writeThemeName(String name);

  /// Null on first launch and after signing out.
  Future<EntryChoice?> readEntry();
  Future<void> writeEntry(EntryChoice? choice);
}

class SecureAppPreferences implements AppPreferences {
  static const String _nearMeKey = 'near_me_v1';
  static const String _themeKey = 'theme_v1';
  static const String _entryKey = 'entry_v1';

  final FlutterSecureStorage _storage;

  const SecureAppPreferences([this._storage = const FlutterSecureStorage()]);

  @override
  Future<bool> readNearMe() async =>
      await _storage.read(key: _nearMeKey) == 'on';

  @override
  Future<void> writeNearMe(bool on) =>
      _storage.write(key: _nearMeKey, value: on ? 'on' : 'off');

  @override
  Future<String?> readThemeName() => _storage.read(key: _themeKey);

  @override
  Future<void> writeThemeName(String name) =>
      _storage.write(key: _themeKey, value: name);

  @override
  Future<EntryChoice?> readEntry() async =>
      EntryChoice.fromName(await _storage.read(key: _entryKey));

  @override
  Future<void> writeEntry(EntryChoice? choice) => choice == null
      ? _storage.delete(key: _entryKey)
      : _storage.write(key: _entryKey, value: choice.name);
}
