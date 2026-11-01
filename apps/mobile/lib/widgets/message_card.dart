import 'package:flutter/material.dart';

import '../models/models.dart';
import '../theme/alokas_theme.dart';
import '../theme/alokas_tokens.dart';
import 'player_name.dart';

/// Shown above data that is still on screen after a refresh failed, so old data
/// is never mistaken for current data. Offline is normal, so this is amber.
class StaleNotice extends StatelessWidget {
  final String reason;
  final DateTime? lastLoadedAt;
  final VoidCallback onRetry;

  const StaleNotice({
    super.key,
    required this.reason,
    required this.lastLoadedAt,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    final loadedAt = lastLoadedAt;
    return Container(
      key: const Key('stale-notice'),
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
      color: p.waitWash,
      child: Row(
        children: [
          StatusSquare(color: p.wait, hollow: true),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              loadedAt == null
                  ? 'This may be out of date. $reason'
                  : 'Showing what was saved as of ${asOfLabel(loadedAt)}. $reason',
              style: atype(14, weight: 600, color: p.wait, height: 1.3),
            ),
          ),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

/// "2:32 PM" today, or with the date when it is older than today.
String asOfLabel(DateTime when, {DateTime? now}) {
  final local = when.toLocal();
  final today = (now ?? DateTime.now()).toLocal();
  final sameDay =
      local.year == today.year &&
      local.month == today.month &&
      local.day == today.day;
  return sameDay ? formatTimeForPeople(local) : formatDateTimeForPeople(local);
}

/// Solid means delivered, hollow means on this device or waiting.
class StatusSquare extends StatelessWidget {
  final Color color;
  final bool hollow;
  final double size;

  const StatusSquare({
    super.key,
    required this.color,
    this.hollow = false,
    this.size = 10,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: hollow ? null : color,
        border: Border.all(color: color, width: 2),
      ),
    );
  }
}

/// A piece marker. Physically correct in every theme, and always beside a word
/// or in a fixed column.
class PieceSquare extends StatelessWidget {
  final bool white;
  final double size;

  const PieceSquare({super.key, required this.white, this.size = 14});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: white ? AlokasTokens.pieceWhite : AlokasTokens.pieceBlack,
        border: Border.all(color: context.pal.ink, width: 1.5),
      ),
    );
  }
}

/// The brand mark: a split square, half white and half black.
class BrandMark extends StatelessWidget {
  final double size;

  const BrandMark({super.key, this.size = 24});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        border: Border.all(color: context.pal.ink, width: 2),
      ),
      child: const Row(
        children: [
          Expanded(child: ColoredBox(color: AlokasTokens.pieceWhite)),
          Expanded(child: ColoredBox(color: AlokasTokens.pieceBlack)),
        ],
      ),
    );
  }
}

/// A small heading above a section, with a heavy rule like a pairing sheet.
class SheetHeading extends StatelessWidget {
  final String text;
  final Widget? trailing;

  const SheetHeading(this.text, {super.key, this.trailing});

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    return Container(
      padding: const EdgeInsets.only(bottom: 6),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: p.ink, width: 2)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Text(
              text,
              style: atype(20, weight: 800, width: 108, color: p.ink),
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// A selectable box at least 44 px tall, filled when selected. Grows with its
/// content, so a long name wraps instead of being cut.
class ChoiceBox extends StatelessWidget {
  final bool selected;
  final VoidCallback? onTap;
  final Widget Function(Color foreground) builder;

  const ChoiceBox({
    super.key,
    required this.selected,
    required this.onTap,
    required this.builder,
  });

  /// A short label, such as a radius or a section.
  factory ChoiceBox.text({
    Key? key,
    required String label,
    required bool selected,
    required VoidCallback? onTap,
  }) {
    return ChoiceBox(
      key: key,
      selected: selected,
      onTap: onTap,
      builder: (foreground) => Text(
        label,
        style: atype(14, weight: 600, color: foreground, height: 1.2),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    final foreground = onTap == null
        ? p.ink3
        : selected
        ? p.onInk
        : p.ink;
    return Semantics(
      button: true,
      selected: selected,
      enabled: onTap != null,
      child: Material(
        color: selected ? p.ink : p.paper,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AlokasTheme.radius),
          side: BorderSide(
            color: selected ? p.ink : p.ruleStrong,
            width: 1.5,
          ),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AlokasTheme.radius),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 44, minWidth: 44),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Align(
                alignment: Alignment.centerLeft,
                widthFactor: 1,
                heightFactor: 1,
                child: builder(foreground),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Chooses which player a screen is about. Full names always, with enough
/// detail to tell two similar children apart.
class PlayerPicker extends StatelessWidget {
  final List<MobilePlayerProfile> profiles;
  final String? selectedId;
  final ValueChanged<String> onSelect;

  const PlayerPicker({
    super.key,
    required this.profiles,
    required this.selectedId,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final profile in profiles)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: ChoiceBox(
              key: Key('player-${profile.id}'),
              selected: profile.id == selectedId,
              onTap: () => onSelect(profile.id),
              builder: (foreground) => PlayerName(
                profile.fullName,
                detail: profile.disambiguator,
                color: foreground,
              ),
            ),
          ),
      ],
    );
  }
}

/// A pending-state placeholder. Words, no art.
class LoadingLine extends StatelessWidget {
  const LoadingLine({super.key});

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.all(24),
      child: Center(child: CircularProgressIndicator()),
    );
  }
}

/// Empty, error and "not available" states: what is true, then what to do.
class MessageCard extends StatelessWidget {
  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final bool isProblem;

  const MessageCard({
    super.key,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
    this.isProblem = false,
  });

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 16),
      decoration: BoxDecoration(
        color: isProblem ? p.flagWash : p.paper2,
        border: Border(
          left: BorderSide(color: isProblem ? p.flag : p.ink, width: 3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: atype(
              18,
              weight: 700,
              color: isProblem ? p.flag : p.ink,
              height: 1.25,
            ),
          ),
          if (message != null) ...[
            const SizedBox(height: 4),
            Text(
              message!,
              style: atype(16, color: isProblem ? p.flag : p.ink2, height: 1.35),
            ),
          ],
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: 12),
            OutlinedButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ],
      ),
    );
  }
}
