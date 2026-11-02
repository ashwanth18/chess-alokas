import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// OpenFreeMap: free, no key and no account. Fetches the style first so a dead
/// network is found out before a blank map is ever put on screen.
const String openFreeMapStyles = 'https://tiles.openfreemap.org/styles';

/// Only for testing a dead tile server; empty in every real build.
const String _styleOverride = String.fromEnvironment('MAP_STYLE_URL');

typedef MapStyleLoader = Future<String> Function({required bool sunlight});

class MapStyleException implements Exception {
  final String reason;
  const MapStyleException(this.reason);
  @override
  String toString() => 'MapStyleException: $reason';
}

/// Layer id to paint property and colour, laid over the free dark style so that
/// it reads as Alokas green rather than plain grey.
Map<String, (String, String)> forestMapPaint({
  required String land,
  required String water,
  required String green,
  required String label,
}) => {
  'background': ('background-color', land),
  'water': ('fill-color', water),
  'waterway': ('line-color', water),
  'landuse_park': ('fill-color', green),
  'landcover_wood': ('fill-color', green),
  'building': ('fill-color', green),
  for (final place in const [
    'place_other',
    'place_suburb',
    'place_village',
    'place_town',
    'place_city',
    'place_city_large',
    'place_state',
    'place_country_other',
    'place_country_minor',
    'place_country_major',
  ])
    place: ('text-color', label),
};

/// Recolours the layers named in [paint]. A layer the style no longer has is
/// skipped, so a change at OpenFreeMap can't break the map.
String recolourStyle(String styleJson, Map<String, (String, String)> paint) {
  final style = jsonDecode(styleJson);
  if (style is! Map<String, dynamic> || style['layers'] is! List) {
    throw const MapStyleException('Not a map style');
  }
  for (final layer in (style['layers'] as List).whereType<Map>()) {
    final change = paint[layer['id']];
    if (change == null) continue;
    final current = layer['paint'];
    final values = current is Map ? current : <String, dynamic>{};
    values[change.$1] = change.$2;
    layer['paint'] = values;
  }
  return jsonEncode(style);
}

/// The vector source's address, to check that the tile server answers.
String? vectorSourceUrl(String styleJson) {
  final style = jsonDecode(styleJson);
  if (style is! Map || style['sources'] is! Map) return null;
  for (final source in (style['sources'] as Map).values) {
    if (source is Map &&
        source['type'] == 'vector' &&
        source['url'] is String) {
      return source['url'] as String;
    }
  }
  return null;
}

/// Throws if the style or the tile server can't be reached.
Future<String> fetchMapStyle({
  required bool sunlight,
  required Map<String, (String, String)> forestPaint,
  http.Client? client,
}) async {
  final http_ = client ?? http.Client();
  const timeout = Duration(seconds: 8);
  try {
    final url = _styleOverride.isNotEmpty
        ? _styleOverride
        : '$openFreeMapStyles/${sunlight ? 'liberty' : 'dark'}';
    final response = await http_.get(Uri.parse(url)).timeout(timeout);
    if (response.statusCode != 200) {
      throw MapStyleException('Style answered ${response.statusCode}');
    }
    final tiles = vectorSourceUrl(response.body);
    if (tiles != null) {
      final check = await http_.get(Uri.parse(tiles)).timeout(timeout);
      if (check.statusCode != 200) {
        throw MapStyleException('Tiles answered ${check.statusCode}');
      }
    }
    return sunlight ? response.body : recolourStyle(response.body, forestPaint);
  } finally {
    if (client == null) http_.close();
  }
}
