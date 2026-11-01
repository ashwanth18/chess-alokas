import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../theme/alokas_theme.dart';
import '../theme/alokas_tokens.dart';
import '../widgets/player_name.dart';

/// What the QR holds: this tournament and this entry, nothing about the child.
String checkInPayload(String tournamentId, String participantId) =>
    'alokas-checkin:v1:$tournamentId:$participantId';

/// A pass to show at the desk. It does not check anyone in by itself: the desk
/// marks the player present, and the app is not told, so it never claims so.
class CheckInPassScreen extends StatelessWidget {
  final String tournamentName;
  final String tournamentId;
  final String participantId;
  final String playerName;
  final int? number;
  final String? section;

  const CheckInPassScreen({
    super.key,
    required this.tournamentName,
    required this.tournamentId,
    required this.participantId,
    required this.playerName,
    this.number,
    this.section,
  });

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    return Scaffold(
      appBar: AppBar(title: const Text('Check-in pass')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          Text(
            tournamentName,
            style: atype(18, weight: 700, color: p.ink, height: 1.2),
          ),
          const SizedBox(height: 12),
          PlayerName(
            playerName,
            number: number,
            section: section,
            size: 24,
            weight: 800,
            color: p.ink,
          ),
          const SizedBox(height: 16),
          Center(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AlokasTokens.pieceWhite,
                border: Border.all(color: AlokasTokens.pieceBlack, width: 1.5),
              ),
              child: QrImageView(
                key: const Key('checkin-qr'),
                data: checkInPayload(tournamentId, participantId),
                size: 240,
                backgroundColor: AlokasTokens.pieceWhite,
                eyeStyle: const QrEyeStyle(
                  eyeShape: QrEyeShape.square,
                  color: AlokasTokens.pieceBlack,
                ),
                dataModuleStyle: const QrDataModuleStyle(
                  dataModuleShape: QrDataModuleShape.square,
                  color: AlokasTokens.pieceBlack,
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'Show this screen at the desk. The arbiter finds the player by name '
            'and number and marks them present.',
            style: atype(16, color: p.ink, height: 1.35),
          ),
          const SizedBox(height: 8),
          Container(
            key: const Key('checkin-not-confirmed'),
            padding: const EdgeInsets.all(12),
            color: p.waitWash,
            child: Text(
              'This pass does not check the player in. The desk cannot scan the '
              'code yet, and the app is not told when a player is marked '
              'present, so please confirm with the arbiter.',
              style: atype(14, weight: 600, color: p.wait, height: 1.3),
            ),
          ),
        ],
      ),
    );
  }
}
