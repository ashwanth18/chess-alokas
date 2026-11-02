import 'dart:math' as math;

import '../models/models.dart';

/// Search across cities, states and events. Pure Dart, with no plugins, so the
/// matching can be unit tested. Tolerates typos, missing spaces and case, and
/// knows the short names people use for Malaysian places.

enum PlaceKind { city, state }

class Place {
  final String name;
  final PlaceKind kind;

  /// The state a city is in, as the [name] of a built-in state.
  final String? state;
  final List<String> aliases;

  const Place(
    this.name, {
    this.kind = PlaceKind.city,
    this.state,
    this.aliases = const [],
  });

  /// Every spelling of this place, normalized.
  Set<String> get keys => {
    normalizeForSearch(name),
    for (final alias in aliases) normalizeForSearch(alias),
  };

  bool matchesEvent(MobileEventItem event) {
    final city = normalizeForSearch(event.city ?? '');
    final state = normalizeForSearch(event.state ?? '');
    final own = keys;
    if (own.contains(city) || own.contains(state)) return true;
    if (kind != PlaceKind.state || city.isEmpty) return false;
    return builtInPlaces.any((p) => p.state == name && p.keys.contains(city));
  }
}

const List<Place> builtInPlaces = [
  // States.
  Place('Johor', kind: PlaceKind.state),
  Place('Kedah', kind: PlaceKind.state),
  Place('Kelantan', kind: PlaceKind.state),
  Place('Melaka', kind: PlaceKind.state, aliases: ['Malacca']),
  Place('Negeri Sembilan', kind: PlaceKind.state, aliases: ['N9']),
  Place('Pahang', kind: PlaceKind.state),
  Place(
    'Penang',
    kind: PlaceKind.state,
    aliases: ['Pulau Pinang', 'Pinang', 'PP'],
  ),
  Place('Perak', kind: PlaceKind.state),
  Place('Perlis', kind: PlaceKind.state),
  Place('Sabah', kind: PlaceKind.state),
  Place('Sarawak', kind: PlaceKind.state),
  Place('Selangor', kind: PlaceKind.state),
  Place('Terengganu', kind: PlaceKind.state),
  // Federal territories and cities.
  Place(
    'Kuala Lumpur',
    aliases: ['KL', 'WP Kuala Lumpur', 'WPKL', 'Wilayah Persekutuan'],
  ),
  Place('Putrajaya', aliases: ['WP Putrajaya']),
  Place('Labuan', aliases: ['WP Labuan']),
  Place('Petaling Jaya', state: 'Selangor', aliases: ['PJ']),
  Place('Shah Alam', state: 'Selangor'),
  Place('Subang Jaya', state: 'Selangor', aliases: ['Subang', 'USJ']),
  Place('Klang', state: 'Selangor'),
  Place('Kajang', state: 'Selangor'),
  Place('Puchong', state: 'Selangor'),
  Place('Cyberjaya', state: 'Selangor'),
  Place('Ampang', state: 'Selangor'),
  Place('Bangi', state: 'Selangor'),
  Place('Cheras', state: 'Selangor'),
  Place('Rawang', state: 'Selangor'),
  Place('Seremban', state: 'Negeri Sembilan'),
  Place('Ipoh', state: 'Perak'),
  Place('Taiping', state: 'Perak'),
  Place('George Town', state: 'Penang', aliases: ['Georgetown', 'GTown']),
  Place('Butterworth', state: 'Penang'),
  Place('Bukit Mertajam', state: 'Penang', aliases: ['BM']),
  Place('Alor Setar', state: 'Kedah', aliases: ['Alor Star']),
  Place('Sungai Petani', state: 'Kedah', aliases: ['SP']),
  Place('Kangar', state: 'Perlis'),
  Place('Kota Bharu', state: 'Kelantan', aliases: ['KB', 'Kota Baru']),
  Place('Kuala Terengganu', state: 'Terengganu', aliases: ['KT']),
  Place('Kuantan', state: 'Pahang'),
  Place('Johor Bahru', state: 'Johor', aliases: ['JB', 'Johor Baru']),
  Place('Batu Pahat', state: 'Johor', aliases: ['BP']),
  Place('Muar', state: 'Johor'),
  Place('Kluang', state: 'Johor'),
  Place('Kuching', state: 'Sarawak'),
  Place('Miri', state: 'Sarawak'),
  Place('Sibu', state: 'Sarawak'),
  Place('Bintulu', state: 'Sarawak'),
  Place('Kota Kinabalu', state: 'Sabah', aliases: ['KK']),
  Place('Sandakan', state: 'Sabah'),
  Place('Tawau', state: 'Sabah'),
];

/// Lower case letters and digits only, so spaces and punctuation never matter.
String normalizeForSearch(String text) =>
    text.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');

/// Edits between two strings, counting a swap of neighbours as one.
int editDistance(String a, String b) {
  final rows = List.generate(
    a.length + 1,
    (i) =>
        List<int>.generate(b.length + 1, (j) => i == 0 ? j : (j == 0 ? i : 0)),
  );
  for (var i = 1; i <= a.length; i++) {
    for (var j = 1; j <= b.length; j++) {
      final cost = a[i - 1] == b[j - 1] ? 0 : 1;
      var best = math.min(
        math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1),
        rows[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) {
        best = math.min(best, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = best;
    }
  }
  return rows[a.length][b.length];
}

/// Scores at or above this were typed correctly, even if only in part.
const int _strongScore = 600;

int _editsAllowed(int length) {
  if (length < 4) return 0;
  if (length < 7) return 1;
  return 2;
}

/// How well [query] (normalized) fits [text], or 0 for no match. [text] keeps
/// its spaces so that each word's start can count.
int _score(String query, String text) {
  final target = normalizeForSearch(text);
  if (query.isEmpty || target.isEmpty) return 0;
  if (target == query) return 1000;
  if (target.startsWith(query)) return 900;
  final words = text
      .toLowerCase()
      .split(RegExp(r'[^a-z0-9]+'))
      .where((w) => w.isNotEmpty)
      .toList();
  if (words.any((w) => w.startsWith(query))) return 800;
  if (query.length >= 3 && target.contains(query)) return 700;

  final allowed = _editsAllowed(query.length);
  if (allowed == 0) return 0;
  var best = editDistance(query, target);
  // Still typing: compare with the start of the name, about as long as typed.
  for (final extra in const [-1, 0, 1]) {
    final length = query.length + extra;
    if (length > 0 && length < target.length) {
      best = math.min(best, editDistance(query, target.substring(0, length)));
    }
  }
  for (final word in words) {
    if (word.length >= 4) best = math.min(best, editDistance(query, word));
  }
  return best <= allowed ? 500 - best * 50 : 0;
}

int _placeScore(String query, Place place) {
  var best = _score(query, place.name);
  for (final alias in place.aliases) {
    // A short name such as "KL" only counts when typed in full.
    if (alias.length <= 4) {
      if (normalizeForSearch(alias) == query) best = math.max(best, 1000);
    } else {
      best = math.max(best, _score(query, alias) - 1);
    }
  }
  return best;
}

/// The built-in places, plus any city or state on an event that they don't
/// already cover.
List<Place> placesFor(Iterable<MobileEventItem> events) {
  final places = [...builtInPlaces];
  final known = {for (final place in places) ...place.keys};
  void add(String? name, PlaceKind kind) {
    if (name == null) return;
    final key = normalizeForSearch(name);
    if (key.isEmpty || !known.add(key)) return;
    places.add(Place(name, kind: kind));
  }

  for (final event in events) {
    add(event.city, PlaceKind.city);
    add(event.state, PlaceKind.state);
  }
  return places;
}

/// Places fitting [query], best first. A typo-tolerant match is dropped when
/// something fits as typed, so "klang" doesn't also offer Kajang.
List<Place> matchPlaces(String query, List<Place> places) {
  final q = normalizeForSearch(query);
  if (q.isEmpty) return const [];
  final scored = <(Place, int)>[
    for (final place in places)
      if (_placeScore(q, place) case final score when score > 0) (place, score),
  ];
  final strong = scored.any((s) => s.$2 >= _strongScore);
  final kept = strong ? scored.where((s) => s.$2 >= _strongScore) : scored;
  final sorted = kept.toList()..sort((a, b) => b.$2.compareTo(a.$2));
  return sorted.map((s) => s.$1).toList();
}

bool _textMatches(String query, String text) {
  final q = normalizeForSearch(query);
  if (q.isEmpty) return true;
  final target = normalizeForSearch(text);
  if (target.contains(q)) return true;
  final words = text
      .toLowerCase()
      .split(RegExp(r'[^a-z0-9]+'))
      .where((w) => w.isNotEmpty)
      .toList();
  final tokens = query
      .toLowerCase()
      .split(RegExp(r'[^a-z0-9]+'))
      .where((w) => w.isNotEmpty)
      .toList();
  if (tokens.isEmpty) return false;
  return tokens.every((token) {
    if (target.contains(token)) return true;
    final allowed = _editsAllowed(token.length);
    if (allowed == 0) return false;
    return words.any(
      (word) => word.length >= 4 && editDistance(token, word) <= allowed,
    );
  });
}

/// Whether an event belongs in the list for what has been typed so far.
bool eventMatchesQuery(
  MobileEventItem event,
  String query,
  List<Place> places,
) {
  if (normalizeForSearch(query).isEmpty) return true;
  if (matchPlaces(query, places).any((p) => p.matchesEvent(event))) return true;
  final text = [
    event.name,
    event.city,
    event.state,
    event.venueName,
    event.organizationName,
  ].whereType<String>().join(' ');
  return _textMatches(query, text);
}

/// One row in the dropdown under the search field: a place or an event.
class SearchSuggestion {
  final String title;
  final Place? place;
  final MobileEventItem? event;

  /// How many of the loaded events are at this place.
  final int eventCount;

  const SearchSuggestion({
    required this.title,
    this.place,
    this.event,
    this.eventCount = 0,
  });
}

/// Places first, those with events ahead of those without, then events.
List<SearchSuggestion> suggestionsFor(
  String query,
  List<MobileEventItem> events, {
  int maxPlaces = 5,
  int maxEvents = 3,
}) {
  if (normalizeForSearch(query).isEmpty) return const [];
  final matched = matchPlaces(query, placesFor(events));
  final counted = <(Place, int)>[
    for (final place in matched)
      (place, events.where(place.matchesEvent).length),
  ];
  // A stable sort: within each group, the best match stays first.
  final withEvents = counted.where((c) => c.$2 > 0);
  final without = counted.where((c) => c.$2 == 0);
  return [
    for (final (place, count) in [...withEvents, ...without].take(maxPlaces))
      SearchSuggestion(title: place.name, place: place, eventCount: count),
    for (final event
        in events
            .where((e) => e.name != null && _textMatches(query, e.name!))
            .take(maxEvents))
      SearchSuggestion(title: event.displayName, event: event),
  ];
}
