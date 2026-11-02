import 'package:flutter/material.dart';

import '../models/models.dart';
import '../theme/alokas_theme.dart';

/// A small icon and a short label: the app's way of stating one fact.
class EventFact extends StatelessWidget {
  final IconData icon;
  final String text;
  final Color? color;
  final bool strong;

  const EventFact({
    super.key,
    required this.icon,
    required this.text,
    this.color,
    this.strong = false,
  });

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 1),
          child: Icon(icon, size: 16, color: color ?? p.accent),
        ),
        const SizedBox(width: 5),
        Flexible(
          child: Text(
            text,
            style: atype(
              14,
              weight: strong ? 700 : 600,
              color: color ?? p.ink,
              height: 1.25,
              tabular: true,
            ),
          ),
        ),
      ],
    );
  }
}

/// Entry fee and players, labelled so that neither can be mistaken for anything
/// else.
class EntryAndPlayers extends StatelessWidget {
  final MobileEventItem event;

  const EntryAndPlayers({super.key, required this.event});

  @override
  Widget build(BuildContext context) {
    final players = event.playersLabel;
    return Wrap(
      spacing: 14,
      runSpacing: 4,
      children: [
        EventFact(icon: Icons.payments_outlined, text: event.entryLabel),
        if (players != null)
          EventFact(icon: Icons.groups_outlined, text: players),
      ],
    );
  }
}

/// "Closes 14 Dec · 5 days left", on the card and the event page.
class DeadlineBanner extends StatelessWidget {
  final EventDeadline deadline;

  const DeadlineBanner({super.key, required this.deadline});

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    final (wash, ink, icon) = switch (deadline.urgency) {
      DeadlineUrgency.calm => (p.accentWash, p.accent, Icons.schedule),
      DeadlineUrgency.soon => (p.flagWash, p.flag, Icons.timer_outlined),
      DeadlineUrgency.closed => (p.paper3, p.ink2, Icons.lock_outline),
    };
    return Container(
      key: const Key('deadline-banner'),
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: wash,
        borderRadius: BorderRadius.circular(8),
      ),
      child: EventFact(
        icon: icon,
        text: deadline.text,
        color: ink,
        strong: true,
      ),
    );
  }
}
