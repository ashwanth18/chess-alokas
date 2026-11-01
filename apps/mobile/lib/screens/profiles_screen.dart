import 'package:flutter/material.dart';

import '../models/models.dart';
import '../services/alokas_api.dart';
import '../theme/alokas_theme.dart';
import '../widgets/message_card.dart';

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
  final Future<void> Function() onSignOut;

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
    required this.onSignOut,
  });

  bool get _signedIn => signedInEmail != null;

  void _say(BuildContext context, String text) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        backgroundColor: AlokasColors.forestElevated,
        content: Text(
          text,
          style: const TextStyle(color: AlokasColors.creamIvory),
        ),
      ),
    );
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
    final active = activeRegistrationsFor(profile.id);
    final message = active == null
        ? 'This removes the profile from your account. Any registrations it has '
              'stay with the organizers and are not withdrawn.'
        : active == 0
        ? 'This removes the profile from your account.'
        : 'This removes the profile from your account. ${profile.fullName} '
              'has ${pluralize(active, 'active registration')}, which will '
              'stay with the organizers and not be withdrawn. Contact them '
              'to withdraw.';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AlokasColors.forestSurface,
        title: Text(
          'Delete ${profile.fullName}?',
          style: const TextStyle(
            color: AlokasColors.creamIvory,
            fontWeight: FontWeight.w800,
            fontSize: 17,
          ),
        ),
        content: Text(
          message,
          key: const Key('delete-profile-message'),
          style: const TextStyle(color: AlokasColors.mutedSage),
        ),
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
        _say(context, 'Deleted ${profile.fullName}.');
      case ApiFailure(:final message):
        _say(context, 'Could not delete ${profile.fullName}: $message');
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

  void _openSignInSheet(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AlokasColors.forestSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) =>
          _SignInSheet(isAuthConfigured: isAuthConfigured, onSignIn: onSignIn),
    );
  }

  @override
  Widget build(BuildContext context) {
    final list = ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
      children: [
        _buildAccountCard(context),
        const SizedBox(height: 16),
        if (!_signedIn)
          MessageCard(
            icon: Icons.login,
            title: 'Sign in to manage player profiles',
            message: isAuthConfigured
                ? 'You can browse events without an account. Registering a player and managing profiles need sign-in.'
                : notConfiguredMessage,
            actionLabel: isAuthConfigured ? 'Sign In' : null,
            onAction: isAuthConfigured ? () => _openSignInSheet(context) : null,
          )
        else ...[
          Row(
            children: [
              Expanded(
                child: Text(
                  profiles.isEmpty && (profilesError != null || profilesLoading)
                      ? 'FAMILY & STUDENT PROFILES'
                      : 'FAMILY & STUDENT PROFILES (${profiles.length})',
                  style: const TextStyle(
                    color: AlokasColors.warmGold,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.8,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              ElevatedButton.icon(
                key: const Key('open-add-profile-button'),
                onPressed: () => _openProfileDialog(context),
                icon: const Icon(Icons.person_add_alt_1, size: 16),
                label: const Text('+ Add Profile'),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (profilesLoading && profiles.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Center(
                child: CircularProgressIndicator(color: AlokasColors.warmGold),
              ),
            )
          else if (profilesError != null && profiles.isEmpty)
            MessageCard(
              icon: Icons.cloud_off,
              accent: AlokasColors.crimsonDanger,
              title: 'Could not load profiles',
              message: profilesError,
              actionLabel: 'Retry',
              onAction: onRetryProfiles,
            )
          else if (profiles.isEmpty)
            const MessageCard(
              icon: Icons.person_outline,
              title: 'No player profiles yet',
              message:
                  'Add yourself or a family member to register for events.',
            )
          else ...[
            if (profilesError != null)
              StaleNotice(
                reason: profilesError!,
                lastLoadedAt: profilesUpdatedAt,
                onRetry: onRetryProfiles,
              ),
            ...profiles.map(
              (prof) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _buildProfileCard(context, prof),
              ),
            ),
          ],
        ],
      ],
    );
    if (!_signedIn) return list;
    return RefreshIndicator(
      color: AlokasColors.warmGold,
      backgroundColor: AlokasColors.forestCard,
      onRefresh: onRetryProfiles,
      child: list,
    );
  }

  Widget _buildAccountCard(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AlokasColors.forestElevated, AlokasColors.forestCard],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AlokasColors.warmGold),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 24,
            backgroundColor: AlokasColors.warmGold.withValues(alpha: 0.2),
            child: Icon(
              _signedIn ? Icons.person : Icons.person_off_outlined,
              color: AlokasColors.brightGold,
              size: 26,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AlokasBadge(
                  text: _signedIn ? 'Signed in' : 'Not signed in',
                  color: _signedIn
                      ? AlokasColors.emeraldSuccess
                      : AlokasColors.amberWarning,
                ),
                const SizedBox(height: 6),
                Text(
                  signedInEmail ?? 'Browsing events only',
                  style: const TextStyle(
                    color: AlokasColors.creamIvory,
                    fontWeight: FontWeight.w800,
                    fontSize: 15,
                  ),
                ),
              ],
            ),
          ),
          if (_signedIn)
            OutlinedButton(
              key: const Key('sign-out-button'),
              onPressed: onSignOut,
              child: const Text('Sign Out'),
            )
          else
            OutlinedButton(
              key: const Key('open-sign-in-button'),
              onPressed: () => _openSignInSheet(context),
              child: const Text('Sign In'),
            ),
        ],
      ),
    );
  }

  Widget _buildProfileCard(BuildContext context, MobilePlayerProfile prof) {
    final born = prof.yearOfBirth;
    final details = [
      born == null ? 'Birth year not set' : 'Born $born (Age ${prof.age})',
      if (prof.gender != null) 'Gender: ${prof.gender}',
      prof.fideId == null ? 'No FIDE ID' : 'FIDE ID: ${prof.fideId}',
    ].join(' • ');
    final affiliation = prof.affiliationLabel;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                AlokasBadge(
                  text: prof.relationshipLabel,
                  color: prof.isPrimary
                      ? AlokasColors.brightGold
                      : AlokasColors.skyInfo,
                  icon: prof.isPrimary ? Icons.star : Icons.family_restroom,
                ),
                if (prof.username != null)
                  Text(
                    '@${prof.username}',
                    style: const TextStyle(
                      color: AlokasColors.warmGold,
                      fontWeight: FontWeight.w700,
                      fontSize: 12.5,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              prof.fullName,
              style: const TextStyle(
                color: AlokasColors.creamIvory,
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              details,
              style: const TextStyle(
                color: AlokasColors.mutedSage,
                fontSize: 12.5,
              ),
            ),
            if (affiliation != null) ...[
              const SizedBox(height: 3),
              Text(
                affiliation,
                style: const TextStyle(
                  color: AlokasColors.mutedSage,
                  fontSize: 12.5,
                ),
              ),
            ],
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                if (prof.alokasRating != null)
                  AlokasBadge(
                    text: 'Alokas: ${prof.alokasRating}',
                    color: AlokasColors.warmGold,
                  ),
                if (prof.fideRapid != null)
                  AlokasBadge(
                    text: 'FIDE Rapid: ${prof.fideRapid}',
                    color: AlokasColors.emeraldSuccess,
                  ),
                if (prof.fideStandard != null)
                  AlokasBadge(
                    text: 'FIDE Std: ${prof.fideStandard}',
                    color: AlokasColors.skyInfo,
                  ),
              ],
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                key: Key('claim-${prof.id}'),
                onPressed: () => _claim(context, prof),
                icon: const Icon(Icons.history_edu, size: 17),
                label: const Text('Claim Past Tournaments'),
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
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

class _SignInSheet extends StatefulWidget {
  final bool isAuthConfigured;
  final Future<ApiResult<AuthSession>> Function(String email, String password)
  onSignIn;

  const _SignInSheet({required this.isAuthConfigured, required this.onSignIn});

  @override
  State<_SignInSheet> createState() => _SignInSheetState();
}

class _SignInSheetState extends State<_SignInSheet> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_email.text.trim().isEmpty || _password.text.isEmpty) {
      setState(() => _error = 'Enter your email and password.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
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
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        20,
        20,
        MediaQuery.of(context).viewInsets.bottom + 28,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Sign In',
            style: TextStyle(
              color: AlokasColors.creamIvory,
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          if (!widget.isAuthConfigured)
            const Text(
              notConfiguredMessage,
              key: Key('sign-in-not-configured'),
              style: TextStyle(
                color: AlokasColors.amberWarning,
                fontSize: 12.5,
              ),
            )
          else ...[
            const Text(
              'Use your Chess Alokas account. Accounts are created on the website; the app cannot create one yet.',
              style: TextStyle(color: AlokasColors.mutedSage, fontSize: 12.5),
            ),
            const SizedBox(height: 14),
            TextField(
              key: const Key('sign-in-email'),
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              autocorrect: false,
              style: const TextStyle(color: AlokasColors.creamIvory),
              decoration: const InputDecoration(
                labelText: 'Email',
                prefixIcon: Icon(
                  Icons.email_outlined,
                  color: AlokasColors.warmGold,
                ),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              key: const Key('sign-in-password'),
              controller: _password,
              obscureText: true,
              style: const TextStyle(color: AlokasColors.creamIvory),
              decoration: const InputDecoration(
                labelText: 'Password',
                prefixIcon: Icon(
                  Icons.lock_outline,
                  color: AlokasColors.warmGold,
                ),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(
                _error!,
                key: const Key('sign-in-error'),
                style: const TextStyle(
                  color: AlokasColors.crimsonDanger,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                key: const Key('sign-in-submit'),
                onPressed: _busy ? null : _submit,
                icon: const Icon(Icons.login),
                label: Text(_busy ? 'Signing In...' : 'Sign In'),
              ),
            ),
          ],
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
        style: const TextStyle(color: AlokasColors.creamIvory),
        onChanged: (_) {
          if (_fieldErrors.containsKey(field)) {
            setState(() {
              _fieldErrors = {..._fieldErrors}..remove(field);
            });
          }
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
    const fieldStyle = TextStyle(color: AlokasColors.creamIvory);
    return AlertDialog(
      backgroundColor: AlokasColors.forestSurface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(color: AlokasColors.warmGold),
      ),
      title: Text(
        widget.existing == null ? 'Add Player Profile' : 'Edit Player Profile',
        style: const TextStyle(
          color: AlokasColors.creamIvory,
          fontWeight: FontWeight.w800,
          fontSize: 17,
        ),
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
                          dropdownColor: AlokasColors.forestCard,
                          style: fieldStyle,
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
                          dropdownColor: AlokasColors.forestCard,
                          style: fieldStyle,
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
          // Outside the scrolling part, so it cannot end up off screen.
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(
              _error!,
              key: const Key('profile-form-error'),
              style: const TextStyle(
                color: AlokasColors.crimsonDanger,
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
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
