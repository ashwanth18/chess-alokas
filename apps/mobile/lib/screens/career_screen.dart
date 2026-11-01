import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../models/models.dart';
import '../services/alokas_api.dart';
import '../services/file_gateway.dart';
import '../theme/alokas_theme.dart';
import '../widgets/message_card.dart';
import '../widgets/player_name.dart';

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
    void say(String text) =>
        messenger.showSnackBar(SnackBar(content: Text(text)));

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
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
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
          title: 'Sign in to see your career',
          message: 'Ratings, results and certificates appear here.',
          actionLabel: 'Go to Sign In',
          onAction: onGoToAccount,
        ),
      ];
    }
    if (current == null && loading) return const [LoadingLine()];
    final problem = error;
    if (problem != null && (current == null || profile == null)) {
      return [
        MessageCard(
          isProblem: true,
          title: 'Could not load this career',
          message: problem,
          actionLabel: 'Retry',
          onAction: onRefresh,
        ),
      ];
    }
    if (profile == null) {
      return [
        MessageCard(
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
      PlayerPicker(
        profiles: profiles,
        selectedId: selectedProfileId,
        onSelect: onSelectProfile,
      ),
      const SizedBox(height: 16),
      _buildRatings(context, profile),
      const SizedBox(height: 24),
      _buildPerformance(context, current?.stats),
      const SizedBox(height: 24),
      _buildCertificates(context, current?.certificates ?? const []),
      const SizedBox(height: 24),
      _buildTournaments(context, current?.tournaments ?? const []),
      const SizedBox(height: 16),
      Text(
        'Rating history charts are not available yet.',
        style: atype(14, color: context.pal.ink2),
      ),
    ];
  }

  String _rating(int? value) => value == null ? 'None' : '$value';

  Widget _buildRatings(BuildContext context, MobilePlayerProfile profile) {
    final p = context.pal;
    Widget line(String label, String value, String? note) => Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: p.rule)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: atype(16, weight: 600, color: p.ink)),
                if (note != null)
                  Text(note, style: atype(14, color: p.ink2)),
              ],
            ),
          ),
          Text(
            value,
            style: atype(24, weight: 800, color: p.ink, tabular: true),
          ),
        ],
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SheetHeading('Ratings'),
        line('Alokas', _rating(profile.alokasRating), 'On this profile'),
        line(
          'FIDE Rapid',
          _rating(profile.fideRapid),
          profile.fideId == null
              ? 'No FIDE ID saved'
              : 'FIDE ID: ${profile.fideId}',
        ),
        line('FIDE Standard', _rating(profile.fideStandard), null),
        line('FIDE Blitz', _rating(profile.fideBlitz), null),
      ],
    );
  }

  Widget _buildPerformance(BuildContext context, PlayerCareerStats? stats) {
    final p = context.pal;
    final games = stats?.gamesPlayed;
    final wins = stats?.wins;
    Widget stat(String label, String value) => Column(
      children: [
        Text(
          value,
          style: atype(24, weight: 800, color: p.ink, tabular: true),
        ),
        Text(label, style: atype(13, color: p.ink2)),
      ],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SheetHeading('Career'),
        const SizedBox(height: 8),
        if (stats == null || (games ?? 0) == 0)
          Text(
            'No completed games on record for this player.',
            style: atype(16, color: p.ink2),
          )
        else ...[
          if (games != null && wins != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: AlokasBadge(
                text:
                    '${((wins / games) * 100).round()}% Win Rate (${pluralize(games, 'Game')})',
              ),
            ),
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            spacing: 16,
            runSpacing: 8,
            children: [
              stat('Events', '${stats.tournamentsCount ?? '–'}'),
              stat('Wins', '${stats.wins ?? '–'}'),
              stat('Draws', '${stats.draws ?? '–'}'),
              stat('Losses', '${stats.losses ?? '–'}'),
              stat('Points', stats.totalPoints?.toStringAsFixed(1) ?? '–'),
            ],
          ),
        ],
      ],
    );
  }

  Widget _buildCertificates(
    BuildContext context,
    List<PlayerCertificate> certificates,
  ) {
    final p = context.pal;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SheetHeading(
          'Certificates',
          trailing: Text(
            '${certificates.length} issued',
            style: atype(14, color: p.ink2),
          ),
        ),
        if (certificates.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'No certificates issued to this player yet.',
              style: atype(16, color: p.ink2),
            ),
          ),
        for (final cert in certificates)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: p.rule)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  cert.tournamentName ?? 'Unnamed tournament',
                  style: atype(16, weight: 700, color: p.ink, height: 1.25),
                ),
                if (cert.recipientName != null)
                  PlayerName(cert.recipientName!, weight: 400, color: p.ink),
                const SizedBox(height: 4),
                Text(
                  [
                    cert.type == 'winner'
                        ? (cert.rank == null
                              ? 'Winner'
                              : 'Winner, rank ${cert.rank}')
                        : 'Participation',
                    ?formatDateForPeople(cert.tournamentDate),
                    ?cert.serial,
                  ].join(' · '),
                  style: atype(14, color: p.ink2),
                ),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: () => _download(context, cert),
                  child: const Text('Download PDF'),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildTournaments(
    BuildContext context,
    List<PlayerTournamentHistoryItem> items,
  ) {
    final p = context.pal;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SheetHeading('Tournaments'),
        if (items.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'No tournaments linked to this player. If they have played '
              'before, try "Claim Past Tournaments" on the Account tab.',
              style: atype(16, color: p.ink2),
            ),
          ),
        for (final t in items)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: p.rule)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        t.tournamentName ?? 'Unnamed tournament',
                        style: atype(16, weight: 600, color: p.ink, height: 1.25),
                      ),
                      Text(
                        formatDateForPeople(t.tournamentDate) ??
                            'Date not listed',
                        style: atype(14, color: p.ink2),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    if (t.score != null)
                      Text(
                        t.rounds == null
                            ? '${t.score} pts'
                            : '${t.score} / ${t.rounds}',
                        style: atype(
                          16,
                          weight: 800,
                          color: p.ink,
                          tabular: true,
                        ),
                      ),
                    Text(
                      'W${t.wins ?? '–'} D${t.draws ?? '–'} L${t.losses ?? '–'}',
                      style: atype(14, color: p.ink2, tabular: true),
                    ),
                  ],
                ),
              ],
            ),
          ),
      ],
    );
  }
}
