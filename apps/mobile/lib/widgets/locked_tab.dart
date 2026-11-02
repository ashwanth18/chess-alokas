import 'package:flutter/material.dart';

import '../services/auth_service.dart';
import '../theme/alokas_theme.dart';
import 'legal.dart';
import 'message_card.dart';

/// What a guest sees on a tab that needs an account: what it holds, and the
/// two ways in. The same on every tab.
class LockedTab extends StatelessWidget {
  final IconData icon;
  final String title;
  final String message;
  final bool authAvailable;
  final VoidCallback onSignIn;
  final VoidCallback onCreateAccount;
  final List<Widget> footer;

  const LockedTab({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    required this.authAvailable,
    required this.onSignIn,
    required this.onCreateAccount,
    this.footer = const [],
  });

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    return ListView(
      key: const Key('locked-tab'),
      padding: const EdgeInsets.fromLTRB(24, 40, 24, 32),
      children: [
        Center(
          child: Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              color: p.accentWash,
              shape: BoxShape.circle,
              border: Border.all(color: p.accent, width: 1.5),
            ),
            child: Icon(icon, color: p.accent, size: 36),
          ),
        ),
        const SizedBox(height: 24),
        Text(
          title,
          key: const Key('locked-title'),
          textAlign: TextAlign.center,
          style: atype(26, weight: 800, width: 106, color: p.ink, height: 1.15),
        ),
        const SizedBox(height: 10),
        Text(
          message,
          textAlign: TextAlign.center,
          style: atype(16, color: p.ink2, height: 1.4),
        ),
        const SizedBox(height: 28),
        if (authAvailable) ...[
          ElevatedButton(
            key: const Key('locked-sign-in'),
            style: ElevatedButton.styleFrom(
              minimumSize: const Size.fromHeight(52),
            ),
            onPressed: onSignIn,
            child: const Text('Sign in'),
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            key: const Key('locked-create-account'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(52),
              textStyle: atype(16, weight: 700),
            ),
            onPressed: onCreateAccount,
            child: const Text('Create account'),
          ),
        ] else
          Text(
            notConfiguredMessage,
            key: const Key('sign-in-not-configured'),
            textAlign: TextAlign.center,
            style: atype(16, weight: 600, color: p.wait, height: 1.35),
          ),
        ...footer,
      ],
    );
  }
}

/// Alokas green or Sunlight. Offered to guests too.
class ThemePicker extends StatelessWidget {
  final AlokasThemeChoice choice;
  final ValueChanged<AlokasThemeChoice> onChanged;

  const ThemePicker({super.key, required this.choice, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Display', style: atype(14, weight: 600, color: p.accent)),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final option in AlokasThemeChoice.values)
              ChoiceBox.text(
                key: Key('theme-${option.name}'),
                label: option.label,
                selected: choice == option,
                onTap: () => onChanged(option),
              ),
          ],
        ),
      ],
    );
  }
}

/// Terms and Privacy, side by side.
class LegalLinks extends StatelessWidget {
  const LegalLinks({super.key});

  @override
  Widget build(BuildContext context) {
    return const Wrap(
      spacing: 8,
      children: [
        LegalLink('Privacy Policy', privacyUrl),
        LegalLink('Terms', termsUrl),
      ],
    );
  }
}
