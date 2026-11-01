import 'package:flutter/material.dart';

import '../models/models.dart';
import '../services/alokas_api.dart';
import '../theme/alokas_theme.dart';

class CareerScreen extends StatelessWidget {
  final List<MobilePlayerProfile> profiles;
  final String selectedProfileId;
  final ValueChanged<String> onSelectProfile;
  final List<CertificateVaultItem> certificates;
  final List<PastTournamentRecord> pastTournaments;

  const CareerScreen({
    super.key,
    required this.profiles,
    required this.selectedProfileId,
    required this.onSelectProfile,
    required this.certificates,
    required this.pastTournaments,
  });

  MobilePlayerProfile get _activeProfile {
    return profiles.firstWhere(
      (p) => p.id == selectedProfileId,
      orElse: () => profiles.first,
    );
  }

  void _showCertificatePreview(
    BuildContext context,
    CertificateVaultItem cert,
  ) {
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
            const Icon(Icons.workspace_premium, color: AlokasColors.brightGold),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Digital Certificate • ${cert.serial}',
                style: const TextStyle(
                  color: AlokasColors.creamIvory,
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
        content: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AlokasColors.creamIvory,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AlokasColors.warmGold, width: 3),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'CHESS ALOKAS OFFICIAL CERTIFICATE',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AlokasColors.deepForest,
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.1,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                cert.type == 'winner'
                    ? 'CERTIFICATE OF EXCELLENCE'
                    : 'CERTIFICATE OF PARTICIPATION',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: AlokasColors.forestElevated,
                  fontSize: 15,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 10),
              const Text(
                'Proudly presented to',
                style: TextStyle(
                  color: AlokasColors.deepForest,
                  fontSize: 11.5,
                  fontStyle: FontStyle.italic,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                cert.recipientName,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: AlokasColors.deepForest,
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                cert.rank != null
                    ? 'Rank #${cert.rank} • ${cert.categoryName}'
                    : cert.categoryName,
                style: const TextStyle(
                  color: AlokasColors.forestCard,
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                '${cert.tournamentName}\nIssued ${cert.tournamentDate}',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: AlokasColors.deepForest,
                  fontSize: 11.5,
                ),
              ),
              const Divider(color: AlokasColors.warmGold, height: 18),
              Text(
                'Serial: ${cert.serial}\nSHA-256: ${cert.sha256Hash.substring(0, 24)}…',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: AlokasColors.forestCard,
                  fontSize: 10,
                  fontFamily: 'monospace',
                ),
              ),
            ],
          ),
        ),
        actions: [
          ElevatedButton.icon(
            onPressed: () => Navigator.of(ctx).pop(),
            icon: const Icon(Icons.verified, size: 17),
            label: const Text('Verified Authentic'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final profile = _activeProfile;
    final progression = AlokasApiClient.seedRatingProgression(profile.id);
    final totalWins = pastTournaments.fold<int>(0, (s, e) => s + e.wins);
    final totalDraws = pastTournaments.fold<int>(0, (s, e) => s + e.draws);
    final totalLosses = pastTournaments.fold<int>(0, (s, e) => s + e.losses);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
      children: [
        _buildProfileSelector(),
        const SizedBox(height: 12),
        _buildRatingsGrid(profile),
        const SizedBox(height: 14),
        _buildWdlPerformanceCard(totalWins, totalDraws, totalLosses),
        const SizedBox(height: 14),
        _buildRatingChartCard(profile, progression),
        const SizedBox(height: 16),
        _buildCertificateVaultSection(context),
        const SizedBox(height: 16),
        _buildPastTournamentsSection(),
      ],
    );
  }

  Widget _buildProfileSelector() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: profiles.map((p) {
          final selected = p.id == selectedProfileId;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ChoiceChip(
              selected: selected,
              selectedColor: AlokasColors.warmGold,
              backgroundColor: AlokasColors.forestCard,
              label: Text('${p.fullName} (@${p.username})'),
              labelStyle: TextStyle(
                color:
                    selected ? AlokasColors.deepForest : AlokasColors.creamIvory,
                fontWeight: FontWeight.w700,
                fontSize: 12.5,
              ),
              onSelected: (_) => onSelectProfile(p.id),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildRatingsGrid(MobilePlayerProfile profile) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      childAspectRatio: 1.9,
      children: [
        _ratingTile(
          'ALOKAS RATING',
          '${profile.alokasRating}',
          '+34 last 30d',
          AlokasColors.brightGold,
        ),
        _ratingTile(
          'FIDE RAPID',
          profile.fideRapid != null ? '${profile.fideRapid}' : 'Unrated',
          'FIDE ID: ${profile.fideId ?? "N/A"}',
          AlokasColors.emeraldSuccess,
        ),
        _ratingTile(
          'FIDE STANDARD',
          profile.fideStandard != null ? '${profile.fideStandard}' : 'Unrated',
          'Classical ELO',
          AlokasColors.skyInfo,
        ),
        _ratingTile(
          'FIDE BLITZ',
          profile.fideBlitz != null ? '${profile.fideBlitz}' : 'Unrated',
          'Speed Chess',
          AlokasColors.warmGold,
        ),
      ],
    );
  }

  Widget _ratingTile(
    String label,
    String value,
    String subtitle,
    Color accent,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AlokasColors.forestCard,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AlokasColors.goldBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: AlokasColors.mutedSage,
              fontSize: 10.5,
              fontWeight: FontWeight.w800,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: TextStyle(
              color: accent,
              fontSize: 22,
              fontWeight: FontWeight.w900,
            ),
          ),
          Text(
            subtitle,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AlokasColors.creamIvory,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWdlPerformanceCard(int wins, int draws, int losses) {
    final total = wins + draws + losses;
    final winPct = total > 0 ? ((wins / total) * 100).round() : 0;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(15),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'CAREER PERFORMANCE & COLOR SPLIT',
                    style: TextStyle(
                      color: AlokasColors.warmGold,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.7,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                AlokasBadge(
                  text: '$winPct% Win Rate ($total Games)',
                  color: AlokasColors.emeraldSuccess,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _statCol('WINS', '$wins', AlokasColors.emeraldSuccess),
                _statCol('DRAWS', '$draws', AlokasColors.amberWarning),
                _statCol('LOSSES', '$losses', AlokasColors.crimsonDanger),
                _statCol('WHITE SCORE', '74%', AlokasColors.creamIvory),
                _statCol('BLACK SCORE', '66%', AlokasColors.warmGold),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _statCol(String label, String val, Color color) {
    return Column(
      children: [
        Text(
          val,
          style: TextStyle(
            color: color,
            fontSize: 18,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: const TextStyle(
            color: AlokasColors.mutedSage,
            fontSize: 10,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }

  Widget _buildRatingChartCard(
    MobilePlayerProfile profile,
    List<RatingPoint> points,
  ) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'RATING PROGRESSION (2026 • ${profile.fullName.toUpperCase()})',
              style: const TextStyle(
                color: AlokasColors.warmGold,
                fontSize: 11.5,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.7,
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 120,
              width: double.infinity,
              child: CustomPaint(
                painter: _RatingProgressionPainter(points: points),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: points
                  .map(
                    (pt) => Text(
                      '${pt.label}\n${pt.rating}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: AlokasColors.mutedSage,
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  )
                  .toList(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCertificateVaultSection(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(
                  Icons.workspace_premium,
                  color: AlokasColors.brightGold,
                  size: 20,
                ),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text(
                    'DIGITAL CERTIFICATE & TROPHY VAULT',
                    style: TextStyle(
                      color: AlokasColors.warmGold,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.8,
                    ),
                  ),
                ),
                AlokasBadge(
                  text: '${certificates.length} Issued',
                  color: AlokasColors.warmGold,
                ),
              ],
            ),
            const SizedBox(height: 12),
            ...certificates.map((cert) {
              return Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AlokasColors.forestSurface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AlokasColors.goldBorder),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        AlokasBadge(
                          text: cert.serial,
                          color: AlokasColors.brightGold,
                          icon: Icons.verified_outlined,
                        ),
                        AlokasBadge(
                          text: cert.type == 'winner'
                              ? 'Winner • Rank #${cert.rank}'
                              : 'Participation',
                          color: cert.type == 'winner'
                              ? AlokasColors.emeraldSuccess
                              : AlokasColors.skyInfo,
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      cert.tournamentName,
                      style: const TextStyle(
                        color: AlokasColors.creamIvory,
                        fontWeight: FontWeight.w800,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      'Recipient: ${cert.recipientName} • ${cert.categoryName} • ${cert.tournamentDate}',
                      style: const TextStyle(
                        color: AlokasColors.mutedSage,
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerRight,
                      child: OutlinedButton.icon(
                        onPressed: () => _showCertificatePreview(context, cert),
                        icon: const Icon(Icons.visibility_outlined, size: 16),
                        label: const Text('Preview Certificate'),
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

  Widget _buildPastTournamentsSection() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'PAST TOURNAMENTS ATTENDED',
              style: TextStyle(
                color: AlokasColors.warmGold,
                fontSize: 12,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.8,
              ),
            ),
            const SizedBox(height: 10),
            ...pastTournaments.map((t) {
              return Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AlokasColors.forestSurface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AlokasColors.goldBorder),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            t.name,
                            style: const TextStyle(
                              color: AlokasColors.creamIvory,
                              fontWeight: FontWeight.w700,
                              fontSize: 13.5,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            '${t.date} • ${t.city} • ${t.category}',
                            style: const TextStyle(
                              color: AlokasColors.mutedSage,
                              fontSize: 11.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          '#${t.rank} (${t.score}/${t.rounds})',
                          style: const TextStyle(
                            color: AlokasColors.brightGold,
                            fontWeight: FontWeight.w800,
                            fontSize: 13,
                          ),
                        ),
                        Text(
                          '+${t.ratingDelta} ELO',
                          style: const TextStyle(
                            color: AlokasColors.emeraldSuccess,
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
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

class _RatingProgressionPainter extends CustomPainter {
  final List<RatingPoint> points;

  const _RatingProgressionPainter({required this.points});

  @override
  void paint(Canvas canvas, Size size) {
    if (points.length < 2) return;
    final ratings = points.map((p) => p.rating.toDouble()).toList();
    final minR = ratings.reduce((a, b) => a < b ? a : b) - 20;
    final maxR = ratings.reduce((a, b) => a > b ? a : b) + 20;
    final range = (maxR - minR).clamp(1.0, 2000.0);

    final gridPaint = Paint()
      ..color = AlokasColors.goldBorder
      ..strokeWidth = 1;
    for (int i = 0; i <= 3; i++) {
      final y = size.height * (i / 3);
      canvas.drawLine(Offset(0, y), Offset(size.width, y), gridPaint);
    }

    final linePath = Path();
    final dotPaint = Paint()..color = AlokasColors.brightGold;
    for (int i = 0; i < points.length; i++) {
      final x = (i / (points.length - 1)) * (size.width - 16) + 8;
      final norm = (points[i].rating - minR) / range;
      final y = size.height - (norm * (size.height - 20)) - 10;
      if (i == 0) {
        linePath.moveTo(x, y);
      } else {
        linePath.lineTo(x, y);
      }
      canvas.drawCircle(Offset(x, y), 4.5, dotPaint);
    }

    final strokePaint = Paint()
      ..color = AlokasColors.warmGold
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.6;
    canvas.drawPath(linePath, strokePaint);
  }

  @override
  bool shouldRepaint(covariant _RatingProgressionPainter oldDelegate) =>
      oldDelegate.points != points;
}
