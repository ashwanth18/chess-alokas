import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';

import '../models/draft.dart';

/// App-private files for the offline copy and registration drafts. A failure
/// here only means nothing is remembered, so callers treat errors as "no data".
abstract class LocalStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<Uint8List?> readBytes(String key);
  Future<void> writeBytes(String key, Uint8List bytes);
  Future<void> delete(String key);
  Future<List<String>> keysWithPrefix(String prefix);
}

class FileLocalStore implements LocalStore {
  const FileLocalStore();

  Future<Directory> _dir() async {
    final base = await getApplicationSupportDirectory();
    final dir = Directory('${base.path}/alokas_store');
    if (!dir.existsSync()) await dir.create(recursive: true);
    return dir;
  }

  File _file(Directory dir, String key) => File('${dir.path}/$key');

  /// Written beside the target and renamed, so a kill mid-write leaves the
  /// previous copy intact.
  Future<void> _atomic(File target, Future<void> Function(File) write) async {
    final temp = File('${target.path}.tmp');
    await write(temp);
    await temp.rename(target.path);
  }

  @override
  Future<String?> read(String key) async {
    final file = _file(await _dir(), key);
    return file.existsSync() ? file.readAsString() : null;
  }

  @override
  Future<void> write(String key, String value) async {
    final target = _file(await _dir(), key);
    await _atomic(target, (temp) => temp.writeAsString(value, flush: true));
  }

  @override
  Future<Uint8List?> readBytes(String key) async {
    final file = _file(await _dir(), key);
    return file.existsSync() ? file.readAsBytes() : null;
  }

  @override
  Future<void> writeBytes(String key, Uint8List bytes) async {
    final target = _file(await _dir(), key);
    await _atomic(target, (temp) => temp.writeAsBytes(bytes, flush: true));
  }

  @override
  Future<void> delete(String key) async {
    final file = _file(await _dir(), key);
    if (file.existsSync()) await file.delete();
  }

  @override
  Future<List<String>> keysWithPrefix(String prefix) async {
    final dir = await _dir();
    return dir
        .listSync()
        .whereType<File>()
        .map((f) => f.uri.pathSegments.last)
        .where((name) => name.startsWith(prefix) && !name.endsWith('.tmp'))
        .toList();
  }
}

String _safe(String value) => value.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');

/// A cached value and when it came from the server.
class Cached<T> {
  final T value;
  final DateTime savedAt;

  const Cached(this.value, this.savedAt);
}

/// The last matchday and events, so a parent at a venue with bad signal still
/// sees the board, always with its "as of" time. Raw API JSON is stored and read
/// back through the same parsers as a live response.
class OfflineCache {
  final LocalStore _store;

  const OfflineCache(this._store);

  String _accountKey(String account, String kind) =>
      'cache_${_safe(account)}_$kind.json';

  Future<void> _put(String key, Object? value, DateTime at) async {
    try {
      await _store.write(
        key,
        jsonEncode({'savedAt': at.toUtc().toIso8601String(), 'value': value}),
      );
    } on Object {
      // Not remembered this time.
    }
  }

  Future<Cached<Object?>?> _get(String key) async {
    try {
      final raw = await _store.read(key);
      if (raw == null) return null;
      final json = jsonDecode(raw);
      final savedAt = DateTime.tryParse(json['savedAt'] as String);
      return savedAt == null ? null : Cached(json['value'], savedAt);
    } on Object {
      return null;
    }
  }

  Future<void> saveEvents(Object? rows, DateTime at) =>
      _put('cache_events.json', rows, at);
  Future<Cached<Object?>?> loadEvents() => _get('cache_events.json');

  Future<void> saveProfiles(String account, Object? rows, DateTime at) =>
      _put(_accountKey(account, 'profiles'), rows, at);
  Future<Cached<Object?>?> loadProfiles(String account) =>
      _get(_accountKey(account, 'profiles'));

  Future<void> saveSelectedProfile(String account, String id, DateTime at) =>
      _put(_accountKey(account, 'selected'), id, at);
  Future<Cached<Object?>?> loadSelectedProfile(String account) =>
      _get(_accountKey(account, 'selected'));

  Future<void> saveDashboard(
    String account,
    String profileId,
    Object? json,
    DateTime at,
  ) => _put(_accountKey(account, 'dashboard_${_safe(profileId)}'), json, at);
  Future<Cached<Object?>?> loadDashboard(String account, String profileId) =>
      _get(_accountKey(account, 'dashboard_${_safe(profileId)}'));

  Future<void> saveLive(
    String account,
    String token,
    Object? json,
    DateTime at,
  ) => _put(_accountKey(account, 'live_${_safe(token)}'), json, at);
  Future<Cached<Object?>?> loadLive(String account, String token) =>
      _get(_accountKey(account, 'live_${_safe(token)}'));

  /// Children's names and boards do not stay after signing out.
  Future<void> clearAccounts() async {
    try {
      for (final key in await _store.keysWithPrefix('cache_')) {
        if (key != 'cache_events.json') await _store.delete(key);
      }
    } on Object {
      // Nothing more to do.
    }
  }
}

/// Registration drafts, saved at every change, so that a phone killing the app
/// during the trip to the banking app loses nothing.
class DraftStore {
  final LocalStore _store;

  const DraftStore(this._store);

  String _prefix(String account) => 'draft_${_safe(account)}_';
  String _key(String account, String eventId) =>
      '${_prefix(account)}${_safe(eventId)}.json';
  String _receiptKey(String account, String eventId) =>
      '${_prefix(account)}${_safe(eventId)}.receipt';

  Future<void> save(RegistrationDraft draft) async {
    try {
      await _store.write(
        _key(draft.accountKey, draft.eventId),
        jsonEncode(draft.toJson()),
      );
    } on Object {
      // The form still works; it just would not survive a kill.
    }
  }

  Future<List<RegistrationDraft>> loadAll(String account) async {
    try {
      final drafts = <RegistrationDraft>[];
      for (final key in await _store.keysWithPrefix(_prefix(account))) {
        if (!key.endsWith('.json')) continue;
        final raw = await _store.read(key);
        final draft = raw == null ? null : RegistrationDraft.tryDecode(raw);
        if (draft != null) drafts.add(draft);
      }
      drafts.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
      return drafts;
    } on Object {
      return const [];
    }
  }

  Future<void> saveReceipt(
    String account,
    String eventId,
    Uint8List bytes,
  ) async {
    try {
      await _store.writeBytes(_receiptKey(account, eventId), bytes);
    } on Object {
      // The receipt stays in memory for this run.
    }
  }

  Future<Uint8List?> loadReceipt(String account, String eventId) async {
    try {
      return await _store.readBytes(_receiptKey(account, eventId));
    } on Object {
      return null;
    }
  }

  Future<void> deleteReceipt(String account, String eventId) async {
    try {
      await _store.delete(_receiptKey(account, eventId));
    } on Object {
      // Nothing more to do.
    }
  }

  Future<void> delete(String account, String eventId) async {
    try {
      await _store.delete(_key(account, eventId));
      await _store.delete(_receiptKey(account, eventId));
    } on Object {
      // Nothing more to do.
    }
  }

  Future<void> clearAll() async {
    try {
      for (final key in await _store.keysWithPrefix('draft_')) {
        await _store.delete(key);
      }
    } on Object {
      // Nothing more to do.
    }
  }
}
