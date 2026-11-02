import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/models.dart';
import '../theme/alokas_theme.dart';

/// The address to copy or search for: the street address with the venue name
/// in front when the address leaves it out, otherwise the venue, city, state
/// and country that are known. Null when nothing is known.
String? venueAddressFor(MobileEventItem event) {
  final address = event.venueAddress?.trim();
  final venue = event.venueName?.trim();
  if (address != null && address.isNotEmpty) {
    if (venue != null &&
        venue.isNotEmpty &&
        !address.toLowerCase().contains(venue.toLowerCase())) {
      return '$venue, $address';
    }
    return address;
  }
  final parts = [venue, event.city, event.state, event.country]
      .whereType<String>()
      .map((s) => s.trim())
      .where((s) => s.isNotEmpty)
      .toList();
  return parts.isEmpty ? null : parts.join(', ');
}

/// Where Directions goes, best first: the phone's maps app at the exact pin,
/// or searching the address; then Google Maps on the web, which needs no key
/// and opens the Maps app when it is installed. Empty when the event has
/// neither coordinates nor an address.
List<Uri> directionsUrisFor(MobileEventItem event) {
  final lat = event.latitude;
  final lng = event.longitude;
  final address = venueAddressFor(event);
  if (lat != null && lng != null) {
    final label = event.venueName ?? event.name;
    final at = '$lat,$lng';
    final named = label == null ? '' : '(${Uri.encodeComponent(label)})';
    return [
      Uri.parse('geo:$at?q=$at$named'),
      Uri.https('www.google.com', '/maps/search/', {'api': '1', 'query': at}),
    ];
  }
  if (address != null) {
    return [
      Uri.parse('geo:0,0?q=${Uri.encodeComponent(address)}'),
      Uri.https('www.google.com', '/maps/search/', {
        'api': '1',
        'query': address,
      }),
    ];
  }
  return const [];
}

/// Copy address and Directions, side by side. Shows only the actions the event
/// has data for, and nothing at all when it has none.
class VenueActions extends StatelessWidget {
  /// Replaced in tests.
  static Future<bool> Function(Uri) opener = _openExternally;
  static Future<void> Function(String) copier = _copy;

  final MobileEventItem event;

  const VenueActions({super.key, required this.event});

  static Future<bool> _openExternally(Uri uri) =>
      launchUrl(uri, mode: LaunchMode.externalApplication);

  static Future<void> _copy(String text) =>
      Clipboard.setData(ClipboardData(text: text));

  Future<void> _copyAddress(BuildContext context, String address) async {
    final messenger = ScaffoldMessenger.maybeOf(context);
    try {
      await copier(address);
    } on Object {
      messenger?.showSnackBar(
        const SnackBar(content: Text('Could not copy the address.')),
      );
      return;
    }
    messenger
      ?..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(
          key: Key('address-copied'),
          content: Text('Address copied'),
          duration: Duration(seconds: 2),
        ),
      );
  }

  Future<void> _directions(BuildContext context, List<Uri> uris) async {
    final messenger = ScaffoldMessenger.maybeOf(context);
    for (final uri in uris) {
      try {
        if (await opener(uri)) return;
      } on Object {
        // Try the next way.
      }
    }
    messenger?.showSnackBar(
      const SnackBar(content: Text('No maps app found on this phone.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final address = venueAddressFor(event);
    final uris = directionsUrisFor(event);
    if (address == null && uris.isEmpty) return const SizedBox.shrink();
    final p = context.pal;
    final style = OutlinedButton.styleFrom(
      foregroundColor: p.accent,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    );
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        if (uris.isNotEmpty)
          OutlinedButton.icon(
            key: Key('directions-${event.id}'),
            style: style,
            onPressed: () => _directions(context, uris),
            icon: const Icon(Icons.directions_outlined, size: 20),
            label: const Text('Directions'),
          ),
        if (address != null)
          OutlinedButton.icon(
            key: Key('copy-address-${event.id}'),
            style: style,
            onPressed: () => _copyAddress(context, address),
            icon: const Icon(Icons.copy_outlined, size: 20),
            label: const Text('Copy address'),
          ),
      ],
    );
  }
}
