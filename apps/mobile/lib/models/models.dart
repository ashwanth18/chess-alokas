import 'dart:math' as math;

/// Great-circle Haversine distance between two WGS84 coordinates in kilometers.
double haversineDistanceKm(
  double lat1,
  double lon1,
  double lat2,
  double lon2,
) {
  const double earthRadiusKm = 6371.0;
  double toRad(double deg) => (deg * math.pi) / 180.0;
  final dLat = toRad(lat2 - lat1);
  final dLon = toRad(lon2 - lon1);
  final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
      math.cos(toRad(lat1)) *
          math.cos(toRad(lat2)) *
          math.sin(dLon / 2) *
          math.sin(dLon / 2);
  final c = 2 * math.atan2(math.sqrt(a), math.sqrt(math.max(0.0, 1.0 - a)));
  return ((earthRadiusKm * c) * 10).roundToDouble() / 10.0;
}

class GpsLocationPreset {
  final String id;
  final String label;
  final String city;
  final String state;
  final double latitude;
  final double longitude;

  const GpsLocationPreset({
    required this.id,
    required this.label,
    required this.city,
    required this.state,
    required this.latitude,
    required this.longitude,
  });
}

class EventCategoryInfo {
  final String id;
  final String name;
  final String code; // e.g. 'U8', 'U12', 'U18', 'Open'
  final int? maxAge;
  final String prizeSummary;

  const EventCategoryInfo({
    required this.id,
    required this.name,
    required this.code,
    this.maxAge,
    this.prizeSummary = 'Top 5 Trophies + Digital Certificates',
  });

  factory EventCategoryInfo.fromJson(Map<String, dynamic> json) {
    final name = (json['name'] ?? 'Open').toString();
    final upper = name.toUpperCase();
    String code = 'Open';
    int? maxAge;
    if (upper.contains('U8') || upper.contains('UNDER 8')) {
      code = 'U8';
      maxAge = 8;
    } else if (upper.contains('U10') || upper.contains('UNDER 10')) {
      code = 'U12';
      maxAge = 10;
    } else if (upper.contains('U12') || upper.contains('UNDER 12')) {
      code = 'U12';
      maxAge = 12;
    } else if (upper.contains('U15') ||
        upper.contains('U18') ||
        upper.contains('UNDER 18')) {
      code = 'U18';
      maxAge = 18;
    }
    return EventCategoryInfo(
      id: (json['id'] ?? name).toString(),
      name: name,
      code: code,
      maxAge: maxAge,
    );
  }
}

class MobileEventItem {
  final String id;
  final String publicSlug;
  final String name;
  final String organizationName;
  final String date;
  final String style;
  final int rounds;
  final String status;
  final bool registrationOpen;
  final int registeredCount;
  final int? maxParticipants;
  final String venueName;
  final String venueAddress;
  final String city;
  final String state;
  final String country;
  final double latitude;
  final double longitude;
  final String timeControl;
  final int entryFeeCents;
  final String currency;
  final String descriptionMd;
  final String rulesMd;
  final String paymentInstructions;
  final List<EventCategoryInfo> categories;
  final bool isRegistered;
  final List<String> registeredProfileNames;

  const MobileEventItem({
    required this.id,
    required this.publicSlug,
    required this.name,
    required this.organizationName,
    required this.date,
    required this.style,
    required this.rounds,
    required this.status,
    required this.registrationOpen,
    required this.registeredCount,
    this.maxParticipants,
    required this.venueName,
    required this.venueAddress,
    required this.city,
    required this.state,
    this.country = 'Malaysia',
    required this.latitude,
    required this.longitude,
    required this.timeControl,
    required this.entryFeeCents,
    this.currency = 'MYR',
    required this.descriptionMd,
    required this.rulesMd,
    required this.paymentInstructions,
    required this.categories,
    this.isRegistered = false,
    this.registeredProfileNames = const [],
  });

  double distanceFrom(double userLat, double userLng) {
    return haversineDistanceKm(userLat, userLng, latitude, longitude);
  }

  String get formattedFee {
    if (entryFeeCents <= 0) return 'Free Entry';
    final amount = (entryFeeCents / 100).toStringAsFixed(0);
    return '$currency $amount';
  }

  MobileEventItem copyWith({
    int? registeredCount,
    bool? isRegistered,
    List<String>? registeredProfileNames,
  }) {
    return MobileEventItem(
      id: id,
      publicSlug: publicSlug,
      name: name,
      organizationName: organizationName,
      date: date,
      style: style,
      rounds: rounds,
      status: status,
      registrationOpen: registrationOpen,
      registeredCount: registeredCount ?? this.registeredCount,
      maxParticipants: maxParticipants,
      venueName: venueName,
      venueAddress: venueAddress,
      city: city,
      state: state,
      country: country,
      latitude: latitude,
      longitude: longitude,
      timeControl: timeControl,
      entryFeeCents: entryFeeCents,
      currency: currency,
      descriptionMd: descriptionMd,
      rulesMd: rulesMd,
      paymentInstructions: paymentInstructions,
      categories: categories,
      isRegistered: isRegistered ?? this.isRegistered,
      registeredProfileNames:
          registeredProfileNames ?? this.registeredProfileNames,
    );
  }

  factory MobileEventItem.fromJson(Map<String, dynamic> json) {
    final rawCats = (json['categories'] as List<dynamic>? ?? []);
    final cats = rawCats
        .whereType<Map<String, dynamic>>()
        .map(EventCategoryInfo.fromJson)
        .toList();
    return MobileEventItem(
      id: (json['id'] ?? '').toString(),
      publicSlug: (json['publicSlug'] ?? json['id'] ?? 'event').toString(),
      name: (json['name'] ?? 'Chess Tournament').toString(),
      organizationName:
          (json['organizationName'] ?? 'Verified Alokas Organizer').toString(),
      date: (json['date'] ?? '2026-11-15').toString(),
      style: (json['style'] ?? 'dutch').toString(),
      rounds: (json['rounds'] is num) ? (json['rounds'] as num).toInt() : 6,
      status: (json['status'] ?? 'ready').toString(),
      registrationOpen: json['registrationOpen'] != false,
      registeredCount: (json['registeredCount'] is num)
          ? (json['registeredCount'] as num).toInt()
          : 0,
      maxParticipants: (json['maxParticipants'] is num)
          ? (json['maxParticipants'] as num).toInt()
          : null,
      venueName: (json['venueName'] ?? 'Main Tournament Hall').toString(),
      venueAddress:
          (json['venueAddress'] ?? 'Kuala Lumpur, Malaysia').toString(),
      city: (json['city'] ?? 'Kuala Lumpur').toString(),
      state: (json['state'] ?? 'WP Kuala Lumpur').toString(),
      country: (json['country'] ?? 'Malaysia').toString(),
      latitude: (json['latitude'] is num)
          ? (json['latitude'] as num).toDouble()
          : 3.1390,
      longitude: (json['longitude'] is num)
          ? (json['longitude'] as num).toDouble()
          : 101.6869,
      timeControl: (json['timeControl'] ?? '15m + 5s Rapid').toString(),
      entryFeeCents: (json['entryFeeCents'] is num)
          ? (json['entryFeeCents'] as num).toInt()
          : 0,
      currency: (json['currency'] ?? 'MYR').toString(),
      descriptionMd: (json['descriptionMd'] ??
              'FIDE laws of chess apply. Digital certificates issued via Chess Alokas.')
          .toString(),
      rulesMd: (json['rulesMd'] ??
              'Swiss / FIDE Dutch pairing. Default time 10 minutes.')
          .toString(),
      paymentInstructions: (json['paymentInstructions'] ??
              'DuitNow QR / Maybank 5140-8892-1104 (Chess Alokas Academy). Attach receipt below.')
          .toString(),
      categories: cats.isEmpty
          ? const [
              EventCategoryInfo(id: 'cat-open', name: 'Open', code: 'Open'),
            ]
          : cats,
    );
  }
}

class MobilePlayerProfile {
  final String id;
  final String fullName;
  final String username;
  final String relationship; // 'self', 'child', 'student', 'family'
  final bool isPrimary;
  final int yearOfBirth;
  final String gender;
  final int? fideId;
  final int? fideStandard;
  final int? fideRapid;
  final int? fideBlitz;
  final int alokasRating;
  final String school;
  final String club;
  final String city;
  final String state;
  final String country;
  final String? email;
  final String? phone;
  final bool checkedInToday;

  const MobilePlayerProfile({
    required this.id,
    required this.fullName,
    required this.username,
    required this.relationship,
    this.isPrimary = false,
    required this.yearOfBirth,
    this.gender = 'M',
    this.fideId,
    this.fideStandard,
    this.fideRapid,
    this.fideBlitz,
    this.alokasRating = 1200,
    required this.school,
    this.club = '',
    required this.city,
    required this.state,
    this.country = 'Malaysia',
    this.email,
    this.phone,
    this.checkedInToday = true,
  });

  int get age => math.max(4, 2026 - yearOfBirth);

  int get bestRating =>
      fideRapid ?? fideStandard ?? fideBlitz ?? alokasRating;

  String get relationshipLabel {
    switch (relationship) {
      case 'self':
        return 'Primary (Self)';
      case 'child':
        return 'Child';
      case 'student':
        return 'Academy Student';
      default:
        return 'Family Member';
    }
  }

  /// Auto-selects the best matching category in an event based on player's age.
  EventCategoryInfo matchCategory(List<EventCategoryInfo> categories) {
    if (categories.isEmpty) {
      return const EventCategoryInfo(
        id: 'default-open',
        name: 'Open Category',
        code: 'Open',
      );
    }
    final sortedAgeCats = categories
        .where((c) => c.maxAge != null)
        .toList()
      ..sort((a, b) => (a.maxAge ?? 99).compareTo(b.maxAge ?? 99));
    for (final cat in sortedAgeCats) {
      if (age <= (cat.maxAge ?? 99)) {
        return cat;
      }
    }
    return categories.firstWhere(
      (c) => c.code == 'Open',
      orElse: () => categories.last,
    );
  }

  factory MobilePlayerProfile.fromJson(Map<String, dynamic> json) {
    return MobilePlayerProfile(
      id: (json['id'] ?? '').toString(),
      fullName: (json['fullName'] ?? 'Chess Player').toString(),
      username: (json['username'] ?? 'player').toString(),
      relationship: (json['relationship'] ?? 'self').toString(),
      isPrimary: json['isPrimary'] == true,
      yearOfBirth: (json['yearOfBirth'] is num)
          ? (json['yearOfBirth'] as num).toInt()
          : 2012,
      gender: (json['gender'] ?? 'M').toString(),
      fideId: (json['fideId'] is num) ? (json['fideId'] as num).toInt() : null,
      fideStandard: (json['fideStandard'] is num)
          ? (json['fideStandard'] as num).toInt()
          : null,
      fideRapid: (json['fideRapid'] is num)
          ? (json['fideRapid'] as num).toInt()
          : null,
      fideBlitz: (json['fideBlitz'] is num)
          ? (json['fideBlitz'] as num).toInt()
          : null,
      alokasRating: (json['alokasRating'] is num)
          ? (json['alokasRating'] as num).toInt()
          : 1200,
      school: (json['school'] ?? json['club'] ?? 'Independent').toString(),
      club: (json['club'] ?? '').toString(),
      city: (json['city'] ?? 'Kuala Lumpur').toString(),
      state: (json['state'] ?? 'WP Kuala Lumpur').toString(),
      country: (json['country'] ?? 'Malaysia').toString(),
      email: json['email']?.toString(),
      phone: json['phone']?.toString(),
    );
  }
}

class LiveRoundPairing {
  final int round;
  final int board;
  final String whiteName;
  final int whiteRating;
  final String blackName;
  final int blackRating;
  final String result;
  final bool isMyBoard;

  const LiveRoundPairing({
    required this.round,
    required this.board,
    required this.whiteName,
    required this.whiteRating,
    required this.blackName,
    required this.blackRating,
    required this.result,
    this.isMyBoard = false,
  });
}

class LiveStandingEntry {
  final int rank;
  final String playerName;
  final String school;
  final int rating;
  final double score;
  final double buchholz;
  final double buchholzCut1;
  final double sonnebornBerger;
  final bool isMe;

  const LiveStandingEntry({
    required this.rank,
    required this.playerName,
    required this.school,
    required this.rating,
    required this.score,
    required this.buchholz,
    required this.buchholzCut1,
    required this.sonnebornBerger,
    this.isMe = false,
  });
}

class LiveTournamentState {
  final String tournamentId;
  final String tournamentName;
  final String venueName;
  final String categoryName;
  final int currentRound;
  final int totalRounds;
  final String profileId;
  final String playerName;
  final int? fideId;
  final int myBoard;
  final String myColor; // 'WHITE' or 'BLACK'
  final String opponentName;
  final int opponentRating;
  final String opponentSchool;
  final double currentScore;
  final String checkInCode;
  final bool checkedIn;
  final List<LiveRoundPairing> roundPairings;
  final List<LiveStandingEntry> standings;
  final bool disputeFlagged;
  final String? disputeReason;

  const LiveTournamentState({
    required this.tournamentId,
    required this.tournamentName,
    required this.venueName,
    required this.categoryName,
    required this.currentRound,
    required this.totalRounds,
    required this.profileId,
    required this.playerName,
    this.fideId,
    required this.myBoard,
    required this.myColor,
    required this.opponentName,
    required this.opponentRating,
    required this.opponentSchool,
    required this.currentScore,
    required this.checkInCode,
    this.checkedIn = true,
    required this.roundPairings,
    required this.standings,
    this.disputeFlagged = false,
    this.disputeReason,
  });

  LiveTournamentState copyWith({
    bool? checkedIn,
    bool? disputeFlagged,
    String? disputeReason,
  }) {
    return LiveTournamentState(
      tournamentId: tournamentId,
      tournamentName: tournamentName,
      venueName: venueName,
      categoryName: categoryName,
      currentRound: currentRound,
      totalRounds: totalRounds,
      profileId: profileId,
      playerName: playerName,
      fideId: fideId,
      myBoard: myBoard,
      myColor: myColor,
      opponentName: opponentName,
      opponentRating: opponentRating,
      opponentSchool: opponentSchool,
      currentScore: currentScore,
      checkInCode: checkInCode,
      checkedIn: checkedIn ?? this.checkedIn,
      roundPairings: roundPairings,
      standings: standings,
      disputeFlagged: disputeFlagged ?? this.disputeFlagged,
      disputeReason: disputeReason ?? this.disputeReason,
    );
  }
}

class CertificateVaultItem {
  final String id;
  final String serial;
  final String tournamentName;
  final String tournamentDate;
  final String recipientName;
  final String categoryName;
  final String type; // 'winner' or 'participation'
  final int? rank;
  final String sha256Hash;

  const CertificateVaultItem({
    required this.id,
    required this.serial,
    required this.tournamentName,
    required this.tournamentDate,
    required this.recipientName,
    required this.categoryName,
    required this.type,
    this.rank,
    required this.sha256Hash,
  });
}

class PastTournamentRecord {
  final String id;
  final String name;
  final String date;
  final String city;
  final String style;
  final String category;
  final double score;
  final int rounds;
  final int rank;
  final int ratingDelta;
  final int wins;
  final int draws;
  final int losses;

  const PastTournamentRecord({
    required this.id,
    required this.name,
    required this.date,
    required this.city,
    required this.style,
    required this.category,
    required this.score,
    required this.rounds,
    required this.rank,
    required this.ratingDelta,
    required this.wins,
    required this.draws,
    required this.losses,
  });
}

class RatingPoint {
  final String label;
  final int rating;

  const RatingPoint({required this.label, required this.rating});
}
