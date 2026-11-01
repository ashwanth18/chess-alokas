import 'package:flutter/material.dart';

import '../models/models.dart';
import '../theme/alokas_theme.dart';

/// Shown above data that is still on screen after a refresh failed, so old data
/// is never mistaken for current data.
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
    final loadedAt = lastLoadedAt;
    return Container(
      key: const Key('stale-notice'),
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(12, 10, 6, 10),
      decoration: BoxDecoration(
        color: AlokasColors.amberWarning.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AlokasColors.amberWarning),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.cloud_off,
            color: AlokasColors.amberWarning,
            size: 20,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              loadedAt == null
                  ? 'This may be out of date. $reason'
                  : 'This may be out of date (last updated '
                        '${formatTimeForPeople(loadedAt)}). $reason',
              style: const TextStyle(
                color: AlokasColors.creamIvory,
                fontSize: 12.5,
              ),
            ),
          ),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

/// Empty, error and "not available" states, in the app's card style.
class MessageCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final Color accent;

  const MessageCard({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
    this.accent = AlokasColors.warmGold,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AlokasColors.forestCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AlokasColors.goldBorder),
      ),
      child: Column(
        children: [
          Icon(icon, color: accent, size: 36),
          const SizedBox(height: 10),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AlokasColors.creamIvory,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (message != null) ...[
            const SizedBox(height: 6),
            Text(
              message!,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AlokasColors.mutedSage,
                fontSize: 12.5,
              ),
            ),
          ],
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: 10),
            OutlinedButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ],
      ),
    );
  }
}
