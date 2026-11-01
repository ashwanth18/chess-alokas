import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../theme/alokas_theme.dart';

const String privacyUrl = 'https://chess-manager.alokas.com/privacy';
const String privacyRetentionUrl =
    'https://chess-manager.alokas.com/privacy#retention';
const String termsUrl = 'https://chess-manager.alokas.com/terms';

/// Opens a page in the phone's browser, leaving what was typed in the app alone.
class LegalLink extends StatelessWidget {
  /// Replaced in tests.
  static Future<bool> Function(Uri) opener = _openInBrowser;

  final String label;
  final String url;

  const LegalLink(this.label, this.url, {super.key});

  static Future<bool> _openInBrowser(Uri uri) =>
      launchUrl(uri, mode: LaunchMode.externalApplication);

  Future<void> _open(BuildContext context) async {
    final messenger = ScaffoldMessenger.maybeOf(context);
    var opened = false;
    try {
      opened = await opener(Uri.parse(url));
    } on Object {
      opened = false;
    }
    if (!opened) {
      messenger?.showSnackBar(
        SnackBar(
          content: Text('Could not open a browser. The page is at $url'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return TextButton(
      key: Key('link-$url'),
      style: TextButton.styleFrom(
        foregroundColor: context.pal.accent,
        padding: const EdgeInsets.symmetric(horizontal: 8),
      ),
      onPressed: () => _open(context),
      child: Text(label),
    );
  }
}

/// One line by the submit button on a registration or a child's profile.
/// Submitting from that screen is the confirmation, and sends
/// `guardianConsent: true`.
class GuardianConsentNotice extends StatelessWidget {
  const GuardianConsentNotice({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          "By submitting, you confirm you're the parent or guardian, or have "
          'their permission, and agree to our Privacy Policy.',
          style: atype(14, color: context.pal.ink2, height: 1.3),
        ),
        const LegalLink('Privacy Policy', privacyUrl),
      ],
    );
  }
}
