import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../models/models.dart';
import '../services/alokas_api.dart';
import '../services/file_gateway.dart';
import '../theme/alokas_theme.dart';
import '../widgets/message_card.dart';

class CareerScreen extends StatelessWidget {
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
  final Future<ApiResult<Uint8List>> Function(String issueId)
  onDownloadCertificate;
  final CertificateSaver certificateSaver;

  const CareerScreen({
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
    required this.onDownloadCertificate,
    required this.certificateSaver,
  });

  MobilePlayerProfile? get _activeProfile {
    final matches = profiles.where((p) => p.id == selectedProfileId);
    return matches.isEmpty ? null : matches.first;
  }

  Future<void> _download(
    BuildContext context,
    PlayerCertificate certificate,
  ) async {
    final messenger = ScaffoldMessenger.of(context);
    void say(String text) {
      messenger.showSnackBar(
        SnackBar(
          backgroundColor: AlokasColors.forestElevated,
          content: Text(
            text,
            style: const TextStyle(color: AlokasColors.creamIvory),
          ),
        ),
      );
    }

    final result = await onDownloadCertificate(certificate.id);
    switch (result) {
      case ApiFailure(:final message):
        say('Certificate download failed: $message');
      case ApiSuccess(:final value):
        try {
          final saved = await certificateSaver(certificate.fileName, value);
          if (saved) say('Certificate saved.');
        } on Object {
          say('The certificate downloaded but could not be saved.');
        }
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: AlokasColors.warmGold,
      backgroundColor: AlokasColors.forestCard,
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
        children: _buildContent(context),
      ),
    );
  }

  List<Widget> _buildContent(BuildContext context) {
    final current = dashboard;
    final profile = _activeProfile;
    if (!isSignedIn) {
      return [
        MessageCard(
          icon: Icons.login,
          title: 'Sign in to see your career',
          message: 'Ratings, results and certificates appear here.',
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
    if (problem != null && (current == null || profile == null)) {
      return [
        MessageCard(
          icon: Icons.cloud_off,
          accent: AlokasColors.crimsonDanger,
          title: 'Could not load this career',
          message: error,
          actionLabel: 'Retry',
          onAction: onRefresh,
        ),
      ];
    }
    if (profile == null) {
      return [
        MessageCard(
          icon: Icons.person_add_alt_1,
          title: 'No player profile yet',
          message: 'Add a player profile to see their career here.',
          actionLabel: 'Go to Profiles',
          onAction: onGoToAccount,
        ),
      ];
    }
    return [
      if (problem != null)
        StaleNotice(
          reason: problem,
          lastLoadedAt: dashboardUpdatedAt,
          onRetry: onRefresh,
        ),
      _buildProfileSelector(),
      const SizedBox(height: 12),
      _buildRatingsGrid(profile),
      const SizedBox(height: 14),
      _buildPerformanceCard(current?.stats),
      const SizedBox(height: 16),
      _buildCertificateSection(context, current?.certificates ?? const []),
      const SizedBox(height: 16),
      _buildTournamentsSection(current?.tournaments ?? const []),
      const SizedBox(height: 16),
      const Text(
        'Rating history charts are not available yet.',
        textAlign: TextAlign.center,
        style: TextStyle(color: AlokasColors.mutedSage, fontSize: 12),
      ),
    ];
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
              label: Text(
                p.username == null
                    ? p.fullName
                    : '${p.fullName} (@${p.username})',
              ),
              labelStyle: TextStyle(
                color: selected
                    ? AlokasColors.deepForest
                    : AlokasColors.creamIvory,
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

  String _rating(int? value) => value == null ? 'None' : '$value';

  Widget _buildRatingsGrid(MobilePlayerProfile profile) {
    // Rows sized by their content, so large system fonts cannot overflow.
    Widget row(Widget left, Widget right) => IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(child: left),
          const SizedBox(width: 10),
          Expanded(child: right),
        ],
      ),
    );
    return Column(
      children: [
        row(
          _ratingTile(
            'ALOKAS RATING',
            _rating(profile.alokasRating),
            'On this profile',
            AlokasColors.brightGold,
          ),
          _ratingTile(
            'FIDE RAPID',
            _rating(profile.fideRapid),
            profile.fideId == null
                ? 'No FIDE ID saved'
                : 'FIDE ID: ${profile.fideId}',
            AlokasColors.emeraldSuccess,
          ),
        ),
        const SizedBox(height: 10),
        row(
          _ratingTile(
            'FIDE STANDARD',
            _rating(profile.fideStandard),
            'Classical',
            AlokasColors.skyInfo,
          ),
          _ratingTile(
            'FIDE BLITZ',
            _rating(profile.fideBlitz),
            'Blitz',
            AlokasColors.warmGold,
          ),
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
            style: const TextStyle(
              color: AlokasColors.creamIvory,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPerformanceCard(PlayerCareerStats? stats) {
    final games = stats?.gamesPlayed;
    final wins = stats?.wins;
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
                    'CAREER PERFORMANCE',
                    style: TextStyle(
                      color: AlokasColors.warmGold,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.7,
                    ),
                  ),
                ),
                if (games != null && games > 0 && wins != null) ...[
                  const SizedBox(width: 8),
                  AlokasBadge(
                    text:
                        '${((wins / games) * 100).round()}% Win Rate (${pluralize(games, 'Game')})',
                    color: AlokasColors.emeraldSuccess,
                  ),
                ],
              ],
            ),
            const SizedBox(height: 10),
            if (stats == null || (games ?? 0) == 0)
              const Text(
                'No completed games on record for this player.',
                style: TextStyle(color: AlokasColors.mutedSage, fontSize: 12.5),
              )
            else
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _statCol(
                    'EVENTS',
                    '${stats.tournamentsCount ?? '–'}',
                    AlokasColors.creamIvory,
                  ),
                  _statCol(
                    'WINS',
                    '${stats.wins ?? '–'}',
                    AlokasColors.emeraldSuccess,
                  ),
                  _statCol(
                    'DRAWS',
                    '${stats.draws ?? '–'}',
                    AlokasColors.amberWarning,
                  ),
                  _statCol(
                    'LOSSES',
                    '${stats.losses ?? '–'}',
                    AlokasColors.crimsonDanger,
                  ),
                  _statCol(
                    'POINTS',
                    stats.totalPoints?.toStringAsFixed(1) ?? '–',
                    AlokasColors.warmGold,
                  ),
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

  Widget _buildCertificateSection(
    BuildContext context,
    List<PlayerCertificate> certificates,
  ) {
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
                    'CERTIFICATES',
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
            if (certificates.isEmpty)
              const Text(
                'No certificates issued to this player yet.',
                style: TextStyle(color: AlokasColors.mutedSage, fontSize: 12.5),
              ),
            ...certificates.map((cert) {
              final details = [
                cert.recipientName,
                formatDateForPeople(cert.tournamentDate),
              ].whereType<String>().join(' • ');
              final rank = cert.rank;
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
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        if (cert.serial != null)
                          AlokasBadge(
                            text: cert.serial!,
                            color: AlokasColors.brightGold,
                          ),
                        AlokasBadge(
                          text: cert.type == 'winner'
                              ? (rank == null
                                    ? 'Winner'
                                    : 'Winner • Rank #$rank')
                              : 'Participation',
                          color: cert.type == 'winner'
                              ? AlokasColors.emeraldSuccess
                              : AlokasColors.skyInfo,
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      cert.tournamentName ?? 'Unnamed tournament',
                      style: const TextStyle(
                        color: AlokasColors.creamIvory,
                        fontWeight: FontWeight.w800,
                        fontSize: 14,
                      ),
                    ),
                    if (details.isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Text(
                        details,
                        style: const TextStyle(
                          color: AlokasColors.mutedSage,
                          fontSize: 12,
                        ),
                      ),
                    ],
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerRight,
                      child: OutlinedButton.icon(
                        onPressed: () => _download(context, cert),
                        icon: const Icon(Icons.download, size: 16),
                        label: const Text('Download PDF'),
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

  Widget _buildTournamentsSection(List<PlayerTournamentHistoryItem> items) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'TOURNAMENTS',
              style: TextStyle(
                color: AlokasColors.warmGold,
                fontSize: 12,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.8,
              ),
            ),
            const SizedBox(height: 10),
            if (items.isEmpty)
              const Text(
                'No tournaments linked to this player. If they have played before, try "Claim Past Tournaments" on the Family & Auth tab.',
                style: TextStyle(color: AlokasColors.mutedSage, fontSize: 12.5),
              ),
            ...items.map((t) {
              final score = t.score;
              final rounds = t.rounds;
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
                            t.tournamentName ?? 'Unnamed tournament',
                            style: const TextStyle(
                              color: AlokasColors.creamIvory,
                              fontWeight: FontWeight.w700,
                              fontSize: 13.5,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            formatDateForPeople(t.tournamentDate) ??
                                'Date not listed',
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
                        if (score != null)
                          Text(
                            rounds == null ? '$score pts' : '$score / $rounds',
                            style: const TextStyle(
                              color: AlokasColors.brightGold,
                              fontWeight: FontWeight.w800,
                              fontSize: 13,
                            ),
                          ),
                        Text(
                          'W${t.wins ?? '–'} D${t.draws ?? '–'} L${t.losses ?? '–'}',
                          style: const TextStyle(
                            color: AlokasColors.mutedSage,
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
