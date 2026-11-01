import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Small choices the app remembers between launches.
abstract class AppPreferences {
  Future<String?> readCityId();
  Future<void> writeCityId(String id);
  Future<String?> readThemeName();
  Future<void> writeThemeName(String name);
}

class SecureAppPreferences implements AppPreferences {
  static const String _cityKey = 'chosen_city_v1';
  static const String _themeKey = 'theme_v1';

  final FlutterSecureStorage _storage;

  const SecureAppPreferences([this._storage = const FlutterSecureStorage()]);

  @override
  Future<String?> readCityId() => _storage.read(key: _cityKey);

  @override
  Future<void> writeCityId(String id) =>
      _storage.write(key: _cityKey, value: id);

  @override
  Future<String?> readThemeName() => _storage.read(key: _themeKey);

  @override
  Future<void> writeThemeName(String name) =>
      _storage.write(key: _themeKey, value: name);
}
