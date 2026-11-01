import 'package:flutter/material.dart';

import '../models/models.dart';
import '../services/alokas_api.dart';
import '../services/file_gateway.dart';
import '../theme/alokas_theme.dart';
import '../widgets/legal.dart';
import '../widgets/message_card.dart';
import '../widgets/player_name.dart';

class ProfilesScreen extends StatelessWidget {
  final bool isAuthConfigured;

  /// Null means signed out.
  final String? signedInEmail;
  final List<MobilePlayerProfile> profiles;
  final bool profilesLoading;
  final String? profilesError;

  /// When [profiles] last came from the server.
  final DateTime? profilesUpdatedAt;

  /// Active registrations for a player; null when they are not known.
  final int? Function(String profileId) activeRegistrationsFor;
  final Future<void> Function() onRetryProfiles;
  final Future<ApiResult<void>> Function(Map<String, dynamic> fields)
  onCreateProfile;
  final Future<ApiResult<void>> Function(String id, Map<String, dynamic> fields)
  onUpdateProfile;
  final Future<ApiResult<void>> Function(String id) onDeleteProfile;
  final Future<ApiResult<int>> Function(MobilePlayerProfile profile)
  onClaimPastTournaments;
  final Future<ApiResult<AuthSession>> Function(String email, String password)
  onSignIn;
  final Future<ApiResult<SignUpOutcome>> Function(String email, String password)
  onSignUp;
  final Future<ApiResult<void>> Function(String email) onResendConfirmation;
  final Future<ApiResult<void>> Function(String email) onRequestPasswordReset;
  final Future<void> Function() onSignOut;
  final Future<ApiResult<void>> Function() onDeleteAccount;
  final AlokasThemeChoice themeChoice;
  final ValueChanged<AlokasThemeChoice> onThemeChanged;

  /// Everything this account has sent; null until it has loaded.
  final List<RegistrationRecord>? registrations;
  final String? Function(String? tournamentId) eventNameFor;
  final ReceiptPicker receiptPicker;
  final Future<ApiResult<RegistrationRecord>> Function(
    RegistrationRecord record,
    ReceiptFile receipt,
  )
  onUploadReceipt;

  const ProfilesScreen({
    super.key,
    required this.isAuthConfigured,
    required this.signedInEmail,
    required this.profiles,
    required this.profilesLoading,
    required this.profilesError,
    this.profilesUpdatedAt,
    required this.activeRegistrationsFor,
    required this.onRetryProfiles,
    required this.onCreateProfile,
    required this.onUpdateProfile,
    required this.onDeleteProfile,
    required this.onClaimPastTournaments,
    required this.onSignIn,
    required this.onSignUp,
    required this.onResendConfirmation,
    required this.onRequestPasswordReset,
    required this.onSignOut,
    required this.onDeleteAccount,
    required this.themeChoice,
    required this.onThemeChanged,
    required this.registrations,
    required this.eventNameFor,
    required this.receiptPicker,
    required this.onUploadReceipt,
  });

  bool get _signedIn => signedInEmail != null;

  void _say(BuildContext context, String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  void _openProfileDialog(
    BuildContext context, {
    MobilePlayerProfile? existing,
  }) {
    showDialog<void>(
      context: context,
      builder: (_) => _ProfileFormDialog(
        existing: existing,
        defaultRelationship: profiles.isEmpty ? 'self' : 'child',
        onSave: existing == null
            ? onCreateProfile
            : (fields) => onUpdateProfile(existing.id, fields),
      ),
    );
  }

  Future<void> _confirmDelete(
    BuildContext context,
    MobilePlayerProfile profile,
  ) async {
    final name = displayPlayerName(profile.fullName);
    final active = activeRegistrationsFor(profile.id);
    final message = active == null
        ? 'This removes the profile from your account. Any registrations it has '
              'stay with the organizers and are not withdrawn.'
        : active == 0
        ? 'This removes the profile from your account.'
        : 'This removes the profile from your account. $name '
              'has ${pluralize(active, 'active registration')}, which will '
              'stay with the organizers and not be withdrawn. Contact them '
              'to withdraw.';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Delete $name?'),
        content: Text(message, key: const Key('delete-profile-message')),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            key: const Key('confirm-delete-profile-button'),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final result = await onDeleteProfile(profile.id);
    if (!context.mounted) return;
    switch (result) {
      case ApiSuccess():
        _say(context, 'Deleted $name.');
      case ApiFailure(:final message):
        _say(context, 'Could not delete $name: $message');
    }
  }

  Future<void> _claim(BuildContext context, MobilePlayerProfile profile) async {
    final result = await onClaimPastTournaments(profile);
    if (!context.mounted) return;
    switch (result) {
      case ApiSuccess(:final value):
        _say(
          context,
          value == 0
              ? 'No past entries matched. An entry must use your account email and the exact name ${profile.fullName}.'
              : 'Claimed $value past tournament ${value == 1 ? "entry" : "entries"} for ${profile.fullName}.',
        );
      case ApiFailure(:final message):
        _say(context, 'Claim failed: $message');
    }
  }

  void _openDeleteAccount(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (_) => _DeleteAccountDialog(
        email: signedInEmail ?? '',
        onDelete: onDeleteAccount,
        onDeleted: () => _say(context, 'Your account was deleted.'),
      ),
    );
  }

  void _openSignInSheet(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _AuthSheet(
        isAuthConfigured: isAuthConfigured,
        onSignIn: onSignIn,
        onSignUp: onSignUp,
        onResendConfirmation: onResendConfirmation,
        onRequestPasswordReset: onRequestPasswordReset,
      ),
    );
  }

  Future<void> _addLateReceipt(
    BuildContext context,
    RegistrationRecord record,
  ) async {
    final PickedReceipt? picked;
    try {
      picked = await receiptPicker();
    } on Object {
      if (context.mounted) {
        _say(context, 'The file picker could not be opened.');
      }
      return;
    }
    if (picked == null || !context.mounted) return;
    final (receipt, error) = ReceiptFile.validate(picked);
    if (receipt == null) {
      _say(context, error ?? 'That file could not be used.');
      return;
    }
    final result = await onUploadReceipt(record, receipt);
    if (!context.mounted) return;
    switch (result) {
      case ApiSuccess():
        _say(context, 'Receipt sent. The organizer will check it.');
      case ApiFailure(:final message):
        _say(context, message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        _buildAccount(context),
        const SizedBox(height: 16),
        _buildTheme(context),
        const SizedBox(height: 24),
        if (!_signedIn)
          MessageCard(
            title: 'Sign in to manage player profiles',
            message: isAuthConfigured
                ? 'You can browse events without an account. Registering a player and managing profiles need sign-in.'
                : notConfiguredMessage,
            actionLabel: isAuthConfigured ? 'Sign In' : null,
            onAction: isAuthConfigured ? () => _openSignInSheet(context) : null,
          )
        else ...[
          ..._buildRegistrations(context),
          SheetHeading(
            profiles.isEmpty && (profilesError != null || profilesLoading)
                ? 'Players'
                : 'Players (${profiles.length})',
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              key: const Key('open-add-profile-button'),
              onPressed: () => _openProfileDialog(context),
              child: const Text('Add a player'),
            ),
          ),
          const SizedBox(height: 8),
          if (profilesLoading && profiles.isEmpty)
            const LoadingLine()
          else if (profilesError != null && profiles.isEmpty)
            MessageCard(
              isProblem: true,
              title: 'Could not load profiles',
              message: profilesError,
              actionLabel: 'Retry',
              onAction: onRetryProfiles,
            )
          else if (profiles.isEmpty)
            const MessageCard(
              title: 'No player profiles yet',
              message:
                  'Add yourself, or a child you look after, to register for events.',
            )
          else ...[
            if (profilesError != null)
              StaleNotice(
                reason: profilesError!,
                lastLoadedAt: profilesUpdatedAt,
                onRetry: onRetryProfiles,
              ),
            for (final profile in profiles) _buildProfile(context, profile),
          ],
        ],
        const SizedBox(height: 16),
        const Wrap(
          spacing: 8,
          children: [
            LegalLink('Privacy Policy', privacyUrl),
            LegalLink('Terms', termsUrl),
          ],
        ),
        if (_signedIn)
          TextButton(
            key: const Key('open-delete-account'),
            style: TextButton.styleFrom(foregroundColor: context.pal.flag),
            onPressed: () => _openDeleteAccount(context),
            child: const Text('Delete my account'),
          ),
      ],
    );
    if (!_signedIn) return list;
    return RefreshIndicator(onRefresh: onRetryProfiles, child: list);
  }

  Widget _buildAccount(BuildContext context) {
    final p = context.pal;
    return BrandCard(
      strong: true,
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AlokasBadge(
                  text: _signedIn ? 'Signed in' : 'Not signed in',
                  tone: _signedIn ? ChipTone.go : ChipTone.wait,
                ),
                const SizedBox(height: 4),
                Text(
                  signedInEmail ?? 'Browsing events only',
                  style: atype(16, weight: 700, color: p.ink, height: 1.25),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          if (_signedIn)
            OutlinedButton(
              key: const Key('sign-out-button'),
              onPressed: onSignOut,
              child: const Text('Sign Out'),
            )
          else
            ElevatedButton(
              key: const Key('open-sign-in-button'),
              onPressed: () => _openSignInSheet(context),
              child: const Text('Sign In'),
            ),
        ],
      ),
    );
  }

  Widget _buildTheme(BuildContext context) {
    final p = context.pal;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Display', style: atype(14, weight: 600, color: p.accent)),
        const SizedBox(height: 4),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final choice in AlokasThemeChoice.values)
              ChoiceBox.text(
                key: Key('theme-${choice.name}'),
                label: choice.label,
                selected: themeChoice == choice,
                onTap: () => onThemeChanged(choice),
              ),
          ],
        ),
      ],
    );
  }

  List<Widget> _buildRegistrations(BuildContext context) {
    final p = context.pal;
    final rows = registrations;
    if (rows == null || rows.isEmpty) return const [];
    return [
      const SheetHeading('Registrations'),
      for (final record in rows)
        Container(
          key: Key('registration-${record.id}'),
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: p.rule)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                eventNameFor(record.tournamentId) ?? 'Event name not available',
                style: atype(16, weight: 700, color: p.ink, height: 1.25),
              ),
              if (record.playerName != null)
                PlayerName(record.playerName!, weight: 400, color: p.ink),
              const SizedBox(height: 2),
              Text(
                [record.statusLabel, ?record.paymentLabel].join(' · '),
                style: atype(14, color: p.ink2),
              ),
              if (record.needsReceipt && record.id != null) ...[
                const SizedBox(height: 8),
                ElevatedButton(
                  key: Key('add-receipt-${record.id}'),
                  onPressed: () => _addLateReceipt(context, record),
                  child: const Text('Add receipt'),
                ),
              ],
            ],
          ),
        ),
      const SizedBox(height: 24),
    ];
  }

  Widget _buildProfile(BuildContext context, MobilePlayerProfile prof) {
    final p = context.pal;
    final born = prof.yearOfBirth;
    final details = [
      born == null ? 'Birth year not set' : 'Born $born (Age ${prof.age})',
      if (prof.gender != null) 'Gender: ${prof.gender}',
      prof.fideId == null ? 'No FIDE ID' : 'FIDE ID: ${prof.fideId}',
    ].join(' · ');
    final affiliation = prof.affiliationLabel;
    final ratings = [
      if (prof.fideRapid != null) 'FIDE Rapid ${prof.fideRapid}',
      if (prof.fideStandard != null) 'FIDE Std ${prof.fideStandard}',
    ];

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: BrandCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            PlayerName(
              prof.fullName,
              size: 18,
              weight: 700,
              color: p.ink,
              detail: prof.relationshipLabel,
            ),
            if (prof.username != null)
              Text('@${prof.username}', style: atype(14, color: p.ink2)),
            const SizedBox(height: 4),
            Text(details, style: atype(14, color: p.ink2, height: 1.3)),
            if (affiliation != null)
              Text(affiliation, style: atype(14, color: p.ink2, height: 1.3)),
            if (ratings.isNotEmpty)
              Text(
                ratings.join(' · '),
                style: atype(14, weight: 600, color: p.ink, tabular: true),
              ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                OutlinedButton(
                  key: Key('claim-${prof.id}'),
                  onPressed: () => _claim(context, prof),
                  child: const Text('Claim Past Tournaments'),
                ),
                TextButton(
                  key: Key('edit-${prof.id}'),
                  onPressed: () => _openProfileDialog(context, existing: prof),
                  child: const Text('Edit'),
                ),
                TextButton(
                  key: Key('delete-${prof.id}'),
                  onPressed: () => _confirmDelete(context, prof),
                  child: const Text('Delete'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Says what goes and what stays, and asks for the email typed out, as the
/// website does. The sign-out happens only once the server confirms.
class _DeleteAccountDialog extends StatefulWidget {
  final String email;
  final Future<ApiResult<void>> Function() onDelete;
  final VoidCallback onDeleted;

  const _DeleteAccountDialog({
    required this.email,
    required this.onDelete,
    required this.onDeleted,
  });

  @override
  State<_DeleteAccountDialog> createState() => _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends State<_DeleteAccountDialog> {
  final TextEditingController _typed = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _typed.dispose();
    super.dispose();
  }

  bool get _matches => _typed.text.trim() == widget.email;

  Future<void> _delete() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await widget.onDelete();
    if (!mounted) return;
    switch (result) {
      case ApiSuccess():
        Navigator.of(context).pop();
        widget.onDeleted();
      case ApiFailure(:final message):
        setState(() {
          _busy = false;
          _error = 'Your account was not deleted. $message';
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    Widget point(String lead, String rest) => Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(
              text: '$lead ',
              style: atype(14, weight: 700, color: p.ink, height: 1.35),
            ),
            TextSpan(
              text: rest,
              style: atype(14, color: p.ink2, height: 1.35),
            ),
          ],
        ),
      ),
    );
    return AlertDialog(
      title: const Text('Delete your account?'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'This cannot be undone. Your sign-in and player profiles are '
              'removed. What stays:',
              style: atype(16, color: p.ink, height: 1.35),
            ),
            const SizedBox(height: 8),
            point(
              'Your registrations',
              'lose their contact details. Open entries are cancelled. An '
                  'approved entry keeps the player\u2019s name for the organizer.',
            ),
            point(
              'Receipts',
              'stay for 30 days, so organizers can settle payments, and are '
                  'then deleted.',
            ),
            point(
              'Results stay.',
              'Roster entries, games and certificates in an organizer\u2019s '
                  'event remain with that event.',
            ),
            point(
              'Tournaments or organizations you run',
              'are handed on or closed, as the policy explains.',
            ),
            point(
              'This phone',
              'forgets the account\u2019s saved matches and unsent registrations.',
            ),
            const LegalLink('How long we keep data', privacyRetentionUrl),
            const SizedBox(height: 8),
            Text(
              'Type ${widget.email} to confirm',
              style: atype(14, weight: 600, color: p.ink),
            ),
            const SizedBox(height: 4),
            TextField(
              key: const Key('delete-account-email'),
              controller: _typed,
              autocorrect: false,
              keyboardType: TextInputType.emailAddress,
              onChanged: (_) => setState(() {}),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(
                _error!,
                key: const Key('delete-account-error'),
                style: atype(14, weight: 600, color: p.flag, height: 1.3),
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Keep my account'),
        ),
        ElevatedButton(
          key: const Key('confirm-delete-account'),
          style: ElevatedButton.styleFrom(
            backgroundColor: p.flag,
            foregroundColor: p.flagWash,
          ),
          onPressed: _busy || !_matches ? null : _delete,
          child: Text(_busy ? 'Deleting...' : 'Delete account'),
        ),
      ],
    );
  }
}

enum _AuthMode { signIn, signUp, reset, checkEmail, resetSent }

/// Email sign-in, creating an account, the confirmation-email state, and asking
/// for a password reset. Everything goes through callbacks to the auth service.
class _AuthSheet extends StatefulWidget {
  final bool isAuthConfigured;
  final Future<ApiResult<AuthSession>> Function(String email, String password)
  onSignIn;
  final Future<ApiResult<SignUpOutcome>> Function(String email, String password)
  onSignUp;
  final Future<ApiResult<void>> Function(String email) onResendConfirmation;
  final Future<ApiResult<void>> Function(String email) onRequestPasswordReset;

  const _AuthSheet({
    required this.isAuthConfigured,
    required this.onSignIn,
    required this.onSignUp,
    required this.onResendConfirmation,
    required this.onRequestPasswordReset,
  });

  @override
  State<_AuthSheet> createState() => _AuthSheetState();
}

class _AuthSheetState extends State<_AuthSheet> {
  static const int minPasswordLength = 8;

  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  _AuthMode _mode = _AuthMode.signIn;
  bool _busy = false;
  String? _error;
  String? _notice;
  bool _unconfirmed = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _switchTo(_AuthMode mode) {
    setState(() {
      _mode = mode;
      _error = null;
      _notice = null;
      _unconfirmed = false;
      _busy = false;
    });
  }

  bool _looksLikeEmail(String value) =>
      RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value.trim());

  Future<void> _submitSignIn() async {
    if (_email.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Enter your email and password.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
      _unconfirmed = false;
    });
    final result = await widget.onSignIn(_email.text, _password.text);
    if (!mounted) return;
    switch (result) {
      case ApiSuccess():
        Navigator.of(context).pop();
      case ApiFailure(:final message):
        setState(() {
          _busy = false;
          _error = message;
          _unconfirmed = message == emailNotConfirmedMessage;
        });
    }
  }

  Future<void> _submitSignUp() async {
    if (!_looksLikeEmail(_email.text)) {
      setState(() => _error = 'Enter a valid email address.');
      return;
    }
    if (_password.text.length < minPasswordLength) {
      setState(
        () => _error =
            'Use a password of at least $minPasswordLength characters.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await widget.onSignUp(_email.text, _password.text);
    if (!mounted) return;
    switch (result) {
      case ApiSuccess(value: SignedUpWithSession()):
        Navigator.of(context).pop();
      case ApiSuccess(value: ConfirmationRequired()):
        _password.clear();
        _switchTo(_AuthMode.checkEmail);
      case ApiFailure(:final message):
        setState(() {
          _busy = false;
          _error = message;
        });
    }
  }

  Future<void> _submitReset() async {
    if (!_looksLikeEmail(_email.text)) {
      setState(() => _error = 'Enter a valid email address.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await widget.onRequestPasswordReset(_email.text);
    if (!mounted) return;
    switch (result) {
      case ApiSuccess():
        _switchTo(_AuthMode.resetSent);
      case ApiFailure(:final message):
        setState(() {
          _busy = false;
          _error = message;
        });
    }
  }

  Future<void> _resend() async {
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    final result = await widget.onResendConfirmation(_email.text);
    if (!mounted) return;
    setState(() {
      _busy = false;
      switch (result) {
        case ApiSuccess():
          _notice = 'Sent again to ${_email.text.trim()}.';
        case ApiFailure(:final message):
          _error = message;
      }
    });
  }

  Widget _emailField() => TextField(
    key: const Key('sign-in-email'),
    controller: _email,
    keyboardType: TextInputType.emailAddress,
    autocorrect: false,
    autofillHints: const [AutofillHints.email],
    decoration: const InputDecoration(labelText: 'Email'),
  );

  Widget _passwordField(bool isNew) => TextField(
    key: const Key('sign-in-password'),
    controller: _password,
    obscureText: true,
    autofillHints: [isNew ? AutofillHints.newPassword : AutofillHints.password],
    decoration: InputDecoration(
      labelText: 'Password',
      helperText: isNew ? 'At least $minPasswordLength characters' : null,
    ),
  );

  Widget _primary(Key key, String label, String busyLabel, VoidCallback onTap) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        key: key,
        onPressed: _busy ? null : onTap,
        child: Text(_busy ? busyLabel : label),
      ),
    );
  }

  List<Widget> _feedback() {
    final p = context.pal;
    return [
      if (_error != null) ...[
        const SizedBox(height: 8),
        Text(
          _error!,
          key: const Key('sign-in-error'),
          style: atype(16, weight: 600, color: p.flag, height: 1.3),
        ),
      ],
      if (_notice != null) ...[
        const SizedBox(height: 8),
        Text(
          _notice!,
          key: const Key('sign-in-notice'),
          style: atype(16, weight: 600, color: p.go, height: 1.3),
        ),
      ],
    ];
  }

  List<Widget> _body() {
    final p = context.pal;
    switch (_mode) {
      case _AuthMode.signIn:
        return [
          _emailField(),
          const SizedBox(height: 12),
          _passwordField(false),
          ..._feedback(),
          if (_unconfirmed)
            TextButton(
              key: const Key('resend-confirmation'),
              onPressed: _busy ? null : _resend,
              child: const Text('Send the confirmation email again'),
            ),
          const SizedBox(height: 16),
          _primary(
            const Key('sign-in-submit'),
            'Sign In',
            'Signing In...',
            _submitSignIn,
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 8,
            children: [
              TextButton(
                key: const Key('open-sign-up'),
                onPressed: () => _switchTo(_AuthMode.signUp),
                child: const Text('Create an account'),
              ),
              TextButton(
                key: const Key('open-reset'),
                onPressed: () => _switchTo(_AuthMode.reset),
                child: const Text('Forgot password?'),
              ),
            ],
          ),
        ];
      case _AuthMode.signUp:
        return [
          _emailField(),
          const SizedBox(height: 12),
          _passwordField(true),
          ..._feedback(),
          const SizedBox(height: 12),
          Text(
            'By creating an account you agree to the Terms and Privacy Policy.',
            key: const Key('signup-agreement'),
            style: atype(14, color: p.ink2, height: 1.3),
          ),
          const Wrap(
            spacing: 8,
            children: [
              LegalLink('Terms', termsUrl),
              LegalLink('Privacy Policy', privacyUrl),
            ],
          ),
          const SizedBox(height: 8),
          _primary(
            const Key('sign-up-submit'),
            'Create account',
            'Creating...',
            _submitSignUp,
          ),
          const SizedBox(height: 4),
          TextButton(
            key: const Key('back-to-sign-in'),
            onPressed: () => _switchTo(_AuthMode.signIn),
            child: const Text('I already have an account'),
          ),
        ];
      case _AuthMode.reset:
        return [
          Text(
            'We email you a link to choose a new password.',
            style: atype(16, color: p.ink2, height: 1.35),
          ),
          const SizedBox(height: 12),
          _emailField(),
          ..._feedback(),
          const SizedBox(height: 16),
          _primary(
            const Key('reset-submit'),
            'Send reset link',
            'Sending...',
            _submitReset,
          ),
          const SizedBox(height: 4),
          TextButton(
            key: const Key('back-to-sign-in'),
            onPressed: () => _switchTo(_AuthMode.signIn),
            child: const Text('Back to sign in'),
          ),
        ];
      case _AuthMode.checkEmail:
        return [
          Text(
            'If ${_email.text.trim()} is new, a confirmation link is on its way. '
            'Open it, then come back and sign in.',
            key: const Key('check-email-message'),
            style: atype(16, color: p.ink, height: 1.35),
          ),
          const SizedBox(height: 8),
          Text(
            'If this email already has an account, no link is sent: sign in, or '
            'reset your password.',
            style: atype(16, color: p.ink2, height: 1.35),
          ),
          ..._feedback(),
          const SizedBox(height: 16),
          _primary(
            const Key('back-to-sign-in'),
            'Go to sign in',
            'Please wait...',
            () => _switchTo(_AuthMode.signIn),
          ),
          TextButton(
            key: const Key('resend-confirmation'),
            onPressed: _busy ? null : _resend,
            child: const Text('Send the email again'),
          ),
        ];
      case _AuthMode.resetSent:
        return [
          Text(
            'If an account exists for ${_email.text.trim()}, a reset link is on '
            'its way. After choosing a new password, come back and sign in.',
            key: const Key('reset-sent-message'),
            style: atype(16, color: p.ink, height: 1.35),
          ),
          const SizedBox(height: 16),
          _primary(
            const Key('back-to-sign-in'),
            'Go to sign in',
            'Please wait...',
            () => _switchTo(_AuthMode.signIn),
          ),
        ];
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    const titles = {
      _AuthMode.signIn: 'Sign In',
      _AuthMode.signUp: 'Create an account',
      _AuthMode.reset: 'Reset your password',
      _AuthMode.checkEmail: 'Check your email',
      _AuthMode.resetSent: 'Check your email',
    };
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(
        16,
        16,
        16,
        MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            widget.isAuthConfigured ? titles[_mode]! : 'Sign In',
            key: const Key('auth-title'),
            style: atype(24, weight: 800, color: p.accent),
          ),
          const SizedBox(height: 12),
          if (!widget.isAuthConfigured)
            Text(
              notConfiguredMessage,
              key: const Key('sign-in-not-configured'),
              style: atype(16, weight: 600, color: p.wait, height: 1.35),
            )
          else
            ..._body(),
        ],
      ),
    );
  }
}

class _ProfileFormDialog extends StatefulWidget {
  final MobilePlayerProfile? existing;
  final String defaultRelationship;
  final Future<ApiResult<void>> Function(Map<String, dynamic> fields) onSave;

  const _ProfileFormDialog({
    required this.existing,
    required this.defaultRelationship,
    required this.onSave,
  });

  @override
  State<_ProfileFormDialog> createState() => _ProfileFormDialogState();
}

class _ProfileFormDialogState extends State<_ProfileFormDialog> {
  /// Fields the form can point at, in the order they appear.
  static const List<String> _fieldOrder = [
    'fullName',
    'username',
    'yearOfBirth',
    'fideRapid',
    'fideId',
    'school',
    'city',
    'state',
  ];

  final Map<String, FocusNode> _focus = {
    for (final field in _fieldOrder) field: FocusNode(),
  };
  final Map<String, GlobalKey> _anchors = {
    for (final field in _fieldOrder) field: GlobalKey(),
  };
  Map<String, String> _fieldErrors = const {};

  late final TextEditingController _name;
  late final TextEditingController _username;
  late final TextEditingController _yearOfBirth;
  late final TextEditingController _fideId;
  late final TextEditingController _fideRapid;
  late final TextEditingController _school;
  late final TextEditingController _city;
  late final TextEditingController _state;
  late String _relationship;
  String? _gender;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final p = widget.existing;
    _name = TextEditingController(text: p?.fullName ?? '');
    _username = TextEditingController(text: p?.username ?? '');
    _yearOfBirth = TextEditingController(
      text: p?.yearOfBirth?.toString() ?? '',
    );
    _fideId = TextEditingController(text: p?.fideId?.toString() ?? '');
    _fideRapid = TextEditingController(text: p?.fideRapid?.toString() ?? '');
    _school = TextEditingController(text: p?.school ?? '');
    _city = TextEditingController(text: p?.city ?? '');
    _state = TextEditingController(text: p?.state ?? '');
    const known = ['self', 'child', 'student', 'family'];
    _relationship = known.contains(p?.relationship)
        ? p!.relationship!
        : widget.defaultRelationship;
    _gender = const ['M', 'F'].contains(p?.gender) ? p?.gender : null;
  }

  @override
  void dispose() {
    _name.dispose();
    _username.dispose();
    _yearOfBirth.dispose();
    _fideId.dispose();
    _fideRapid.dispose();
    _school.dispose();
    _city.dispose();
    _state.dispose();
    for (final node in _focus.values) {
      node.dispose();
    }
    super.dispose();
  }

  String? _text(TextEditingController controller) {
    final value = controller.text.trim();
    return value.isEmpty ? null : value;
  }

  /// Same rule as the server: judged on what the form says now, unless consent
  /// is already on record for this profile.
  bool get _needsConsent {
    if (widget.existing?.guardianConsentAt != null) return false;
    return guardianConsentRequired(
      relationship: _relationship,
      yearOfBirth: int.tryParse(_yearOfBirth.text.trim()),
      dateOfBirth: widget.existing?.dateOfBirth,
    );
  }

  /// Builds the request body, or records why the form cannot be sent. A number
  /// that does not parse is an error rather than being dropped without a word.
  Map<String, dynamic>? _collect() {
    final errors = <String, String>{};
    int? number(
      TextEditingController controller,
      String field,
      String label,
      int min,
      int max,
    ) {
      final raw = controller.text.trim();
      if (raw.isEmpty) return null;
      final value = int.tryParse(raw);
      if (value == null || value < min || value > max) {
        errors[field] = '$label must be a number from $min to $max.';
      }
      return value;
    }

    _error = null;
    final name = _text(_name);
    if (name == null) errors['fullName'] = 'Full name is required.';
    final yearOfBirth = number(
      _yearOfBirth,
      'yearOfBirth',
      'Year of birth',
      1900,
      DateTime.now().year,
    );
    final fideId = number(_fideId, 'fideId', 'FIDE ID', 1, 2147483647);
    final fideRapid = number(
      _fideRapid,
      'fideRapid',
      'FIDE Rapid rating',
      0,
      3500,
    );
    _fieldErrors = errors;
    if (errors.isNotEmpty) return null;
    return {
      if (_needsConsent) 'guardianConsent': true,
      'fullName': name,
      'username': _text(_username),
      'relationship': _relationship,
      'gender': _gender,
      'yearOfBirth': yearOfBirth,
      'fideId': fideId,
      'fideRapid': fideRapid,
      'school': _text(_school),
      'city': _text(_city),
      'state': _text(_state),
    };
  }

  Future<void> _save() async {
    final fields = _collect();
    if (fields == null) {
      setState(() {});
      _revealFirstError();
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _fieldErrors = const {};
    });
    final result = await widget.onSave(fields);
    if (!mounted) return;
    switch (result) {
      case ApiSuccess():
        Navigator.of(context).pop();
      case ApiFailure(:final message, :final fieldErrors):
        final known = {
          for (final entry in fieldErrors.entries)
            if (_fieldOrder.contains(entry.key)) entry.key: entry.value,
        };
        final other = [
          for (final entry in fieldErrors.entries)
            if (!_fieldOrder.contains(entry.key))
              '${entry.key}: ${entry.value}',
        ];
        setState(() {
          _busy = false;
          _fieldErrors = known;
          _error = other.isNotEmpty
              ? other.join(' ')
              : known.isEmpty
              ? message
              : null;
        });
        _revealFirstError();
    }
  }

  /// Puts the first problem in view and its field in focus, with the keyboard
  /// open or not, so that Save never appears to do nothing.
  void _revealFirstError() {
    final first = _fieldOrder.where(_fieldErrors.containsKey).firstOrNull;
    if (first == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _focus[first]!.requestFocus();
      final anchor = _anchors[first]!.currentContext;
      if (anchor != null) {
        Scrollable.ensureVisible(
          anchor,
          alignment: 0.02,
          duration: const Duration(milliseconds: 150),
        );
      }
    });
  }

  Widget _textField(
    String field,
    TextEditingController controller,
    String label, {
    Key? key,
    TextInputType? keyboardType,
  }) {
    return KeyedSubtree(
      key: _anchors[field],
      child: TextField(
        key: key,
        controller: controller,
        focusNode: _focus[field],
        keyboardType: keyboardType,
        scrollPadding: const EdgeInsets.all(72),
        onChanged: (_) {
          // The birth year can change whether consent is needed.
          setState(() {
            if (_fieldErrors.containsKey(field)) {
              _fieldErrors = {..._fieldErrors}..remove(field);
            }
          });
        },
        decoration: InputDecoration(
          labelText: label,
          errorText: _fieldErrors[field],
          errorMaxLines: 4,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(
        widget.existing == null ? 'Add Player Profile' : 'Edit Player Profile',
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Flexible(
            child: SingleChildScrollView(
              // Room for a focused field's floating label when scrolled to.
              padding: const EdgeInsets.only(top: 8),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _textField(
                    'fullName',
                    _name,
                    'Full Name *',
                    key: const Key('add-profile-fullname'),
                  ),
                  const SizedBox(height: 10),
                  _textField(
                    'username',
                    _username,
                    '@username',
                    key: const Key('add-profile-username'),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          isExpanded: true,
                          initialValue: _relationship,
                          decoration: const InputDecoration(
                            labelText: 'Relationship',
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: 'self',
                              child: Text('Self'),
                            ),
                            DropdownMenuItem(
                              value: 'child',
                              child: Text('Child'),
                            ),
                            DropdownMenuItem(
                              value: 'student',
                              child: Text('Student'),
                            ),
                            DropdownMenuItem(
                              value: 'family',
                              child: Text('Family'),
                            ),
                          ],
                          onChanged: (v) {
                            if (v != null) setState(() => _relationship = v);
                          },
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: DropdownButtonFormField<String?>(
                          isExpanded: true,
                          initialValue: _gender,
                          decoration: const InputDecoration(
                            labelText: 'Gender',
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: null,
                              child: Text('Not set'),
                            ),
                            DropdownMenuItem(value: 'M', child: Text('Male')),
                            DropdownMenuItem(value: 'F', child: Text('Female')),
                          ],
                          onChanged: (v) => setState(() => _gender = v),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  _textField(
                    'yearOfBirth',
                    _yearOfBirth,
                    'Year of Birth',
                    key: const Key('add-profile-yob'),
                    keyboardType: TextInputType.number,
                  ),
                  const SizedBox(height: 10),
                  _textField(
                    'fideRapid',
                    _fideRapid,
                    'FIDE Rapid Rating',
                    key: const Key('add-profile-rating'),
                    keyboardType: TextInputType.number,
                  ),
                  const SizedBox(height: 10),
                  _textField(
                    'fideId',
                    _fideId,
                    'FIDE ID',
                    key: const Key('add-profile-fideid'),
                    keyboardType: TextInputType.number,
                  ),
                  const SizedBox(height: 10),
                  _textField(
                    'school',
                    _school,
                    'School / Chess Academy',
                    key: const Key('add-profile-school'),
                  ),
                  const SizedBox(height: 10),
                  _textField('city', _city, 'City'),
                  const SizedBox(height: 10),
                  _textField('state', _state, 'State'),
                ],
              ),
            ),
          ),
          // Outside the scrolling part, so they cannot end up off screen.
          if (_needsConsent) ...[
            const SizedBox(height: 10),
            const GuardianConsentNotice(key: Key('guardian-consent-notice')),
          ],
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(
              _error!,
              key: const Key('profile-form-error'),
              style: atype(
                16,
                weight: 600,
                color: context.pal.flag,
                height: 1.3,
              ),
            ),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          key: const Key('save-profile-button'),
          onPressed: _busy ? null : _save,
          child: Text(_busy ? 'Saving...' : 'Save Profile'),
        ),
      ],
    );
  }
}
