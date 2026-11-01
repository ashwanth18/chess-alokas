import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Small choices the app remembers between launches.
abstract class AppPreferences {
  Future<String?> readCityId();
  Future<void> writeCityId(String id);
}

class SecureAppPreferences implements AppPreferences {
  static const String _cityKey = 'chosen_city_v1';

  final FlutterSecureStorage _storage;

  const SecureAppPreferences([this._storage = const FlutterSecureStorage()]);

  @override
  Future<String?> readCityId() => _storage.read(key: _cityKey);

  @override
  Future<void> writeCityId(String id) =>
      _storage.write(key: _cityKey, value: id);
}
