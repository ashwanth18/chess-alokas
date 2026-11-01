import 'dart:convert';

/// A registration in progress, kept on this phone until the server has it.
class RegistrationDraft {
  final String accountKey;
  final String eventId;
  final String slugOrId;
  final String eventName;
  final int step;
  final List<String> selectedProfileIds;
  final Map<String, String?> categoryByProfile;

  /// Per player: question id to answer.
  final Map<String, Map<String, String>> answers;
  final String? receiptName;

  /// Players the server already accepted; never sent twice.
  final List<String> submittedProfileIds;

  /// The event detail as the API gave it, so the payment step still shows
  /// instructions on return from the banking app with no signal.
  final Map<String, dynamic>? detailJson;
  final DateTime updatedAt;

  const RegistrationDraft({
    required this.accountKey,
    required this.eventId,
    required this.slugOrId,
    required this.eventName,
    this.step = 0,
    this.selectedProfileIds = const [],
    this.categoryByProfile = const {},
    this.answers = const {},
    this.receiptName,
    this.submittedProfileIds = const [],
    this.detailJson,
    required this.updatedAt,
  });

  Map<String, dynamic> toJson() => {
    'accountKey': accountKey,
    'eventId': eventId,
    'slugOrId': slugOrId,
    'eventName': eventName,
    'step': step,
    'selectedProfileIds': selectedProfileIds,
    'categoryByProfile': categoryByProfile,
    'answers': answers,
    'receiptName': receiptName,
    'submittedProfileIds': submittedProfileIds,
    'detailJson': detailJson,
    'updatedAt': updatedAt.toUtc().toIso8601String(),
  };

  /// Null for anything unreadable, so a damaged file can't crash the start-up.
  static RegistrationDraft? tryDecode(String stored) {
    try {
      final json = jsonDecode(stored) as Map<String, dynamic>;
      return RegistrationDraft(
        accountKey: json['accountKey'] as String,
        eventId: json['eventId'] as String,
        slugOrId: json['slugOrId'] as String,
        eventName: json['eventName'] as String,
        step: json['step'] as int? ?? 0,
        selectedProfileIds: List<String>.from(
          json['selectedProfileIds'] as List? ?? const [],
        ),
        categoryByProfile: Map<String, String?>.from(
          json['categoryByProfile'] as Map? ?? const {},
        ),
        answers: {
          for (final entry in (json['answers'] as Map? ?? const {}).entries)
            entry.key as String: Map<String, String>.from(entry.value as Map),
        },
        receiptName: json['receiptName'] as String?,
        submittedProfileIds: List<String>.from(
          json['submittedProfileIds'] as List? ?? const [],
        ),
        detailJson: json['detailJson'] as Map<String, dynamic>?,
        updatedAt: DateTime.parse(json['updatedAt'] as String),
      );
    } on Object {
      return null;
    }
  }
}
