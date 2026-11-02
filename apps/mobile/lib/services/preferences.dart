import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Small choices the app remembers between launches.
abstract class AppPreferences {
  /// Only whether Near me was left on. A position is never stored.
  Future<bool> readNearMe();
  Future<void> writeNearMe(bool on);
  Future<String?> readThemeName();
  Future<void> writeThemeName(String name);
}

class SecureAppPreferences implements AppPreferences {
  static const String _nearMeKey = 'near_me_v1';
  static const String _themeKey = 'theme_v1';

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
}
