import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Where the signed-in session is kept between launches.
abstract class SessionStorage {
  Future<String?> read();
  Future<void> write(String value);
  Future<void> delete();
}

class SecureSessionStorage implements SessionStorage {
  static const String _key = 'auth_session_v1';

  final FlutterSecureStorage _storage;

  const SecureSessionStorage([this._storage = const FlutterSecureStorage()]);

  @override
  Future<String?> read() => _storage.read(key: _key);

  @override
  Future<void> write(String value) => _storage.write(key: _key, value: value);

  @override
  Future<void> delete() => _storage.delete(key: _key);
}
