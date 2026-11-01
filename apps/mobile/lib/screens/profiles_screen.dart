import 'package:flutter/material.dart';

import '../models/models.dart';
import '../theme/alokas_theme.dart';

class ProfilesScreen extends StatelessWidget {
  final String signedInEmail;
  final List<MobilePlayerProfile> profiles;
  final ValueChanged<MobilePlayerProfile> onAddProfile;
  final Future<int> Function(MobilePlayerProfile profile) onClaimPastTournaments;
  final Future<void> Function(String email, String password) onSignIn;

  const ProfilesScreen({
    super.key,
    required this.signedInEmail,
    required this.profiles,
    required this.onAddProfile,
    required this.onClaimPastTournaments,
    required this.onSignIn,
  });

  void _openAddProfileDialog(BuildContext context) {
    final nameCtrl = TextEditingController();
    final usernameCtrl = TextEditingController();
    final yobCtrl = TextEditingController(text: '2016');
    final fideIdCtrl = TextEditingController();
    final ratingCtrl = TextEditingController(text: '1250');
    final schoolCtrl = TextEditingController(text: 'SK Bukit Damansara');
    final cityCtrl = TextEditingController(text: 'Kuala Lumpur');
    String relationship = 'child';
    String gender = 'M';

    showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) {
          return AlertDialog(
            backgroundColor: AlokasColors.forestSurface,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(20),
              side: const BorderSide(color: AlokasColors.warmGold),
            ),
            title: const Text(
              'Add Family / Student Profile',
              style: TextStyle(
                color: AlokasColors.creamIvory,
                fontWeight: FontWeight.w800,
                fontSize: 17,
              ),
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    key: const Key('add-profile-fullname'),
                    controller: nameCtrl,
                    style: const TextStyle(color: AlokasColors.creamIvory),
                    decoration: const InputDecoration(
                      labelText: 'Full Name *',
                      hintText: 'e.g. Kabir Ashwanth',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    key: const Key('add-profile-username'),
                    controller: usernameCtrl,
                    style: const TextStyle(color: AlokasColors.creamIvory),
                    decoration: const InputDecoration(
                      labelText: 'Global @username',
                      hintText: 'e.g. kabir_u10',
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          initialValue: relationship,
                          dropdownColor: AlokasColors.forestCard,
                          style:
                              const TextStyle(color: AlokasColors.creamIvory),
                          decoration: const InputDecoration(
                            labelText: 'Relationship',
                          ),
                          items: const [
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
                            if (v != null) {
                              setDialogState(() => relationship = v);
                            }
                          },
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          initialValue: gender,
                          dropdownColor: AlokasColors.forestCard,
                          style:
                              const TextStyle(color: AlokasColors.creamIvory),
                          decoration: const InputDecoration(
                            labelText: 'Gender',
                          ),
                          items: const [
                            DropdownMenuItem(value: 'M', child: Text('Male')),
                            DropdownMenuItem(value: 'F', child: Text('Female')),
                          ],
                          onChanged: (v) {
                            if (v != null) {
                              setDialogState(() => gender = v);
                            }
                          },
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          key: const Key('add-profile-yob'),
                          controller: yobCtrl,
                          keyboardType: TextInputType.number,
                          style:
                              const TextStyle(color: AlokasColors.creamIvory),
                          decoration: const InputDecoration(
                            labelText: 'Year of Birth',
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: TextField(
                          key: const Key('add-profile-rating'),
                          controller: ratingCtrl,
                          keyboardType: TextInputType.number,
                          style:
                              const TextStyle(color: AlokasColors.creamIvory),
                          decoration: const InputDecoration(
                            labelText: 'FIDE / Rapid Rating',
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    key: const Key('add-profile-fideid'),
                    controller: fideIdCtrl,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: AlokasColors.creamIvory),
                    decoration: const InputDecoration(
                      labelText: 'FIDE ID (Optional)',
                      hintText: 'e.g. 5740119',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    key: const Key('add-profile-school'),
                    controller: schoolCtrl,
                    style: const TextStyle(color: AlokasColors.creamIvory),
                    decoration: const InputDecoration(
                      labelText: 'School / Chess Academy',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: cityCtrl,
                    style: const TextStyle(color: AlokasColors.creamIvory),
                    decoration: const InputDecoration(
                      labelText: 'City',
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                key: const Key('save-profile-button'),
                onPressed: () {
                  final fullName = nameCtrl.text.trim();
                  if (fullName.isEmpty) return;
                  final rawUser = usernameCtrl.text.trim();
                  final username = rawUser.isNotEmpty
                      ? rawUser
                      : fullName.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '_');
                  final yob = int.tryParse(yobCtrl.text.trim()) ?? 2015;
                  final rating = int.tryParse(ratingCtrl.text.trim()) ?? 1200;
                  final fideId = int.tryParse(fideIdCtrl.text.trim());

                  final created = MobilePlayerProfile(
                    id: 'prof-${DateTime.now().millisecondsSinceEpoch}',
                    fullName: fullName,
                    username: username,
                    relationship: relationship,
                    yearOfBirth: yob,
                    gender: gender,
                    fideId: fideId,
                    fideRapid: rating,
                    alokasRating: rating,
                    school: schoolCtrl.text.trim().isEmpty
                        ? 'Independent'
                        : schoolCtrl.text.trim(),
                    city: cityCtrl.text.trim().isEmpty
                        ? 'Kuala Lumpur'
                        : cityCtrl.text.trim(),
                    state: 'WP Kuala Lumpur',
                    email: signedInEmail,
                  );
                  onAddProfile(created);
                  Navigator.of(ctx).pop();
                },
                child: const Text('Save Profile'),
              ),
            ],
          );
        },
      ),
    );
  }

  void _openSignInSheet(BuildContext context) {
    final emailCtrl = TextEditingController(text: signedInEmail);
    final passCtrl = TextEditingController(text: '••••••••••••');

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AlokasColors.forestSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(
          20,
          20,
          20,
          MediaQuery.of(ctx).viewInsets.bottom + 28,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Supabase Cloud Account & Family Sync',
              style: TextStyle(
                color: AlokasColors.creamIvory,
                fontSize: 18,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Sign in to sync your global player profiles, registrations, and digital certificates with chess-manager.alokas.com.',
              style: TextStyle(color: AlokasColors.mutedSage, fontSize: 12.5),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: emailCtrl,
              style: const TextStyle(color: AlokasColors.creamIvory),
              decoration: const InputDecoration(
                labelText: 'Parent / Player Email',
                prefixIcon: Icon(
                  Icons.email_outlined,
                  color: AlokasColors.warmGold,
                ),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: passCtrl,
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
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () async {
                  await onSignIn(emailCtrl.text, passCtrl.text);
                  if (ctx.mounted) Navigator.of(ctx).pop();
                },
                icon: const Icon(Icons.cloud_done_outlined),
                label: const Text('Sign In & Sync Profiles'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
      children: [
        _buildAccountCard(context),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: Text(
                'MANAGED FAMILY & STUDENT PROFILES (${profiles.length})',
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
              onPressed: () => _openAddProfileDialog(context),
              icon: const Icon(Icons.person_add_alt_1, size: 16),
              label: const Text('+ Add Profile'),
            ),
          ],
        ),
        const SizedBox(height: 12),
        ...profiles.map((prof) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _buildProfileCard(context, prof),
            )),
      ],
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
            child: const Icon(
              Icons.verified_user,
              color: AlokasColors.brightGold,
              size: 26,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const AlokasBadge(
                  text: 'Global Participant & Family Account',
                  color: AlokasColors.emeraldSuccess,
                ),
                const SizedBox(height: 6),
                Text(
                  signedInEmail,
                  style: const TextStyle(
                    color: AlokasColors.creamIvory,
                    fontWeight: FontWeight.w800,
                    fontSize: 15,
                  ),
                ),
                const Text(
                  'Connected to chess-manager.alokas.com',
                  style: TextStyle(
                    color: AlokasColors.mutedSage,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          OutlinedButton(
            onPressed: () => _openSignInSheet(context),
            child: const Text('Switch / Auth'),
          ),
        ],
      ),
    );
  }

  Widget _buildProfileCard(BuildContext context, MobilePlayerProfile prof) {
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
              'Born ${prof.yearOfBirth} (Age ${prof.age}) • Gender: ${prof.gender} • FIDE ID: ${prof.fideId ?? "Unassigned"}',
              style: const TextStyle(
                color: AlokasColors.mutedSage,
                fontSize: 12.5,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              'School / Club: ${prof.school} • ${prof.city}, ${prof.state}',
              style: const TextStyle(
                color: AlokasColors.mutedSage,
                fontSize: 12.5,
              ),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
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
                onPressed: () async {
                  final count = await onClaimPastTournaments(prof);
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        backgroundColor: AlokasColors.forestElevated,
                        content: Text(
                          'Synced $count past tournament participations & certificates for ${prof.fullName}.',
                          style: const TextStyle(color: AlokasColors.creamIvory),
                        ),
                      ),
                    );
                  }
                },
                icon: const Icon(Icons.history_edu, size: 17),
                label: const Text('Claim Past Tournaments & Certificates'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
