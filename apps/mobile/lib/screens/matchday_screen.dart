import 'package:flutter/material.dart';

import '../models/models.dart';
import '../theme/alokas_theme.dart';
import '../widgets/message_card.dart';

class MatchdayScreen extends StatelessWidget {
  final bool isSignedIn;
  final List<MobilePlayerProfile> profiles;
  final String? selectedProfileId;
  final ValueChanged<String> onSelectProfile;
  final bool loading;
  final String? error;
  final PlayerDashboard? dashboard;

  /// When [dashboard] last came from the server.
  final DateTime? dashboardUpdatedAt;
  final Future<void> Function() onRefresh;
  final VoidCallback onGoToAccount;

  const MatchdayScreen({
    super.key,
    required this.isSignedIn,
    required this.profiles,
    required this.selectedProfileId,
    required this.onSelectProfile,
    required this.loading,
    required this.error,
    required this.dashboard,
    this.dashboardUpdatedAt,
    required this.onRefresh,
    required this.onGoToAccount,
  });

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: AlokasColors.warmGold,
      backgroundColor: AlokasColors.forestCard,
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
        children: [
          if (profiles.isNotEmpty) ...[
            _buildPlayerStrip(),
            const SizedBox(height: 12),
          ],
          ..._buildContent(),
          const SizedBox(height: 16),
          const Text(
            'Check-in passes, full pairings, standings and result disputes are '
            'not available in the app yet. Please use the arbiter desk.',
            textAlign: TextAlign.center,
            style: TextStyle(color: AlokasColors.mutedSage, fontSize: 12),
          ),
        ],
      ),
    );
  }

  List<Widget> _buildContent() {
    final current = dashboard;
    if (!isSignedIn) {
      return [
        MessageCard(
          icon: Icons.login,
          title: 'Sign in to see your matches',
          message: 'Your board and opponent appear here during a tournament.',
          actionLabel: 'Go to Sign In',
          onAction: onGoToAccount,
        ),
      ];
    }
    if (current == null && loading) {
      return const [
        Padding(
          padding: EdgeInsets.all(32),
          child: Center(
            child: CircularProgressIndicator(color: AlokasColors.warmGold),
          ),
        ),
      ];
    }
    final problem = error;
    if (problem != null && current == null) {
      return [
        MessageCard(
          icon: Icons.cloud_off,
          accent: AlokasColors.crimsonDanger,
          title: 'Could not load your matches',
          message: error,
          actionLabel: 'Retry',
          onAction: onRefresh,
        ),
      ];
    }
    if (profiles.isEmpty) {
      return [
        MessageCard(
          icon: Icons.person_add_alt_1,
          title: 'No player profile yet',
          message: 'Add a player profile to follow their matches.',
          actionLabel: 'Go to Profiles',
          onAction: onGoToAccount,
        ),
      ];
    }
    final notice = [
      if (problem != null)
        StaleNotice(
          reason: problem,
          lastLoadedAt: dashboardUpdatedAt,
          onRetry: onRefresh,
        ),
    ];
    final matches = current?.liveMatches ?? const <PlayerLiveMatch>[];
    if (matches.isEmpty) {
      return [
        ...notice,
        const MessageCard(
          icon: Icons.event_busy,
          title: 'No match right now',
          message:
              'A pairing appears here once this player is in a tournament that has started.',
        ),
      ];
    }
    return [
      ...notice,
      for (final match in matches)
        Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: _buildMatchCard(match),
        ),
    ];
  }

  Widget _buildPlayerStrip() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'PLAYERS',
          style: TextStyle(
            color: AlokasColors.warmGold,
            fontSize: 11.5,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.8,
          ),
        ),
        const SizedBox(height: 8),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: profiles.map((prof) {
              final selected = prof.id == selectedProfileId;
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  selected: selected,
                  selectedColor: AlokasColors.warmGold,
                  backgroundColor: AlokasColors.forestCard,
                  label: Text('${prof.fullName} (${prof.relationshipLabel})'),
                  labelStyle: TextStyle(
                    color: selected
                        ? AlokasColors.deepForest
                        : AlokasColors.creamIvory,
                    fontWeight: FontWeight.w700,
                    fontSize: 12.5,
                  ),
                  onSelected: (_) => onSelectProfile(prof.id),
                ),
              );
            }).toList(),
          ),
        ),
      ],
    );
  }

  int? _totalRounds(PlayerLiveMatch match) {
    final history = dashboard?.tournaments ?? const [];
    for (final item in history) {
      if (item.tournamentId == match.tournamentId) return item.rounds;
    }
    return null;
  }

  String _roundLabel(PlayerLiveMatch match) {
    final round = match.round;
    if (round == null) return 'ROUND NOT LISTED';
    final total = _totalRounds(match);
    return total == null ? 'ROUND $round' : 'ROUND $round OF $total';
  }

  String _resultLabel(PlayerLiveMatch match) {
    if (match.isBye) return 'Bye';
    final result = match.result;
    if (result == null) return 'Result not listed';
    return result == 'pending' ? 'Result pending' : 'Result: $result';
  }

  Widget _buildMatchCard(PlayerLiveMatch match) {
    final color = match.color?.toUpperCase();
    final isWhite = color == 'WHITE';
    final score = match.currentScore;
    final opponentName = match.opponentName;
    final opponentRating = match.opponentRating;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AlokasColors.forestElevated, AlokasColors.forestCard],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AlokasColors.warmGold, width: 1.4),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            match.tournamentName ?? 'Unnamed tournament',
            style: const TextStyle(
              color: AlokasColors.creamIvory,
              fontWeight: FontWeight.w800,
              fontSize: 15,
            ),
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Flexible(
                child: AlokasBadge(
                  text: _roundLabel(match),
                  color: AlokasColors.brightGold,
                  icon: Icons.sensors,
                ),
              ),
              if (score != null)
                Text(
                  'Score: ${score.toStringAsFixed(1)}',
                  style: const TextStyle(
                    color: AlokasColors.brightGold,
                    fontWeight: FontWeight.w800,
                    fontSize: 13.5,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 14),
          if (match.isBye)
            const Text(
              'Bye this round: no game to play.',
              style: TextStyle(
                color: AlokasColors.creamIvory,
                fontWeight: FontWeight.w700,
              ),
            )
          else ...[
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: AlokasColors.deepForest,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AlokasColors.warmGold),
                  ),
                  child: Column(
                    children: [
                      const Text(
                        'TABLE / BOARD',
                        style: TextStyle(
                          color: AlokasColors.warmGold,
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        match.board == null ? '–' : '#${match.board}',
                        style: const TextStyle(
                          color: AlokasColors.creamIvory,
                          fontSize: 26,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 12,
                    ),
                    decoration: BoxDecoration(
                      color: isWhite
                          ? AlokasColors.creamIvory
                          : AlokasColors.deepForest,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: AlokasColors.warmGold),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'YOUR PIECE COLOR',
                          style: TextStyle(
                            color: isWhite
                                ? AlokasColors.deepForest
                                : AlokasColors.warmGold,
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          color ?? 'NOT LISTED',
                          style: TextStyle(
                            color: isWhite
                                ? AlokasColors.deepForest
                                : AlokasColors.creamIvory,
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AlokasColors.forestSurface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AlokasColors.goldBorder),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.person_pin,
                    color: AlokasColors.warmGold,
                    size: 28,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      opponentName == null
                          ? 'Opponent not listed'
                          : opponentRating == null
                          ? 'Opponent: $opponentName'
                          : 'Opponent: $opponentName ($opponentRating)',
                      style: const TextStyle(
                        color: AlokasColors.creamIvory,
                        fontWeight: FontWeight.w800,
                        fontSize: 14,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 10),
          Text(
            _resultLabel(match),
            style: const TextStyle(
              color: AlokasColors.mutedSage,
              fontSize: 12.5,
            ),
          ),
        ],
      ),
    );
  }
}
