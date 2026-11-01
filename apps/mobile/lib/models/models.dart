import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

/// Great-circle Haversine distance between two WGS84 coordinates in kilometers.
double haversineDistanceKm(double lat1, double lon1, double lat2, double lon2) {
  const double earthRadiusKm = 6371.0;
  double toRad(double deg) => (deg * math.pi) / 180.0;
  final dLat = toRad(lat2 - lat1);
  final dLon = toRad(lon2 - lon1);
  final a =
      math.sin(dLat / 2) * math.sin(dLat / 2) +
      math.cos(toRad(lat1)) *
          math.cos(toRad(lat2)) *
          math.sin(dLon / 2) *
          math.sin(dLon / 2);
  final c = 2 * math.atan2(math.sqrt(a), math.sqrt(math.max(0.0, 1.0 - a)));
  return ((earthRadiusKm * c) * 10).roundToDouble() / 10.0;
}

/// "1.9 km", "245 km", "10,812 km".
String formatDistanceKm(double km) {
  if (km < 100) return '${km.toStringAsFixed(1)} km';
  final whole = km.round().toString();
  final grouped = whole.replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+$)'),
    (_) => ',',
  );
  return '$grouped km';
}

final RegExp _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  caseSensitive: false,
);

bool isUuid(String value) => _uuidPattern.hasMatch(value);

const List<String> _monthNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/// "2:05 PM", in the device's time zone.
String formatTimeForPeople(DateTime value) {
  final local = value.toLocal();
  final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
  final minute = local.minute.toString().padLeft(2, '0');
  return '$hour:$minute ${local.hour < 12 ? 'AM' : 'PM'}';
}

String _formatDay(DateTime local) =>
    '${local.day} ${_monthNames[local.month - 1]} ${local.year}';

/// "31 Oct 2026, 2:05 PM", in the device's time zone.
String formatDateTimeForPeople(DateTime value) {
  final local = value.toLocal();
  return '${_formatDay(local)}, ${formatTimeForPeople(local)}';
}

/// "15 Nov 2026" from an API date. Anything unreadable is returned unchanged.
String? formatDateForPeople(String? raw) {
  if (raw == null) return null;
  final parsed = DateTime.tryParse(raw);
  return parsed == null ? raw : _formatDay(parsed.toLocal());
}

/// "1 game", "2 games".
String pluralize(int count, String singular, [String? plural]) =>
    '$count ${count == 1 ? singular : (plural ?? '${singular}s')}';

String? _string(Object? value) {
  if (value == null) return null;
  final text = value.toString().trim();
  return text.isEmpty ? null : text;
}

int? _int(Object? value) => value is num ? value.toInt() : null;

double? _double(Object? value) => value is num ? value.toDouble() : null;

bool? _bool(Object? value) => value is bool ? value : null;

List<Map<String, dynamic>> _maps(Object? value) {
  if (value is! List) return const [];
  return value.whereType<Map<String, dynamic>>().toList();
}

/// The centre of an event search: a city the user picks, or the device's
/// position when the user asks for it with "Use my location".
class LocationPreset {
  final String id;
  final String city;
  final String state;
  final double latitude;
  final double longitude;

  const LocationPreset({
    required this.id,
    required this.city,
    required this.state,
    required this.latitude,
    required this.longitude,
  });

  String get label => 'Near: $city';

  /// The device's position, rounded to about a kilometre before it leaves the
  /// phone. Not remembered between launches.
  factory LocationPreset.device(double latitude, double longitude) {
    double round(double value) => (value * 100).roundToDouble() / 100;
    return LocationPreset(
      id: deviceId,
      city: 'your location',
      state: '',
      latitude: round(latitude),
      longitude: round(longitude),
    );
  }

  static const String deviceId = 'device';
}

const List<LocationPreset> locationPresets = [
  LocationPreset(
    id: 'kl',
    city: 'Kuala Lumpur',
    state: 'WP Kuala Lumpur',
    latitude: 3.1390,
    longitude: 101.6869,
  ),
  LocationPreset(
    id: 'pj',
    city: 'Petaling Jaya',
    state: 'Selangor',
    latitude: 3.1073,
    longitude: 101.6067,
  ),
  LocationPreset(
    id: 'penang',
    city: 'George Town',
    state: 'Pulau Pinang',
    latitude: 5.4141,
    longitude: 100.3288,
  ),
  LocationPreset(
    id: 'jb',
    city: 'Johor Bahru',
    state: 'Johor',
    latitude: 1.4927,
    longitude: 103.7414,
  ),
];

final RegExp _ageBandPattern = RegExp(
  r'(?:^|[^A-Z0-9])(?:U|UNDER[\s-]*)(\d{1,2})(?![0-9])',
);

class EventCategoryInfo {
  final String id;
  final String name;

  const EventCategoryInfo({required this.id, required this.name});

  /// Age limit read from the category's name, such as "U12" or "Under 12".
  /// Null when the name states no limit.
  int? get maxAge {
    final match = _ageBandPattern.firstMatch(name.toUpperCase());
    return match == null ? null : int.parse(match.group(1)!);
  }

  /// Short label for filter chips: "U12", "Open", or the category's own name.
  String get code {
    final limit = maxAge;
    if (limit != null) return 'U$limit';
    return name.toUpperCase().contains('OPEN') ? 'Open' : name;
  }

  /// Returns null unless the API gave a real UUID and a name, so that a made-up
  /// id can never be submitted.
  static EventCategoryInfo? tryFromJson(Map<String, dynamic> json) {
    final id = _string(json['id']);
    final name = _string(json['name']);
    if (id == null || name == null || !isUuid(id)) return null;
    return EventCategoryInfo(id: id, name: name);
  }

  static List<EventCategoryInfo> listFromJson(Object? value) {
    return _maps(
      value,
    ).map(tryFromJson).whereType<EventCategoryInfo>().toList();
  }
}

/// A summary row from `GET /public/events`. Anything the API leaves out stays
/// null. Payment instructions are not part of this model: they are only read
/// from the event detail, see [EventDetail].
class MobileEventItem {
  final String id;
  final String? publicSlug;
  final String? name;
  final String? organizationName;
  final String? date;
  final String? registrationDeadline;
  final String? style;
  final int? rounds;
  final String? status;
  final bool registrationOpen;
  final int? registeredCount;
  final int? maxParticipants;
  final String? venueName;
  final String? venueAddress;
  final String? city;
  final String? state;
  final String? country;
  final double? latitude;
  final double? longitude;
  final String? timeControl;
  final int? entryFeeCents;
  final String? currency;
  final String? descriptionMd;
  final List<EventCategoryInfo> categories;

  /// The row as the API gave it, for the offline copy.
  final Map<String, dynamic>? raw;

  const MobileEventItem({
    required this.id,
    this.publicSlug,
    this.name,
    this.organizationName,
    this.date,
    this.registrationDeadline,
    this.style,
    this.rounds,
    this.status,
    this.registrationOpen = false,
    this.registeredCount,
    this.maxParticipants,
    this.venueName,
    this.venueAddress,
    this.city,
    this.state,
    this.country,
    this.latitude,
    this.longitude,
    this.timeControl,
    this.entryFeeCents,
    this.currency,
    this.descriptionMd,
    this.categories = const [],
    this.raw,
  });

  String get slugOrId => publicSlug ?? id;

  String get displayName => name ?? 'Unnamed event';

  /// Distance from a chosen city, or null when the event has no coordinates.
  double? distanceFrom(double originLat, double originLng) {
    final lat = latitude;
    final lng = longitude;
    if (lat == null || lng == null) return null;
    return haversineDistanceKm(originLat, originLng, lat, lng);
  }

  /// "Venue, City, State" from whichever parts are known; null if none are.
  String? get locationLabel {
    final parts = [venueName, city, state].whereType<String>().toList();
    return parts.isEmpty ? null : parts.join(', ');
  }

  bool get isPaid => (entryFeeCents ?? 0) > 0;

  DateTime? get registrationDeadlineAt {
    final raw = registrationDeadline;
    return raw == null ? null : DateTime.tryParse(raw);
  }

  /// "31 Oct 2026, 2:05 PM", or the API's own text if it cannot be read.
  String? get registrationDeadlineLabel {
    final at = registrationDeadlineAt;
    return at == null ? registrationDeadline : formatDateTimeForPeople(at);
  }

  /// Why registering is not possible at [now], using the same two rules the
  /// server applies. Null while registration is open.
  String? closedReason(DateTime now) {
    if (!registrationOpen) return 'Registration is closed for this event.';
    final deadline = registrationDeadlineAt;
    if (deadline != null && deadline.isBefore(now)) {
      return 'Registration closed on $registrationDeadlineLabel.';
    }
    return null;
  }

  /// True when every place is taken, so the server would waitlist a new entry.
  bool get isFull {
    final max = maxParticipants;
    final count = registeredCount;
    return max != null && count != null && count >= max;
  }

  String feeLabel({int players = 1}) {
    final cents = entryFeeCents;
    if (cents == null) return 'Fee not listed';
    if (cents == 0) return 'Free entry';
    return formatMoney(cents * players, currency);
  }

  /// A row the API gave no id for cannot be opened or registered for, so it is
  /// dropped rather than given a made-up id.
  static MobileEventItem? tryFromJson(Map<String, dynamic> json) {
    final id = _string(json['id']);
    if (id == null) return null;
    return MobileEventItem(
      id: id,
      publicSlug: _string(json['publicSlug']),
      name: _string(json['name']),
      organizationName: _string(json['organizationName']),
      date: _string(json['date']),
      registrationDeadline: _string(json['registrationDeadline']),
      style: _string(json['style']),
      rounds: _int(json['rounds']),
      status: _string(json['status']),
      registrationOpen: json['registrationOpen'] == true,
      registeredCount: _int(json['registeredCount']),
      maxParticipants: _int(json['maxParticipants']),
      venueName: _string(json['venueName']),
      venueAddress: _string(json['venueAddress']),
      city: _string(json['city']),
      state: _string(json['state']),
      country: _string(json['country']),
      latitude: _double(json['latitude']),
      longitude: _double(json['longitude']),
      timeControl: _string(json['timeControl']),
      entryFeeCents: _int(json['entryFeeCents']),
      currency: _string(json['currency']),
      descriptionMd: _string(json['descriptionMd']),
      categories: EventCategoryInfo.listFromJson(json['categories']),
      raw: json,
    );
  }
}

String formatMoney(int cents, String? currency) {
  final amount = cents % 100 == 0
      ? (cents ~/ 100).toString()
      : (cents / 100).toStringAsFixed(2);
  return currency == null ? amount : '$currency $amount';
}

/// A question the organizer added to the registration form.
class RegistrationQuestion {
  final String id;
  final String label;
  final bool required;

  /// Non-empty for a choice from a list; otherwise a typed answer.
  final List<String> options;

  const RegistrationQuestion({
    required this.id,
    required this.label,
    this.required = false,
    this.options = const [],
  });

  bool get isChoice => options.isNotEmpty;

  /// The website treats a select with no options as a typed answer; so does
  /// the app.
  static RegistrationQuestion? tryFromJson(Map<String, dynamic> json) {
    final id = _string(json['id']);
    final label = _string(json['label']);
    if (id == null || label == null) return null;
    final rawOptions = json['options'];
    return RegistrationQuestion(
      id: id,
      label: label,
      required: json['required'] == true,
      options: json['type'] == 'select' && rawOptions is List
          ? rawOptions.whereType<String>().toList()
          : const [],
    );
  }
}

/// `GET /public/events/:slugOrId`: nested `{event, categories, participants}`.
class EventDetail {
  final MobileEventItem event;
  final String? paymentInstructions;
  final String? paymentQrUrl;
  final String? rulesMd;
  final List<RegistrationQuestion> questions;

  /// The response as the API gave it, kept in a registration draft.
  final Map<String, dynamic>? raw;

  const EventDetail({
    required this.event,
    this.paymentInstructions,
    this.paymentQrUrl,
    this.rulesMd,
    this.questions = const [],
    this.raw,
  });

  static EventDetail? tryFromJson(Map<String, dynamic> json) {
    final rawEvent = json['event'];
    if (rawEvent is! Map<String, dynamic>) return null;
    final event = MobileEventItem.tryFromJson({
      ...rawEvent,
      'categories': json['categories'],
    });
    if (event == null) return null;
    final form = rawEvent['registrationFormSchema'];
    final questions = form is Map<String, dynamic>
        ? form['customQuestions']
        : null;
    return EventDetail(
      event: event,
      paymentInstructions: _string(rawEvent['paymentInstructions']),
      paymentQrUrl: _string(rawEvent['paymentQrUrl']),
      rulesMd: _string(rawEvent['rulesMd']),
      questions: _maps(questions)
          .map(RegistrationQuestion.tryFromJson)
          .whereType<RegistrationQuestion>()
          .toList(),
      raw: json,
    );
  }
}

class MobilePlayerProfile {
  final String id;
  final String fullName;
  final String? username;
  final String? relationship; // 'self', 'child', 'student', 'family'
  final bool isPrimary;
  final int? yearOfBirth;
  final String? gender;
  final int? fideId;
  final int? fideStandard;
  final int? fideRapid;
  final int? fideBlitz;
  final int? alokasRating;
  final String? school;
  final String? club;
  final String? city;
  final String? state;
  final String? country;
  final String? email;
  final String? phone;

  /// The row as the API gave it, for the offline copy.
  final Map<String, dynamic>? raw;

  const MobilePlayerProfile({
    required this.id,
    required this.fullName,
    this.username,
    this.relationship,
    this.isPrimary = false,
    this.yearOfBirth,
    this.gender,
    this.fideId,
    this.fideStandard,
    this.fideRapid,
    this.fideBlitz,
    this.alokasRating,
    this.school,
    this.club,
    this.city,
    this.state,
    this.country,
    this.email,
    this.phone,
    this.raw,
  });

  /// Age reached in the current calendar year; null if the birth year is unknown.
  int? get age => ageInYear(DateTime.now().year);

  int? ageInYear(int year) {
    final born = yearOfBirth;
    return born == null ? null : math.max(0, year - born);
  }

  int? get bestRating => fideStandard ?? fideRapid ?? fideBlitz;

  /// Enough to tell two similar names apart, such as "Born 2015 \u00B7 Child".
  String get disambiguator {
    final born = yearOfBirth;
    return [if (born != null) 'Born $born', relationshipLabel].join(' \u00B7 ');
  }

  String get relationshipLabel {
    final primary = isPrimary ? 'Primary \u00B7 ' : '';
    switch (relationship) {
      case 'self':
        return '${primary}Self';
      case 'child':
        return '${primary}Child';
      case 'student':
        return '${primary}Student';
      case 'family':
        return '${primary}Family';
      default:
        return '${primary}Player';
    }
  }

  /// "School or club, City, State" from whichever parts are known.
  String? get affiliationLabel {
    final parts = [school ?? club, city, state].whereType<String>().toList();
    return parts.isEmpty ? null : parts.join(', ');
  }

  /// A suggestion based on the age limit in each category's name. Returns null
  /// when nothing fits or the age is unknown; the user can always change it.
  EventCategoryInfo? suggestCategory(List<EventCategoryInfo> categories) {
    if (categories.isEmpty) return null;
    if (categories.length == 1) return categories.single;
    final playerAge = age;
    if (playerAge == null) return null;
    final limited = categories.where((c) => c.maxAge != null).toList()
      ..sort((a, b) => a.maxAge!.compareTo(b.maxAge!));
    for (final category in limited) {
      if (playerAge <= category.maxAge!) return category;
    }
    for (final category in categories) {
      if (category.code == 'Open') return category;
    }
    return null;
  }

  static MobilePlayerProfile? tryFromJson(Map<String, dynamic> json) {
    final id = _string(json['id']);
    if (id == null) return null;
    final dateOfBirth = _string(json['dateOfBirth']);
    return MobilePlayerProfile(
      id: id,
      fullName: _string(json['fullName']) ?? 'Unnamed player',
      username: _string(json['username']),
      relationship: _string(json['relationship']),
      isPrimary: json['isPrimary'] == true,
      yearOfBirth:
          _int(json['yearOfBirth']) ??
          (dateOfBirth == null ? null : DateTime.tryParse(dateOfBirth)?.year),
      gender: _string(json['gender']),
      fideId: _int(json['fideId']),
      fideStandard: _int(json['fideStandard']),
      fideRapid: _int(json['fideRapid']),
      fideBlitz: _int(json['fideBlitz']),
      alokasRating: _int(json['alokasRating']),
      school: _string(json['school']),
      club: _string(json['club']),
      city: _string(json['city']),
      state: _string(json['state']),
      country: _string(json['country']),
      email: _string(json['email']),
      phone: _string(json['phone']),
      raw: json,
    );
  }

  static List<MobilePlayerProfile> listFromJson(Object? value) {
    return _maps(
      value,
    ).map(tryFromJson).whereType<MobilePlayerProfile>().toList();
  }
}

/// A registration as the server recorded it.
class RegistrationRecord {
  final String? id;
  final String? tournamentId;
  final String? playerProfileId;
  final String? playerName;
  final String? status; // pending, approved, waitlisted, rejected, cancelled
  final String? paymentStatus;
  final bool? hasReceipt;

  const RegistrationRecord({
    this.id,
    this.tournamentId,
    this.playerProfileId,
    this.playerName,
    this.status,
    this.paymentStatus,
    this.hasReceipt,
  });

  factory RegistrationRecord.fromJson(Map<String, dynamic> json) {
    final snapshot = json['playerSnapshot'];
    return RegistrationRecord(
      id: _string(json['id']),
      tournamentId: _string(json['tournamentId']),
      playerProfileId: _string(json['playerProfileId']),
      playerName: snapshot is Map<String, dynamic>
          ? _string(snapshot['name'])
          : null,
      status: _string(json['status']),
      paymentStatus: _string(json['paymentStatus']),
      hasReceipt: _bool(json['hasReceipt']),
    );
  }

  bool get isWaitlisted => status == 'waitlisted';

  /// The fee has a registration waiting on a receipt that can still be added.
  bool get needsReceipt => isActive && paymentStatus == 'pending_receipt';

  /// False once it was turned down or withdrawn, so the player may submit again.
  bool get isActive => status != 'rejected' && status != 'cancelled';

  String get statusLabel {
    switch (status) {
      case 'pending':
        return 'Pending organizer review';
      case 'approved':
        return 'Approved';
      case 'waitlisted':
        return 'Waitlisted';
      case 'rejected':
        return 'Rejected';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status ?? 'Submitted, status unknown';
    }
  }

  /// Null when no payment is involved or its state is not known.
  String? get paymentLabel {
    switch (paymentStatus) {
      case 'pending_receipt':
        return 'Payment pending: no receipt yet';
      case 'submitted':
        return 'Receipt submitted, awaiting verification';
      case 'verified':
        return 'Payment verified';
      case 'refunded':
        return 'Payment refunded';
      default:
        return null;
    }
  }
}

/// A file as handed over by the platform's file picker, not yet validated.
class PickedReceipt {
  final String name;
  final Uint8List? bytes;
  final int? reportedSize;

  const PickedReceipt({required this.name, this.bytes, this.reportedSize});
}

/// A payment receipt that passed the same checks the API applies.
class ReceiptFile {
  static const int maxBytes = 5 * 1024 * 1024;
  static const String tooLargeMessage = 'That file is larger than 5 MB.';
  static const String wrongTypeMessage =
      'The receipt must be a PNG, JPEG, WebP or PDF file.';

  final String name;
  final String contentType;
  final Uint8List bytes;

  const ReceiptFile._(this.name, this.contentType, this.bytes);

  String toDataUrl() => 'data:$contentType;base64,${base64Encode(bytes)}';

  /// Returns the receipt, or the reason it cannot be used. The type comes from
  /// the file's content, because the API rejects a mismatched extension anyway.
  static (ReceiptFile?, String?) validate(PickedReceipt picked) {
    final reported = picked.reportedSize;
    if (reported != null && reported > maxBytes) {
      return (null, tooLargeMessage);
    }
    final bytes = picked.bytes;
    if (bytes == null || bytes.isEmpty) {
      return (null, 'That file could not be read.');
    }
    if (bytes.length > maxBytes) return (null, tooLargeMessage);
    final contentType = _sniffContentType(bytes);
    if (contentType == null) return (null, wrongTypeMessage);
    return (ReceiptFile._(picked.name, contentType, bytes), null);
  }

  static String? _sniffContentType(Uint8List b) {
    bool starts(List<int> signature, [int offset = 0]) {
      if (b.length < offset + signature.length) return false;
      for (var i = 0; i < signature.length; i++) {
        if (b[offset + i] != signature[i]) return false;
      }
      return true;
    }

    if (starts([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
    if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (starts([0x52, 0x49, 0x46, 0x46]) &&
        starts([0x57, 0x45, 0x42, 0x50], 8)) {
      return 'image/webp';
    }
    if (starts([0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
    return null;
  }
}

class PlayerLiveMatch {
  final String? tournamentId;
  final String? tournamentName;
  final String? tournamentStatus;
  final int? round;
  final int? board;
  final String? color; // 'white', 'black' or 'bye'
  final String? opponentName;
  final int? opponentRating;
  final String? result;
  final bool isBye;
  final double? currentScore;

  /// For the public standings and pairings; null if the organizer keeps the
  /// live page off.
  final String? publicToken;
  final String? participantId;
  final String? opponentId;

  const PlayerLiveMatch({
    this.tournamentId,
    this.tournamentName,
    this.tournamentStatus,
    this.round,
    this.board,
    this.color,
    this.opponentName,
    this.opponentRating,
    this.result,
    this.isBye = false,
    this.currentScore,
    this.publicToken,
    this.participantId,
    this.opponentId,
  });

  /// In the tournament with no game yet: the API sends board 0 and colour
  /// "bye" with isBye false.
  bool get isAwaitingPairing => !isBye && (board == null || board == 0);

  bool get isWhite => color == 'white';
  bool get isBlack => color == 'black';
  bool get hasResult => result != null && result != 'pending';

  /// "Won", "Lost" or "Drew" for this player; null while pending or unknown.
  String? get outcomeWord {
    final white = isWhite;
    if (!white && !isBlack) return null;
    switch (result) {
      case '1-0':
      case '1-0F':
        return white ? 'Won' : 'Lost';
      case '0-1':
      case '0-1F':
        return white ? 'Lost' : 'Won';
      case '1/2-1/2':
        return 'Drew';
      case '0-0':
        return 'Lost';
      default:
        return null;
    }
  }

  factory PlayerLiveMatch.fromJson(Map<String, dynamic> json) {
    return PlayerLiveMatch(
      tournamentId: _string(json['tournamentId']),
      tournamentName: _string(json['tournamentName']),
      tournamentStatus: _string(json['tournamentStatus']),
      round: _int(json['round']),
      board: _int(json['board']),
      color: _string(json['color']),
      opponentName: _string(json['opponentName']),
      opponentRating: _int(json['opponentRating']),
      result: _string(json['result']),
      isBye: json['isBye'] == true,
      currentScore: _double(json['currentScore']),
      publicToken: _string(json['publicToken']),
      participantId: _string(json['participantId']),
      opponentId: _string(json['opponentId']),
    );
  }
}

class PlayerCareerStats {
  final int? tournamentsCount;
  final int? gamesPlayed;
  final int? wins;
  final int? draws;
  final int? losses;
  final double? totalPoints;

  const PlayerCareerStats({
    this.tournamentsCount,
    this.gamesPlayed,
    this.wins,
    this.draws,
    this.losses,
    this.totalPoints,
  });

  factory PlayerCareerStats.fromJson(Map<String, dynamic> json) {
    return PlayerCareerStats(
      tournamentsCount: _int(json['tournamentsCount']),
      gamesPlayed: _int(json['gamesPlayed']),
      wins: _int(json['wins']),
      draws: _int(json['draws']),
      losses: _int(json['losses']),
      totalPoints: _double(json['totalPoints']),
    );
  }
}

class PlayerTournamentHistoryItem {
  final String? tournamentId;
  final String? tournamentName;
  final String? tournamentDate;
  final String? tournamentStatus;
  final int? rounds;
  final double? score;
  final int? wins;
  final int? draws;
  final int? losses;

  const PlayerTournamentHistoryItem({
    this.tournamentId,
    this.tournamentName,
    this.tournamentDate,
    this.tournamentStatus,
    this.rounds,
    this.score,
    this.wins,
    this.draws,
    this.losses,
  });

  factory PlayerTournamentHistoryItem.fromJson(Map<String, dynamic> json) {
    return PlayerTournamentHistoryItem(
      tournamentId: _string(json['tournamentId']),
      tournamentName: _string(json['tournamentName']),
      tournamentDate: _string(json['tournamentDate']),
      tournamentStatus: _string(json['tournamentStatus']),
      rounds: _int(json['rounds']),
      score: _double(json['score']),
      wins: _int(json['wins']),
      draws: _int(json['draws']),
      losses: _int(json['losses']),
    );
  }
}

class PlayerCertificate {
  final String id;
  final String? tournamentName;
  final String? tournamentDate;
  final String? recipientName;
  final String? type; // 'winner' or 'participation'
  final int? rank;
  final String? serial;

  const PlayerCertificate({
    required this.id,
    this.tournamentName,
    this.tournamentDate,
    this.recipientName,
    this.type,
    this.rank,
    this.serial,
  });

  static PlayerCertificate? tryFromJson(Map<String, dynamic> json) {
    final id = _string(json['id']);
    if (id == null) return null;
    return PlayerCertificate(
      id: id,
      tournamentName: _string(json['tournamentName']),
      tournamentDate: _string(json['tournamentDate']),
      recipientName: _string(json['recipientName']),
      type: _string(json['type']),
      rank: _int(json['rank']),
      serial: _string(json['serial']),
    );
  }

  String get fileName {
    final base = (serial ?? 'certificate-$id').replaceAll(
      RegExp(r'[^A-Za-z0-9._-]+'),
      '_',
    );
    return '$base.pdf';
  }
}

/// `GET /player/dashboard`.
class PlayerDashboard {
  final MobilePlayerProfile? selectedProfile;
  final List<PlayerLiveMatch> liveMatches;
  final PlayerCareerStats? stats;
  final List<PlayerTournamentHistoryItem> tournaments;
  final List<PlayerCertificate> certificates;

  /// The response as the API gave it, for the offline copy.
  final Map<String, dynamic>? raw;

  const PlayerDashboard({
    this.selectedProfile,
    this.liveMatches = const [],
    this.stats,
    this.tournaments = const [],
    this.certificates = const [],
    this.raw,
  });

  factory PlayerDashboard.fromJson(Map<String, dynamic> json) {
    final selected = json['selectedProfile'];
    final stats = json['stats'];
    return PlayerDashboard(
      selectedProfile: selected is Map<String, dynamic>
          ? MobilePlayerProfile.tryFromJson(selected)
          : null,
      liveMatches: _maps(
        json['liveMatches'],
      ).map(PlayerLiveMatch.fromJson).toList(),
      stats: stats is Map<String, dynamic>
          ? PlayerCareerStats.fromJson(stats)
          : null,
      tournaments: _maps(
        json['tournaments'],
      ).map(PlayerTournamentHistoryItem.fromJson).toList(),
      certificates: _maps(json['certificates'])
          .map(PlayerCertificate.tryFromJson)
          .whereType<PlayerCertificate>()
          .toList(),
      raw: json,
    );
  }
}
