/// `GET /public/live/:token`: the public snapshot of a tournament, used for
/// standings and pairings. Holds no school, club, age or birth year.
class LivePlayer {
  final String id;
  final String name;
  final int? rating;
  final int? seed;
  final List<String> categoryIds;

  const LivePlayer({
    required this.id,
    required this.name,
    this.rating,
    this.seed,
    this.categoryIds = const [],
  });
}

class LiveCategory {
  final String id;
  final String name;

  const LiveCategory(this.id, this.name);
}

class LiveGame {
  final int round;
  final int? board;
  final String? whiteId;
  final String? blackId;
  final String result;
  final bool isBye;
  final String? categoryId;

  const LiveGame({
    required this.round,
    this.board,
    this.whiteId,
    this.blackId,
    required this.result,
    this.isBye = false,
    this.categoryId,
  });

  bool get isByeGame => isBye || result == 'bye';
  bool get isPending => result == 'pending';
  bool involves(String playerId) => whiteId == playerId || blackId == playerId;

  /// Points this game gives the player, by the same rules as the server.
  double pointsFor(String playerId) {
    if (!involves(playerId) || isPending) return 0;
    if (isByeGame) return 1;
    final white = whiteId == playerId;
    switch (result) {
      case '1-0':
      case '1-0F':
        return white ? 1 : 0;
      case '0-1':
      case '0-1F':
        return white ? 0 : 1;
      case '1/2-1/2':
        return 0.5;
      default:
        return 0;
    }
  }
}

/// "1½", "2", "0".
String formatPoints(double points) {
  final whole = points.truncate();
  final half = points - whole >= 0.5;
  if (!half) return '$whole';
  return whole == 0 ? '½' : '$whole½';
}

/// "1 – 0", "½ – ½", "Bye". Pending has no result text.
String formatResult(String result, {bool isBye = false}) {
  if (isBye || result == 'bye') return 'Bye';
  switch (result) {
    case 'pending':
      return '';
    case '1-0':
      return '1 – 0';
    case '0-1':
      return '0 – 1';
    case '1/2-1/2':
      return '½ – ½';
    case '1-0F':
      return '1 – 0 F';
    case '0-1F':
      return '0 – 1 F';
    case '0-0':
      return '0 – 0';
    default:
      return result;
  }
}

class StandingRow {
  final LivePlayer player;
  final double points;
  final int rank;
  final bool sharedRank;

  const StandingRow({
    required this.player,
    required this.points,
    required this.rank,
    required this.sharedRank,
  });

  /// "13=" when tied.
  String get rankLabel => sharedRank ? '$rank=' : '$rank';
}

class PlayerRound {
  final int round;
  final LiveGame game;
  final bool? playedWhite;
  final LivePlayer? opponent;

  const PlayerRound({
    required this.round,
    required this.game,
    this.playedWhite,
    this.opponent,
  });
}

class LiveSnapshot {
  final String? name;
  final int? totalRounds;
  final int currentRound;
  final bool mixCategories;
  final List<LiveCategory> categories;
  final List<LivePlayer> players;
  final List<LiveGame> games;
  final Map<String, dynamic>? raw;

  const LiveSnapshot({
    this.name,
    this.totalRounds,
    this.currentRound = 0,
    this.mixCategories = false,
    this.categories = const [],
    this.players = const [],
    this.games = const [],
    this.raw,
  });

  static LiveSnapshot? tryFromJson(Map<String, dynamic> json) {
    final t = json['tournament'];
    final players = json['players'];
    final games = json['games'];
    if (t is! Map<String, dynamic> || players is! List || games is! List) {
      return null;
    }
    return LiveSnapshot(
      name: t['name'] as String?,
      totalRounds: (t['rounds'] as num?)?.toInt(),
      currentRound: (t['currentRound'] as num?)?.toInt() ?? 0,
      mixCategories: t['mixCategories'] == true,
      categories: [
        for (final c in (json['categories'] as List? ?? const []))
          if (c is Map && c['id'] is String && c['name'] is String)
            LiveCategory(c['id'] as String, c['name'] as String),
      ],
      players: [
        for (final p in players)
          if (p is Map && p['id'] is String && p['name'] is String)
            LivePlayer(
              id: p['id'] as String,
              name: p['name'] as String,
              rating: (p['rating'] as num?)?.toInt(),
              seed: (p['seed'] as num?)?.toInt(),
              categoryIds: List<String>.from(
                (p['categoryIds'] as List? ?? const []).whereType<String>(),
              ),
            ),
      ],
      games: [
        for (final g in games)
          if (g is Map && g['round'] is num && g['result'] is String)
            LiveGame(
              round: (g['round'] as num).toInt(),
              board: (g['board'] as num?)?.toInt(),
              whiteId: g['whiteId'] as String?,
              blackId: g['blackId'] as String?,
              result: g['result'] as String,
              isBye: g['isBye'] == true,
              categoryId: g['categoryId'] as String?,
            ),
      ],
      raw: json,
    );
  }

  LivePlayer? player(String? id) {
    for (final p in players) {
      if (p.id == id) return p;
    }
    return null;
  }

  /// The player's first section by name; null when the event has none.
  String? sectionOf(String? playerId) {
    final ids = player(playerId)?.categoryIds ?? const <String>[];
    for (final category in categories) {
      if (ids.contains(category.id)) return category.name;
    }
    return null;
  }

  String? sectionIdOf(String? playerId) {
    final ids = player(playerId)?.categoryIds ?? const <String>[];
    for (final category in categories) {
      if (ids.contains(category.id)) return category.id;
    }
    return null;
  }

  List<int> get rounds =>
      games.map((g) => g.round).toSet().toList()..sort();

  /// Boards of a round in board order, across all sections.
  List<LiveGame> pairings(int round) {
    final list = games.where((g) => g.round == round).toList();
    list.sort((a, b) => (a.board ?? 1 << 30).compareTo(b.board ?? 1 << 30));
    return list;
  }

  /// Ordered by points only. Tied players share a rank: the tie-breaks are the
  /// arbiter's and are not worked out on the phone, so the app can't contradict
  /// the official list.
  List<StandingRow> standings(String? categoryId) {
    final section = categoryId == null
        ? players
        : players.where((p) => p.categoryIds.contains(categoryId)).toList();
    final counted = categoryId != null && !mixCategories
        ? games.where((g) => g.categoryId == categoryId).toList()
        : games;

    final points = <String, double>{
      for (final player in section)
        player.id: counted.fold<double>(
          0,
          (sum, game) => sum + game.pointsFor(player.id),
        ),
    };
    final ordered = [...section]
      ..sort((a, b) {
        final byPoints = points[b.id]!.compareTo(points[a.id]!);
        return byPoints != 0
            ? byPoints
            : (a.seed ?? 1 << 30).compareTo(b.seed ?? 1 << 30);
      });

    final rows = <StandingRow>[];
    for (var i = 0; i < ordered.length; i++) {
      final score = points[ordered[i].id]!;
      final first = ordered.indexWhere((p) => points[p.id] == score);
      final tied = ordered.where((p) => points[p.id] == score).length > 1;
      rows.add(
        StandingRow(
          player: ordered[i],
          points: score,
          rank: first + 1,
          sharedRank: tied,
        ),
      );
    }
    return rows;
  }

  List<PlayerRound> historyOf(String playerId) {
    final mine = games.where((g) => g.involves(playerId)).toList()
      ..sort((a, b) => a.round.compareTo(b.round));
    return [
      for (final game in mine)
        PlayerRound(
          round: game.round,
          game: game,
          playedWhite: game.isByeGame ? null : game.whiteId == playerId,
          opponent: player(
            game.whiteId == playerId ? game.blackId : game.whiteId,
          ),
        ),
    ];
  }
}
