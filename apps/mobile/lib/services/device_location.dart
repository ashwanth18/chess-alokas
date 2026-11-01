import 'package:geolocator/geolocator.dart';

/// What came of asking the device where it is.
sealed class DeviceLocationResult {
  const DeviceLocationResult();
}

final class DeviceLocationFound extends DeviceLocationResult {
  final double latitude;
  final double longitude;

  const DeviceLocationFound(this.latitude, this.longitude);
}

final class DeviceLocationProblem extends DeviceLocationResult {
  final String message;

  /// Android stops asking after repeated refusals, so only Settings can help.
  final bool canOpenSettings;

  const DeviceLocationProblem(this.message, {this.canOpenSettings = false});
}

typedef DeviceLocator = Future<DeviceLocationResult> Function();
typedef SettingsOpener = Future<void> Function();

/// Asks for permission only when the user taps "Use my location". Coarse
/// position is enough to sort events by distance.
Future<DeviceLocationResult> locateDevice() async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return const DeviceLocationProblem(
        'Location is turned off on this phone. Turn it on, or choose a city.',
      );
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    switch (permission) {
      case LocationPermission.denied:
      case LocationPermission.unableToDetermine:
        return const DeviceLocationProblem(
          'No permission to use your location. You can choose a city instead.',
        );
      case LocationPermission.deniedForever:
        return const DeviceLocationProblem(
          'Location permission is off for this app. Allow it in Settings, or '
          'choose a city.',
          canOpenSettings: true,
        );
      case LocationPermission.whileInUse:
      case LocationPermission.always:
        break;
    }
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.low,
        timeLimit: Duration(seconds: 20),
      ),
    );
    return DeviceLocationFound(position.latitude, position.longitude);
  } on Object {
    return const DeviceLocationProblem(
      'Could not find your location just now. Try again, or choose a city.',
    );
  }
}

Future<void> openLocationSettings() async {
  await Geolocator.openAppSettings();
}
