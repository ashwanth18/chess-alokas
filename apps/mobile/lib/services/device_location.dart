import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geocoding/geocoding.dart' as geocoding;
import 'package:geolocator/geolocator.dart';

import '../models/models.dart';

/// What came of asking the device where it is.
sealed class DeviceLocationResult {
  const DeviceLocationResult();
}

/// A real position from this phone. Kept in memory only, and never sent to the
/// Alokas API: distances are worked out on the phone.
final class DeviceLocationFound extends DeviceLocationResult {
  final double latitude;
  final double longitude;
  final double? accuracyMeters;

  /// When the phone took this fix. Null if the platform didn't say.
  final DateTime? fixedAt;

  /// The user allowed only approximate location, so it may be off by some km.
  final bool isApproximate;

  const DeviceLocationFound(
    this.latitude,
    this.longitude, {
    this.accuracyMeters,
    this.fixedAt,
    this.isApproximate = false,
  });
}

enum LocationProblemFix { retry, permission, appSettings, locationSettings }

final class DeviceLocationProblem extends DeviceLocationResult {
  final String message;
  final LocationProblemFix fix;

  const DeviceLocationProblem(
    this.message, {
    this.fix = LocationProblemFix.retry,
  });
}

typedef DeviceLocator = Future<DeviceLocationResult> Function({bool prompt});
typedef SettingsOpener = Future<void> Function();
typedef PlaceNamer =
    Future<String?> Function(double latitude, double longitude);

/// A last known position older than this might be another city or country.
const Duration maxLastKnownAge = Duration(minutes: 30);

/// With [prompt] false, as when reopening the app, it never shows a permission
/// dialog: without permission it just reports the problem.
Future<DeviceLocationResult> locateDevice({bool prompt = true}) async {
  const noFix = DeviceLocationProblem('No GPS fix yet');
  try {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return const DeviceLocationProblem(
        'Phone location is off',
        fix: LocationProblemFix.locationSettings,
      );
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied && prompt) {
      permission = await Geolocator.requestPermission();
    }
    switch (permission) {
      case LocationPermission.denied:
      case LocationPermission.unableToDetermine:
        return const DeviceLocationProblem(
          'Permission not given',
          fix: LocationProblemFix.permission,
        );
      case LocationPermission.deniedForever:
        return const DeviceLocationProblem(
          'Permission is off',
          fix: LocationProblemFix.appSettings,
        );
      case LocationPermission.whileInUse:
      case LocationPermission.always:
        break;
    }
    final approximate =
        await Geolocator.getLocationAccuracy() ==
        LocationAccuracyStatus.reduced;
    Position? position;
    try {
      position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
    } on Object {
      // Indoors with no fresh fix: a recent position is still real, and the
      // line on screen shows its age. An old one is not "where you are".
      final last = await Geolocator.getLastKnownPosition();
      if (last != null &&
          DateTime.now().difference(last.timestamp) <= maxLastKnownAge) {
        position = last;
      }
    }
    if (position == null) return noFix;
    return DeviceLocationFound(
      position.latitude,
      position.longitude,
      accuracyMeters: position.accuracy,
      fixedAt: position.timestamp,
      isApproximate: approximate,
    );
  } on Object {
    return noFix;
  }
}

/// Android offers the upgrade from approximate to precise only through the
/// permission dialog, which it may refuse to show again.
Future<void> requestPreciseLocation() async {
  try {
    await Geolocator.requestPermission();
  } on Object {
    // The line keeps saying Approximate, so nothing is claimed.
  }
}

Future<void> openLocationSettings() async {
  await Geolocator.openAppSettings();
}

Future<void> openDeviceLocationSettings() async {
  await Geolocator.openLocationSettings();
}

/// The phone's own reverse geocoder (Android Geocoder), which needs no key.
/// Null when it has no answer: not every phone has a geocoder.
Future<String?> nameDevicePlace(double latitude, double longitude) async {
  double round(double value) => (value * 1000).roundToDouble() / 1000;
  try {
    final places = await geocoding.Geocoding()
        .placemarkFromCoordinates(round(latitude), round(longitude))
        .timeout(const Duration(seconds: 6));
    if (places.isEmpty) return null;
    return placeNameFrom([
      ...places.map((p) => p.locality),
      ...places.map((p) => p.subLocality),
      ...places.map((p) => p.subAdministrativeArea),
      ...places.map((p) => p.administrativeArea),
      ...places.map((p) => p.country),
    ]);
  } on Object {
    return null;
  }
}

/// The first part that says something, most specific first.
String? placeNameFrom(List<String?> parts) {
  for (final part in parts) {
    final text = part?.trim();
    if (text != null && text.isNotEmpty) return text;
  }
  return null;
}

/// Near me, kept above the Discover tab so that it survives changing tab. It
/// holds a position only while it is real and current: anything else clears it,
/// so no distance can be drawn from a stale or invented place.
class NearMeController extends ChangeNotifier {
  final DeviceLocator locate;
  final PlaceNamer namePlace;
  final Future<void> Function(bool on) remember;

  NearMeController({
    required this.locate,
    required this.namePlace,
    required this.remember,
  });

  bool _on = false;
  bool _locating = false;
  DeviceLocationFound? _fix;
  String? _placeName;
  DeviceLocationProblem? _problem;
  int _requestId = 0;
  bool _disposed = false;

  bool get isOn => _on;
  bool get isLocating => _locating;
  DeviceLocationFound? get fix => _fix;
  String? get placeName => _placeName;
  DeviceLocationProblem? get problem => _problem;

  /// From this phone's real position; null without one.
  double? distanceTo(MobileEventItem event) {
    final fix = _fix;
    return fix == null ? null : event.distanceFrom(fix.latitude, fix.longitude);
  }

  /// "12 km away"; null without a real position or event coordinates.
  String? distanceLabel(MobileEventItem event) {
    final km = distanceTo(event);
    return km == null
        ? null
        : formatDistanceAway(km, approximate: _fix!.isApproximate);
  }

  Future<void> turnOn() async {
    _on = true;
    await _safeRemember(true);
    await refresh();
  }

  Future<void> turnOff() async {
    _requestId++;
    _on = false;
    _locating = false;
    _fix = null;
    _placeName = null;
    _problem = null;
    _notify();
    await _safeRemember(false);
  }

  /// On app start: back on only if the user left it on, with no dialog.
  Future<void> restore(bool wasOn) async {
    if (!wasOn) return;
    _on = true;
    await refresh(prompt: false);
  }

  /// Back from the background: a fix this old may no longer be where they are.
  Future<void> refreshIfOld({
    Duration maxAge = const Duration(minutes: 5),
  }) async {
    if (!_on || _locating) return;
    final at = _fix?.fixedAt;
    if (at == null || DateTime.now().difference(at) > maxAge) {
      await refresh(prompt: false);
    }
  }

  Future<void> refresh({bool prompt = true}) async {
    final id = ++_requestId;
    _locating = true;
    _problem = null;
    _notify();
    final DeviceLocationResult result;
    try {
      result = await locate(prompt: prompt);
    } on Object {
      if (id != _requestId || _disposed) return;
      _clear(const DeviceLocationProblem('No GPS fix yet'));
      return;
    }
    if (id != _requestId || _disposed) return;
    switch (result) {
      case DeviceLocationProblem():
        _clear(result);
      case DeviceLocationFound():
        final moved =
            _fix == null ||
            _fix!.latitude != result.latitude ||
            _fix!.longitude != result.longitude;
        _fix = result;
        _locating = false;
        if (moved) _placeName = null;
        _notify();
        String? name;
        try {
          name = await namePlace(result.latitude, result.longitude);
        } on Object {
          name = null;
        }
        if (id != _requestId || _disposed) return;
        _placeName = name;
        _notify();
    }
  }

  void _clear(DeviceLocationProblem problem) {
    _fix = null;
    _placeName = null;
    _problem = problem;
    _locating = false;
    _notify();
  }

  Future<void> _safeRemember(bool on) async {
    try {
      await remember(on);
    } on Object {
      // Works for this run; it just won't be remembered.
    }
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// "Updated just now", "Updated 5 min ago", "Updated 2 h ago".
String freshnessLabel(DateTime? fixedAt, DateTime now) {
  if (fixedAt == null) return 'Updated just now';
  final age = now.difference(fixedAt);
  if (age.inMinutes < 1) return 'Updated just now';
  if (age.inMinutes < 60) return 'Updated ${age.inMinutes} min ago';
  return 'Updated ${age.inHours} h ago';
}
