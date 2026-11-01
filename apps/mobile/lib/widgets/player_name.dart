import 'package:flutter/material.dart';

import '../theme/alokas_theme.dart';

/// A name split at its patronym marker: the eye finds the child first, and the
/// full legal name is still there.
class NameParts {
  final String given;

  /// The marker and what follows it, such as "binti Queen Gambit"; else null.
  final String? patronym;

  const NameParts(this.given, this.patronym);

  String get full => patronym == null ? given : '$given $patronym';
}

const Set<String> _markers = {'bin', 'binti', 'a/l', 'a/p'};
const Set<String> _lowerWords = {..._markers, 'bt', 's/o', 'd/o'};

/// Words in all capitals read slower and cost width, so a name typed entirely
/// in capitals is shown in Title Case. Mixed case stays exactly as typed, and
/// the stored name is never changed.
String displayPlayerName(String raw) {
  final name = raw.trim().replaceAll(RegExp(r'\s+'), ' ');
  final hasLower = name.contains(RegExp(r'[a-z]'));
  final hasUpper = name.contains(RegExp(r'[A-Z]'));
  if (hasLower || !hasUpper) return name;
  return name
      .split(' ')
      .map((word) {
        final lower = word.toLowerCase();
        if (_lowerWords.contains(lower)) return lower;
        return lower
            .split('-')
            .map((p) => p.isEmpty ? p : p[0].toUpperCase() + p.substring(1))
            .join('-');
      })
      .join(' ');
}

NameParts splitPlayerName(String raw) {
  final words = displayPlayerName(raw).split(' ');
  // A marker needs a name before it and a name after it.
  for (var i = 1; i < words.length - 1; i++) {
    if (_markers.contains(words[i].toLowerCase())) {
      return NameParts(
        words.sublist(0, i).join(' '),
        words.sublist(i).join(' '),
      );
    }
  }
  return NameParts(words.join(' '), null);
}

/// "#12 · Under 12". Null when neither is known.
String? disambiguatorFor(int? number, String? section) {
  final parts = [
    if (number != null && number > 0) '#$number',
    if (section != null && section.trim().isNotEmpty) section.trim(),
  ];
  return parts.isEmpty ? null : parts.join(' · ');
}

/// The only way the app shows a player's name.
///
/// It never truncates. It first narrows along the font's width axis (100 down
/// to 62%), then wraps at the patronym, then wraps normally. Size never drops.
/// Pass [number] and [section], or [detail], so that two similar children can't
/// look identical.
class PlayerName extends StatelessWidget {
  static const List<double> widthSteps = [100, 92, 84, 76, 68, 62];
  static const double _fitMargin = 1.08;

  final String name;
  final int? number;
  final String? section;

  /// Shown instead of number and section when those aren't known, such as
  /// "Born 2015 · Child".
  final String? detail;
  final double size;
  final int weight;
  final Color? color;

  const PlayerName(
    this.name, {
    super.key,
    this.number,
    this.section,
    this.detail,
    this.size = 16,
    this.weight = 600,
    this.color,
  });

  double _widthThatFits(
    BuildContext context,
    String text,
    TextStyle Function(double width) style,
    double maxWidth,
  ) {
    final direction = Directionality.of(context);
    final scaler = MediaQuery.textScalerOf(context);
    for (final step in widthSteps) {
      final painter = TextPainter(
        text: TextSpan(text: text, style: style(step)),
        textDirection: direction,
        textScaler: scaler,
        maxLines: 1,
      )..layout();
      // A margin: measured and painted widths can differ slightly on a device.
      final fits = painter.width * _fitMargin <= maxWidth;
      painter.dispose();
      if (fits) return step;
    }
    return widthSteps.last;
  }

  @override
  Widget build(BuildContext context) {
    final parts = splitPlayerName(name);
    final ink = color ?? DefaultTextStyle.of(context).style.color;
    final extra = disambiguatorFor(number, section) ?? detail;
    final quietSize = size > 16 ? size - 2 : size;

    TextStyle givenStyle(double w) =>
        atype(size, weight: weight, color: ink, width: w, height: 1.2);
    // One step quieter by weight alone, so contrast is kept on the hero.
    TextStyle restStyle(double w) =>
        atype(quietSize, weight: 400, color: ink, width: w, height: 1.2);

    return Semantics(
      label: extra == null ? parts.full : '${parts.full}, $extra',
      excludeSemantics: true,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final max = constraints.maxWidth;
          final Widget nameBlock;
          final patronym = parts.patronym;
          if (patronym == null) {
            final w = max.isFinite
                ? _widthThatFits(context, parts.given, givenStyle, max)
                : 100.0;
            nameBlock = Text(parts.given, style: givenStyle(w));
          } else {
            final oneLine = TextSpan(
              children: [
                TextSpan(text: '${parts.given} ', style: givenStyle(100)),
                TextSpan(text: patronym, style: restStyle(100)),
              ],
            );
            final painter = TextPainter(
              text: oneLine,
              textDirection: Directionality.of(context),
              textScaler: MediaQuery.textScalerOf(context),
              maxLines: 1,
            )..layout();
            final fitsOnOneLine =
                !max.isFinite || painter.width * _fitMargin <= max;
            painter.dispose();
            if (fitsOnOneLine) {
              nameBlock = Text.rich(oneLine);
            } else {
              final givenWidth = _widthThatFits(
                context,
                parts.given,
                givenStyle,
                max,
              );
              final restWidth = _widthThatFits(
                context,
                patronym,
                restStyle,
                max,
              );
              nameBlock = Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(parts.given, style: givenStyle(givenWidth)),
                  Text(patronym, style: restStyle(restWidth)),
                ],
              );
            }
          }
          if (extra == null) return nameBlock;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              nameBlock,
              const SizedBox(height: 2),
              Text(
                extra,
                style: atype(
                  14,
                  weight: 400,
                  color: ink,
                  tabular: true,
                  height: 1.25,
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
