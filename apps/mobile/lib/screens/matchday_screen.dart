import 'package:flutter/material.dart';

import '../models/models.dart';
import '../theme/alokas_theme.dart';

class MatchdayScreen extends StatelessWidget {
  final List<MobilePlayerProfile> profiles;
  final String selectedProfileId;
  final ValueChanged<String> onSelectProfile;
  final Map<String, LiveTournamentState> liveStates;
  final ValueChanged<String> onToggleCheckIn;
  final void Function(String profileId, String reason) onFlagDispute;

  const MatchdayScreen({
    super.key,
    required this.profiles,
    required this.selectedProfileId,
    required this.onSelectProfile,
    required this.liveStates,
    required this.onToggleCheckIn,
    required this.onFlagDispute,
  });

  void _showQrPassModal(BuildContext context, LiveTournamentState state) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AlokasColors.forestSurface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: const BorderSide(color: AlokasColors.warmGold, width: 1.5),
        ),
        title: Row(
          children: [
            const Icon(Icons.qr_code_2, color: AlokasColors.brightGold),
            const SizedBox(width: 8),
            const Expanded(
              child: Text(
                'Morning Check-In QR Pass',
                style: TextStyle(
                  color: AlokasColors.creamIvory,
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              state.tournamentName,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AlokasColors.mutedSage,
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AlokasColors.creamIvory,
                borderRadius: BorderRadius.circular(16),
              ),
              child: CustomPaint(
                size: const Size(168, 168),
                painter: _QrMatrixPainter(seed: state.checkInCode),
              ),
            ),
            const SizedBox(height: 14),
            Text(
              state.playerName,
              style: const TextStyle(
                color: AlokasColors.creamIvory,
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              '${state.categoryName} • FIDE ID: ${state.fideId ?? "N/A"}',
              style: const TextStyle(
                color: AlokasColors.warmGold,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            AlokasBadge(
              text: state.checkedIn
                  ? 'Checked In for Round 1 Roll Call'
                  : 'Pending Desk Scan',
              color: state.checkedIn
                  ? AlokasColors.emeraldSuccess
                  : AlokasColors.amberWarning,
              icon: state.checkedIn ? Icons.verified : Icons.schedule,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              onToggleCheckIn(state.profileId);
              Navigator.of(ctx).pop();
            },
            child: Text(
              state.checkedIn ? 'Simulate Re-Scan' : 'Mark Checked In',
              style: const TextStyle(color: AlokasColors.brightGold),
            ),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }

  void _showDisputeDialog(BuildContext context, LiveTournamentState state) {
    final controller = TextEditingController(
      text:
          'Requesting Chief Arbiter verification on Round ${state.currentRound} Board ${state.myBoard}.',
    );
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AlokasColors.forestSurface,
        title: const Text(
          'Flag Result Dispute for Arbiter',
          style: TextStyle(
            color: AlokasColors.creamIvory,
            fontWeight: FontWeight.w800,
            fontSize: 17,
          ),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Board ${state.myBoard} • ${state.playerName} vs ${state.opponentName}',
              style: const TextStyle(
                color: AlokasColors.warmGold,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: controller,
              maxLines: 3,
              style: const TextStyle(color: AlokasColors.creamIvory),
              decoration: const InputDecoration(
                labelText: 'Dispute / Arbiter Note',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              onFlagDispute(state.profileId, controller.text.trim());
              Navigator.of(ctx).pop();
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  backgroundColor: AlokasColors.forestElevated,
                  content: Text(
                    'Chief Arbiter alert dispatched for your board.',
                    style: TextStyle(color: AlokasColors.creamIvory),
                  ),
                ),
              );
            },
            child: const Text('Send Alert to Arbiter Desk'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final activeState = liveStates[selectedProfileId] ??
        liveStates.values.first;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
      children: [
        _buildFamilyLiveStrip(),
        const SizedBox(height: 12),
        _buildTournamentBanner(context, activeState),
        const SizedBox(height: 14),
        _buildNextMatchHeroCard(context, activeState),
        const SizedBox(height: 16),
        _buildRoundPairingsCard(activeState),
        const SizedBox(height: 16),
        _buildStandingsCard(activeState),
      ],
    );
  }

  Widget _buildFamilyLiveStrip() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'ACTIVE FAMILY PLAYERS TODAY',
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
              final st = liveStates[prof.id];
              final subtitle = st != null
                  ? 'Bd ${st.myBoard} • ${st.myColor}'
                  : prof.relationshipLabel;
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  selected: selected,
                  selectedColor: AlokasColors.warmGold,
                  backgroundColor: AlokasColors.forestCard,
                  label: Text('${prof.fullName} ($subtitle)'),
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

  Widget _buildTournamentBanner(
    BuildContext context,
    LiveTournamentState state,
  ) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AlokasColors.forestCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AlokasColors.goldBorder),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AlokasBadge(
                  text: state.checkedIn
                      ? 'Checked In • ${state.categoryName}'
                      : 'Check-In Required • ${state.categoryName}',
                  color: state.checkedIn
                      ? AlokasColors.emeraldSuccess
                      : AlokasColors.amberWarning,
                  icon: state.checkedIn ? Icons.verified : Icons.qr_code,
                ),
                const SizedBox(height: 8),
                Text(
                  state.tournamentName,
                  style: const TextStyle(
                    color: AlokasColors.creamIvory,
                    fontWeight: FontWeight.w800,
                    fontSize: 15,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  state.venueName,
                  style: const TextStyle(
                    color: AlokasColors.mutedSage,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          OutlinedButton.icon(
            onPressed: () => _showQrPassModal(context, state),
            icon: const Icon(Icons.qr_code_2, size: 18),
            label: const Text('QR Pass'),
          ),
        ],
      ),
    );
  }

  Widget _buildNextMatchHeroCard(
    BuildContext context,
    LiveTournamentState state,
  ) {
    final isWhite = state.myColor.toUpperCase() == 'WHITE';
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
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              AlokasBadge(
                text: 'LIVE ROUND ${state.currentRound} OF ${state.totalRounds}',
                color: AlokasColors.brightGold,
                icon: Icons.sensors,
              ),
              Text(
                'Score: ${state.currentScore.toStringAsFixed(1)} / ${state.currentRound - 1}',
                style: const TextStyle(
                  color: AlokasColors.brightGold,
                  fontWeight: FontWeight.w800,
                  fontSize: 13.5,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
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
                      '#${state.myBoard}',
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
                      Row(
                        children: [
                          Icon(
                            Icons.circle,
                            size: 16,
                            color: isWhite
                                ? AlokasColors.deepForest
                                : AlokasColors.creamIvory,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            state.myColor,
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
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Opponent: ${state.opponentName} (${state.opponentRating})',
                        style: const TextStyle(
                          color: AlokasColors.creamIvory,
                          fontWeight: FontWeight.w800,
                          fontSize: 14,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        state.opponentSchool,
                        style: const TextStyle(
                          color: AlokasColors.mutedSage,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (state.disputeFlagged) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AlokasColors.amberWarning.withValues(alpha: 0.16),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: AlokasColors.amberWarning),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.warning_amber_rounded,
                    color: AlokasColors.amberWarning,
                    size: 18,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Arbiter Alert Active: ${state.disputeReason ?? "Verification requested"}',
                      style: const TextStyle(
                        color: AlokasColors.amberWarning,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => _showDisputeDialog(context, state),
              icon: const Icon(Icons.flag_outlined, size: 17),
              label: const Text('Flag Result Dispute for Arbiter'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRoundPairingsCard(LiveTournamentState state) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'MY ROUND-BY-ROUND PAIRINGS',
              style: TextStyle(
                color: AlokasColors.warmGold,
                fontSize: 12,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.8,
              ),
            ),
            const SizedBox(height: 10),
            ...state.roundPairings.map((p) {
              return Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AlokasColors.forestSurface,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AlokasColors.goldBorder),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: AlokasColors.warmGold.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        'R${p.round} • Bd ${p.board}',
                        style: const TextStyle(
                          color: AlokasColors.brightGold,
                          fontWeight: FontWeight.w800,
                          fontSize: 11.5,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        '⬜ ${p.whiteName} (${p.whiteRating})\n⬛ ${p.blackName} (${p.blackRating})',
                        style: const TextStyle(
                          color: AlokasColors.creamIvory,
                          fontSize: 12.5,
                          height: 1.35,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    AlokasBadge(
                      text: p.result,
                      color: p.result.contains('PENDING')
                          ? AlokasColors.amberWarning
                          : AlokasColors.emeraldSuccess,
                    ),
                  ],
                ),
              );
            }),
          ],
        ),
      ),
    );
  }

  Widget _buildStandingsCard(LiveTournamentState state) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'LIVE STANDINGS • ${state.categoryName.toUpperCase()}',
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AlokasColors.warmGold,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.8,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                const Text(
                  'Pts • BH • BH-C1 • SB',
                  style: TextStyle(
                    color: AlokasColors.mutedSage,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            ...state.standings.map((row) {
              return Container(
                margin: const EdgeInsets.only(bottom: 6),
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 9,
                ),
                decoration: BoxDecoration(
                  color: row.isMe
                      ? AlokasColors.warmGold.withValues(alpha: 0.18)
                      : AlokasColors.forestSurface,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: row.isMe
                        ? AlokasColors.brightGold
                        : AlokasColors.goldBorder,
                  ),
                ),
                child: Row(
                  children: [
                    SizedBox(
                      width: 28,
                      child: Text(
                        '#${row.rank}',
                        style: TextStyle(
                          color: row.isMe
                              ? AlokasColors.brightGold
                              : AlokasColors.mutedSage,
                          fontWeight: FontWeight.w800,
                          fontSize: 13,
                        ),
                      ),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${row.playerName} (${row.rating})',
                            style: TextStyle(
                              color: AlokasColors.creamIvory,
                              fontWeight: row.isMe
                                  ? FontWeight.w800
                                  : FontWeight.w600,
                              fontSize: 13,
                            ),
                          ),
                          Text(
                            row.school,
                            style: const TextStyle(
                              color: AlokasColors.mutedSage,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Text(
                      '${row.score.toStringAsFixed(1)} pts',
                      style: const TextStyle(
                        color: AlokasColors.brightGold,
                        fontWeight: FontWeight.w800,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '${row.buchholz.toStringAsFixed(1)} / ${row.buchholzCut1.toStringAsFixed(1)} / ${row.sonnebornBerger.toStringAsFixed(1)}',
                      style: const TextStyle(
                        color: AlokasColors.mutedSage,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}

class _QrMatrixPainter extends CustomPainter {
  final String seed;

  const _QrMatrixPainter({required this.seed});

  @override
  void paint(Canvas canvas, Size size) {
    const int grid = 15;
    final double cell = size.width / grid;
    final paint = Paint()
      ..color = AlokasColors.deepForest
      ..style = PaintingStyle.fill;

    for (int r = 0; r < grid; r++) {
      for (int c = 0; c < grid; c++) {
        final isCornerFinder =
            (r < 4 && c < 4) || (r < 4 && c >= grid - 4) || (r >= grid - 4 && c < 4);
        if (isCornerFinder) {
          final isBorder = r == 0 ||
              r == 3 ||
              c == 0 ||
              c == 3 ||
              r == grid - 1 ||
              r == grid - 4 ||
              c == grid - 1 ||
              c == grid - 4;
          final isCenter = (r >= 1 && r <= 2 && c >= 1 && c <= 2) ||
              (r >= 1 && r <= 2 && c >= grid - 3 && c <= grid - 2) ||
              (r >= grid - 3 && r <= grid - 2 && c >= 1 && c <= 2);
          if (isBorder || isCenter) {
            canvas.drawRect(
              Rect.fromLTWH(c * cell, r * cell, cell - 0.5, cell - 0.5),
              paint,
            );
          }
          continue;
        }
        final codeUnit = seed.codeUnitAt((r * grid + c) % seed.length);
        if ((codeUnit + r * 7 + c * 13) % 2 == 0) {
          canvas.drawRect(
            Rect.fromLTWH(c * cell, r * cell, cell - 0.5, cell - 0.5),
            paint,
          );
        }
      }
    }
  }

  @override
  bool shouldRepaint(covariant _QrMatrixPainter oldDelegate) =>
      oldDelegate.seed != seed;
}
