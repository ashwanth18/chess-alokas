import 'package:flutter/material.dart';

import '../models/models.dart';
import '../services/alokas_api.dart';
import '../services/file_gateway.dart';
import '../theme/alokas_theme.dart';
import '../widgets/legal.dart';
import '../widgets/locked_tab.dart';
import '../widgets/message_card.dart';
import '../widgets/player_name.dart';

/// The Account tab for someone signed in. Guests see a locked tab instead.
class ProfilesScreen extends StatelessWidget {
  final String signedInEmail;
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
    required this.onSignOut,
    required this.onDeleteAccount,
    required this.themeChoice,
    required this.onThemeChanged,
    required this.registrations,
    required this.eventNameFor,
    required this.receiptPicker,
    required this.onUploadReceipt,
  });

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
              ? 'No matches found'
              : 'Found ${pluralize(value, 'past tournament')} for ${displayPlayerName(profile.fullName)}',
        );
      case ApiFailure(:final message):
        _say(context, 'Could not search: $message');
    }
  }

  void _openDeleteAccount(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (_) => _DeleteAccountDialog(
        email: signedInEmail,
        onDelete: onDeleteAccount,
        onDeleted: () => _say(context, 'Your account was deleted.'),
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

  /// The account's own name: the player profile marked as the person
  /// themselves, if there is one.
  String? get _ownName {
    final own = profiles.where((x) => x.relationship == 'self');
    return own.isEmpty ? null : own.first.fullName;
  }

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    return RefreshIndicator(
      onRefresh: onRetryProfiles,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
        children: [
          _buildAccount(context),
          const SizedBox(height: 24),
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
          const SizedBox(height: 24),
          const SheetHeading('Settings'),
          ThemePicker(choice: themeChoice, onChanged: onThemeChanged),
          const SizedBox(height: 16),
          const LegalLinks(),
          const SizedBox(height: 24),
          Divider(color: p.rule),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            key: const Key('sign-out-button'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(52),
            ),
            onPressed: onSignOut,
            icon: const Icon(Icons.logout),
            label: const Text('Sign out'),
          ),
          const SizedBox(height: 8),
          Center(
            child: TextButton(
              key: const Key('open-delete-account'),
              style: TextButton.styleFrom(foregroundColor: p.flag),
              onPressed: () => _openDeleteAccount(context),
              child: const Text('Delete my account'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAccount(BuildContext context) {
    final p = context.pal;
    final name = _ownName;
    final initial = (name ?? signedInEmail).trim();
    return BrandCard(
      key: const Key('account-header'),
      strong: true,
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: p.accent, shape: BoxShape.circle),
            child: Text(
              initial.isEmpty ? '?' : initial.substring(0, 1).toUpperCase(),
              style: atype(22, weight: 800, color: p.onAccent),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (name != null)
                  PlayerName(name, size: 18, weight: 800, color: p.ink),
                Text(
                  signedInEmail,
                  key: const Key('account-email'),
                  style: atype(
                    name == null ? 17 : 15,
                    weight: name == null ? 700 : 400,
                    color: name == null ? p.ink : p.ink2,
                    height: 1.3,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
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
                  child: const Text('Find my past tournaments'),
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
