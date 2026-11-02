import 'package:flutter/material.dart';

import '../models/live.dart';
import '../models/models.dart';
import '../services/alokas_api.dart';
import '../theme/alokas_theme.dart';
import '../theme/alokas_tokens.dart';
import '../widgets/message_card.dart';
import '../widgets/player_name.dart';
import 'checkin_pass_screen.dart';
import 'live_screen.dart';

class MatchdayScreen extends StatelessWidget {
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

  /// Public tournament snapshots by live token, with when each was fetched.
  final Map<String, LiveSnapshot> liveByToken;
  final Map<String, DateTime> liveUpdatedAt;
  final Future<ApiResult<LiveSnapshot>> Function(String token) loadLive;
  final void Function(String token, LiveSnapshot snapshot) onLiveLoaded;
  final Duration pollInterval;

  const MatchdayScreen({
    super.key,
    required this.profiles,
    required this.selectedProfileId,
    required this.onSelectProfile,
    required this.loading,
    required this.error,
    required this.dashboard,
    this.dashboardUpdatedAt,
    required this.onRefresh,
    required this.onGoToAccount,
    this.liveByToken = const {},
    this.liveUpdatedAt = const {},
    required this.loadLive,
    required this.onLiveLoaded,
    required this.pollInterval,
  });

  MobilePlayerProfile? get _activeProfile {
    final matches = profiles.where((p) => p.id == selectedProfileId);
    return matches.isEmpty ? null : matches.first;
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(0, 12, 0, 32),
        children: _buildContent(context),
      ),
    );
  }

  Widget _gutter(Widget child) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 16),
    child: child,
  );

  List<Widget> _buildContent(BuildContext context) {
    final current = dashboard;
    final picker = profiles.length > 1
        ? [
            _gutter(
              PlayerPicker(
                profiles: profiles,
                selectedId: selectedProfileId,
                onSelect: onSelectProfile,
              ),
            ),
            const SizedBox(height: 8),
          ]
        : const <Widget>[];

    if (current == null && loading) return [...picker, const LoadingLine()];
    final problem = error;
    if (problem != null && current == null) {
      return [
        ...picker,
        _gutter(
          MessageCard(
            isProblem: true,
            title: 'Could not load your matches',
            message: problem,
            actionLabel: 'Retry',
            onAction: onRefresh,
          ),
        ),
      ];
    }
    if (profiles.isEmpty) {
      return [
        _gutter(
          MessageCard(
            title: 'No player profile yet',
            message: 'Add a player profile to follow their matches.',
            actionLabel: 'Go to Profiles',
            onAction: onGoToAccount,
          ),
        ),
      ];
    }
    final freshness = <Widget>[
      if (problem != null)
        _gutter(
          StaleNotice(
            reason: problem,
            lastLoadedAt: dashboardUpdatedAt,
            onRetry: onRefresh,
          ),
        )
      else if (dashboardUpdatedAt != null)
        _gutter(_FreshLine(updatedAt: dashboardUpdatedAt!)),
    ];
    final matches = current?.liveMatches ?? const <PlayerLiveMatch>[];
    if (matches.isEmpty) {
      return [
        ...picker,
        ...freshness,
        _gutter(
          const MessageCard(
            title: 'No match right now',
            message:
                'A pairing appears here once this player is in a tournament '
                'that has started.',
          ),
        ),
      ];
    }
    return [
      ...picker,
      ...freshness,
      for (final match in matches) ..._buildMatch(context, match),
    ];
  }

  int? _totalRounds(PlayerLiveMatch match) {
    for (final item in dashboard?.tournaments ?? const []) {
      if (item.tournamentId == match.tournamentId) return item.rounds;
    }
    return null;
  }

  String _roundLabel(PlayerLiveMatch match, LiveSnapshot? live) {
    final round = match.round;
    if (round == null) return 'Round not listed';
    final total = live?.totalRounds ?? _totalRounds(match);
    return total == null ? 'Round $round' : 'Round $round of $total';
  }

  List<Widget> _buildMatch(BuildContext context, PlayerLiveMatch match) {
    final token = match.publicToken;
    final live = token == null ? null : liveByToken[token];
    final liveAt = token == null ? null : liveUpdatedAt[token];
    final profile = _activeProfile;
    final me = match.participantId;

    void openLive(int tab) {
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => LiveScreen(
            token: token!,
            title: match.tournamentName ?? live?.name ?? 'Tournament',
            myParticipantId: me,
            initial: live,
            initialAt: liveAt,
            initialTab: tab,
            load: loadLive,
            onLoaded: (snapshot) => onLiveLoaded(token, snapshot),
            pollInterval: pollInterval,
          ),
        ),
      );
    }

    return [
      _gutter(
        Padding(
          padding: const EdgeInsets.only(top: 4, bottom: 8),
          child: Text(
            match.tournamentName ?? 'Unnamed tournament',
            style: atype(
              18,
              weight: 800,
              color: context.pal.accent,
              height: 1.2,
            ),
          ),
        ),
      ),
      MatchHero(
        match: match,
        live: live,
        playerName: profile?.fullName,
        roundLabel: _roundLabel(match, live),
      ),
      _gutter(_WhereWeStand(match: match, live: live, liveAt: liveAt)),
      if (live != null && me != null)
        _gutter(_EarlierRounds(live: live, me: me)),
      const SizedBox(height: 16),
      _gutter(
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (token != null) ...[
              ElevatedButton(
                key: const Key('open-pairings'),
                onPressed: () => openLive(1),
                child: const Text('All pairings'),
              ),
              ElevatedButton(
                key: const Key('open-standings'),
                onPressed: () => openLive(0),
                child: const Text('Full standings'),
              ),
            ],
            if (me != null && match.tournamentId != null && profile != null)
              OutlinedButton(
                key: const Key('open-checkin-pass'),
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => CheckInPassScreen(
                        tournamentName:
                            match.tournamentName ?? 'Unnamed tournament',
                        tournamentId: match.tournamentId!,
                        participantId: me,
                        playerName: live?.player(me)?.name ?? profile.fullName,
                        number: live?.player(me)?.seed,
                        section: live?.sectionOf(me),
                      ),
                    ),
                  );
                },
                child: const Text('Check-in pass'),
              ),
          ],
        ),
      ),
      const SizedBox(height: 24),
    ];
  }
}

class _FreshLine extends StatelessWidget {
  final DateTime updatedAt;

  const _FreshLine({required this.updatedAt});

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    return Padding(
      key: const Key('fresh-line'),
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          StatusSquare(color: p.go),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Updated ${asOfLabel(updatedAt)}',
              style: atype(14, weight: 600, color: p.go),
            ),
          ),
        ],
      ),
    );
  }
}

/// The parent's answer in one card: round, score, board, colour, opponent. The
/// inner block is a true white or true black, the colour the child plays, with
/// the very large board number on it.
class MatchHero extends StatelessWidget {
  final PlayerLiveMatch match;
  final LiveSnapshot? live;
  final String? playerName;
  final String roundLabel;

  const MatchHero({
    super.key,
    required this.match,
    this.live,
    this.playerName,
    required this.roundLabel,
  });

  Widget _topRow(BuildContext context) {
    final p = context.pal;
    final score = match.currentScore;
    return Row(
      children: [
        Expanded(
          child: Align(
            alignment: Alignment.centerLeft,
            child: AlokasBadge(text: roundLabel, icon: Icons.sensors),
          ),
        ),
        if (score != null) ...[
          const SizedBox(width: 8),
          Text.rich(
            key: const Key('hero-score'),
            TextSpan(
              children: [
                TextSpan(
                  text: 'Score ',
                  style: atype(14, weight: 600, color: p.ink2),
                ),
                TextSpan(
                  text: formatPoints(score),
                  style: atype(24, weight: 800, color: p.accent, tabular: true),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _who(BuildContext context) {
    final name = playerName;
    if (name == null) return const SizedBox.shrink();
    final me = match.participantId;
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: PlayerName(
        name,
        key: const Key('hero-player'),
        size: 20,
        weight: 700,
        color: context.pal.ink,
        number: live?.player(me)?.seed,
        section: live?.sectionOf(me),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    if (match.isAwaitingPairing) {
      return _neutral(
        context,
        title: 'Pairings are not out yet',
        message:
            'The board appears here as soon as the desk publishes this round.',
      );
    }
    if (match.isBye) {
      return _neutral(
        context,
        title: 'Bye this round',
        message: 'No game this round.',
      );
    }
    if (!match.isWhite && !match.isBlack) {
      return _neutral(
        context,
        title: 'Colour not listed',
        message: match.board == null ? null : 'Board ${match.board}',
      );
    }

    final white = match.isWhite;
    final background = white
        ? AlokasTokens.pieceWhite
        : AlokasTokens.pieceBlack;
    final foreground = white
        ? AlokasTokens.pieceBlack
        : AlokasTokens.pieceWhite;
    final finished = match.hasResult;
    final colourWord = white ? 'White' : 'Black';

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: BrandCard(
        key: const Key('hero-card'),
        strong: true,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _topRow(context),
            _who(context),
            const SizedBox(height: 12),
            Container(
              key: Key(white ? 'hero-white' : 'hero-black'),
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
              decoration: BoxDecoration(
                color: background,
                borderRadius: BorderRadius.circular(AlokasTheme.radius),
                border: Border.all(color: p.accent),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          match.board == null
                              ? 'Board not listed'
                              : finished
                              ? 'Board ${match.board}'
                              : 'Board',
                          style: atype(20, weight: 700, color: foreground),
                        ),
                      ),
                      Text(
                        finished ? 'Result' : 'Playing now',
                        style: atype(14, weight: 600, color: foreground),
                      ),
                    ],
                  ),
                  if (finished)
                    Text(
                      formatResult(match.result!),
                      style: atype(
                        64,
                        weight: 800,
                        width: 112,
                        color: foreground,
                        tabular: true,
                        height: 1.15,
                      ),
                    )
                  else if (match.board != null)
                    Text(
                      '${match.board}',
                      key: const Key('hero-board'),
                      style: atype(
                        96,
                        weight: 800,
                        width: 112,
                        color: foreground,
                        tabular: true,
                        height: 1.05,
                      ),
                    ),
                  Text(
                    finished
                        ? '${match.outcomeWord ?? 'Result in'}, playing $colourWord'
                        : 'Plays $colourWord',
                    key: const Key('hero-colour'),
                    style: atype(
                      24,
                      weight: 800,
                      color: foreground,
                      height: 1.2,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            _opponent(context),
          ],
        ),
      ),
    );
  }

  Widget _opponent(BuildContext context) {
    final p = context.pal;
    final name = match.opponentName;
    final rating = match.opponentRating;
    final opponentId = match.opponentId;
    if (name == null) {
      return Text(
        'Opponent not listed',
        style: atype(18, weight: 600, color: p.ink),
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.person_pin, color: p.accent, size: 28),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Against', style: atype(14, weight: 600, color: p.accent)),
              const SizedBox(height: 2),
              PlayerName(
                name,
                size: 18,
                weight: 700,
                color: p.ink,
                number: live?.player(opponentId)?.seed,
                section: live?.sectionOf(opponentId),
              ),
              if (rating != null)
                Text(
                  'Rating $rating',
                  style: atype(14, color: p.ink2, tabular: true),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _neutral(
    BuildContext context, {
    required String title,
    String? message,
  }) {
    final p = context.pal;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: BrandCard(
        key: const Key('hero-neutral'),
        strong: true,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _topRow(context),
            _who(context),
            const SizedBox(height: 12),
            Text(
              title,
              style: atype(28, weight: 800, color: p.ink, height: 1.15),
            ),
            if (message != null) ...[
              const SizedBox(height: 8),
              Text(message, style: atype(16, color: p.ink2, height: 1.35)),
            ],
          ],
        ),
      ),
    );
  }
}

class _WhereWeStand extends StatelessWidget {
  final PlayerLiveMatch match;
  final LiveSnapshot? live;
  final DateTime? liveAt;

  const _WhereWeStand({required this.match, this.live, this.liveAt});

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    final snapshot = live;
    final me = match.participantId;
    final score = match.currentScore;
    final sectionId = snapshot?.sectionIdOf(me);
    final rows = snapshot?.standings(sectionId) ?? const <StandingRow>[];
    final index = rows.indexWhere((r) => r.player.id == me);

    final near = <StandingRow>[];
    if (index >= 0) {
      final from = (index - 2).clamp(
        0,
        (rows.length - 5).clamp(0, rows.length),
      );
      near.addAll(rows.skip(from).take(5));
    }

    return Padding(
      padding: const EdgeInsets.only(top: 24),
      child: BrandCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SheetHeading('Where we stand'),
            const SizedBox(height: 8),
            if (score != null)
              Text.rich(
                key: const Key('current-score'),
                TextSpan(
                  children: [
                    TextSpan(
                      text: formatPoints(score),
                      style: atype(
                        44,
                        weight: 800,
                        width: 112,
                        color: p.accent,
                        tabular: true,
                      ),
                    ),
                    TextSpan(
                      text: score == 1 ? ' point' : ' points',
                      style: atype(16, color: p.ink2),
                    ),
                  ],
                ),
              ),
            if (snapshot == null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  match.publicToken == null
                      ? 'The organizer has not turned on the live page, so rank '
                            'and other boards are not available.'
                      : 'Rank will appear when the standings load.',
                  style: atype(14, color: p.ink2),
                ),
              ),
            if (index >= 0) ...[
              Padding(
                padding: const EdgeInsets.only(top: 4, bottom: 8),
                child: Text(
                  'Rank ${rows[index].rankLabel} of ${rows.length}'
                  '${snapshot!.sectionOf(me) == null ? '' : ' in ${snapshot.sectionOf(me)}'}',
                  style: atype(16, weight: 600, color: p.ink),
                ),
              ),
              for (final row in near)
                StandingLine(row: row, snapshot: snapshot, me: me),
              if (liveAt != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    'By points. Tied players share a rank; the arbiter applies '
                    'tie-breaks. As of ${asOfLabel(liveAt!)}.',
                    style: atype(14, color: p.ink2),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _EarlierRounds extends StatelessWidget {
  final LiveSnapshot live;
  final String me;

  const _EarlierRounds({required this.live, required this.me});

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    final rounds = live.historyOf(me).where((r) => !r.game.isPending).toList();
    if (rounds.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SheetHeading('Earlier rounds'),
          for (final round in rounds)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 10),
              decoration: BoxDecoration(
                border: Border(bottom: BorderSide(color: p.rule)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 28,
                    child: Text(
                      '${round.round}',
                      style: atype(
                        16,
                        weight: 800,
                        color: p.ink,
                        tabular: true,
                      ),
                    ),
                  ),
                  if (round.playedWhite != null) ...[
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: PieceSquare(white: round.playedWhite!),
                    ),
                    const SizedBox(width: 8),
                  ],
                  Expanded(
                    child: round.opponent == null
                        ? Text('Bye', style: atype(16, color: p.ink))
                        : PlayerName(round.opponent!.name, color: p.ink),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    formatPoints(round.game.pointsFor(me)),
                    style: atype(16, weight: 800, color: p.ink, tabular: true),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
