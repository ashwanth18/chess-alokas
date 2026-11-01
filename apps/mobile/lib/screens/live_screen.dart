import 'dart:async';

import 'package:flutter/material.dart';

import '../models/live.dart';
import '../services/alokas_api.dart';
import '../theme/alokas_theme.dart';
import '../widgets/message_card.dart';
import '../widgets/player_name.dart';

/// One standings row. Used here and in the short ladder on Matchday.
class StandingLine extends StatelessWidget {
  final StandingRow row;
  final LiveSnapshot snapshot;
  final String? me;

  const StandingLine({
    super.key,
    required this.row,
    required this.snapshot,
    this.me,
  });

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    final isMe = row.player.id == me;
    return Container(
      color: isMe ? p.penWash : null,
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
      decoration: null,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 44,
            child: Text(
              row.rankLabel,
              style: atype(16, weight: 800, color: p.ink, tabular: true),
            ),
          ),
          Expanded(
            child: PlayerName(
              row.player.name,
              number: row.player.seed,
              section: snapshot.sectionOf(row.player.id),
              color: p.ink,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            formatPoints(row.points),
            style: atype(16, weight: 800, color: p.ink, tabular: true),
          ),
        ],
      ),
    );
  }
}

/// Full standings and pairings from the tournament's public snapshot. Polls
/// while open, and always says how old what it shows is.
class LiveScreen extends StatefulWidget {
  final String token;
  final String title;
  final String? myParticipantId;
  final LiveSnapshot? initial;
  final DateTime? initialAt;
  final int initialTab;
  final Future<ApiResult<LiveSnapshot>> Function(String token) load;
  final ValueChanged<LiveSnapshot> onLoaded;
  final Duration pollInterval;

  const LiveScreen({
    super.key,
    required this.token,
    required this.title,
    this.myParticipantId,
    this.initial,
    this.initialAt,
    this.initialTab = 0,
    required this.load,
    required this.onLoaded,
    required this.pollInterval,
  });

  @override
  State<LiveScreen> createState() => _LiveScreenState();
}

class _LiveScreenState extends State<LiveScreen> {
  LiveSnapshot? _snapshot;
  DateTime? _updatedAt;
  String? _error;
  bool _loading = false;
  Timer? _timer;
  late int _tab = widget.initialTab;
  String? _categoryId;
  bool _categoryChosen = false;
  int? _round;

  @override
  void initState() {
    super.initState();
    _snapshot = widget.initial;
    _updatedAt = widget.initialAt;
    _refresh();
    _timer = Timer.periodic(widget.pollInterval, (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    if (_loading) return;
    setState(() => _loading = true);
    final result = await widget.load(widget.token);
    if (!mounted) return;
    setState(() {
      _loading = false;
      switch (result) {
        case ApiSuccess(:final value):
          _snapshot = value;
          _updatedAt = DateTime.now();
          _error = null;
          widget.onLoaded(value);
        case ApiFailure(:final message):
          _error = message;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    final snapshot = _snapshot;
    final me = widget.myParticipantId;
    return Scaffold(
      appBar: AppBar(title: Text(widget.title, maxLines: 2)),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
          children: [
            Row(
              children: [
                Expanded(
                  child: ChoiceBox.text(
                    key: const Key('tab-standings'),
                    label: 'Standings',
                    selected: _tab == 0,
                    onTap: () => setState(() => _tab = 0),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ChoiceBox.text(
                    key: const Key('tab-pairings'),
                    label: 'Pairings',
                    selected: _tab == 1,
                    onTap: () => setState(() => _tab = 1),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (_error != null)
              StaleNotice(
                reason: _error!,
                lastLoadedAt: _updatedAt,
                onRetry: _refresh,
              )
            else if (_updatedAt != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    StatusSquare(color: p.go),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'As of ${asOfLabel(_updatedAt!)}',
                        key: const Key('live-as-of'),
                        style: atype(14, weight: 600, color: p.go),
                      ),
                    ),
                  ],
                ),
              ),
            if (snapshot == null)
              _loading
                  ? const LoadingLine()
                  : MessageCard(
                      isProblem: true,
                      title: 'Could not load this tournament',
                      message: _error,
                      actionLabel: 'Retry',
                      onAction: _refresh,
                    )
            else if (_tab == 0)
              ..._standings(snapshot, me)
            else
              ..._pairings(snapshot, me),
          ],
        ),
      ),
    );
  }

  List<Widget> _standings(LiveSnapshot snapshot, String? me) {
    final p = context.pal;
    if (!_categoryChosen) {
      _categoryId = snapshot.sectionIdOf(me) ??
          (snapshot.categories.isEmpty ? null : snapshot.categories.first.id);
      _categoryChosen = true;
    }
    final rows = snapshot.standings(_categoryId);
    return [
      if (snapshot.categories.length > 1) ...[
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final category in snapshot.categories)
              ChoiceBox.text(
                label: category.name,
                selected: category.id == _categoryId,
                onTap: () => setState(() => _categoryId = category.id),
              ),
          ],
        ),
        const SizedBox(height: 12),
      ],
      Text(
        'By points. Tied players share a rank; the arbiter applies tie-breaks '
        'and has the official order.',
        style: atype(14, color: p.ink2),
      ),
      const SizedBox(height: 8),
      if (rows.isEmpty)
        const MessageCard(title: 'No players in this section yet'),
      for (final row in rows) ...[
        StandingLine(row: row, snapshot: snapshot, me: me),
        Divider(color: p.rule),
      ],
    ];
  }

  List<Widget> _pairings(LiveSnapshot snapshot, String? me) {
    final p = context.pal;
    final rounds = snapshot.rounds;
    if (rounds.isEmpty) {
      return const [
        MessageCard(
          title: 'No pairings yet',
          message: 'They appear here when the desk publishes a round.',
        ),
      ];
    }
    final current = rounds.contains(snapshot.currentRound)
        ? snapshot.currentRound
        : rounds.last;
    final round = rounds.contains(_round) ? _round! : current;
    return [
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final number in rounds)
            ChoiceBox.text(
              key: Key('round-$number'),
              label: 'Round $number',
              selected: number == round,
              onTap: () => setState(() => _round = number),
            ),
        ],
      ),
      const SizedBox(height: 12),
      for (final game in snapshot.pairings(round))
        _PairingRow(game: game, snapshot: snapshot, me: me),
      if (snapshot.pairings(round).isEmpty)
        Text('No boards in this round.', style: atype(16, color: p.ink2)),
    ];
  }
}

/// Board first, White above Black, result beside them: on a phone the two
/// names stack, so neither is ever squeezed.
class _PairingRow extends StatelessWidget {
  final LiveGame game;
  final LiveSnapshot snapshot;
  final String? me;

  const _PairingRow({required this.game, required this.snapshot, this.me});

  Widget _player(BuildContext context, String? id, bool white) {
    final p = context.pal;
    final player = snapshot.player(id);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 3),
            child: PieceSquare(white: white),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: player == null
                ? Text('Not listed', style: atype(16, color: p.ink2))
                : PlayerName(
                    player.name,
                    number: player.seed,
                    section: snapshot.sectionOf(player.id),
                    color: p.ink,
                  ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    final mine = me != null && game.involves(me!);
    final resultText = formatResult(game.result, isBye: game.isByeGame);
    return Container(
      color: mine ? p.penWash : null,
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
      foregroundDecoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: p.rule)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 44,
            child: Text(
              game.board == null || game.board == 0 ? '' : '${game.board}',
              style: atype(20, weight: 800, color: p.ink, tabular: true),
            ),
          ),
          Expanded(
            child: game.isByeGame
                ? _player(context, game.whiteId ?? game.blackId, true)
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _player(context, game.whiteId, true),
                      _player(context, game.blackId, false),
                    ],
                  ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 64,
            child: Text(
              resultText.isEmpty ? 'Playing' : resultText,
              textAlign: TextAlign.right,
              style: atype(
                resultText.isEmpty ? 14 : 16,
                weight: resultText.isEmpty ? 400 : 800,
                color: resultText.isEmpty ? p.ink2 : p.ink,
                tabular: true,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
