import 'package:flutter/material.dart';

import '../models/draft.dart';
import '../models/models.dart';
import '../services/alokas_api.dart';
import '../services/file_gateway.dart';
import '../services/local_store.dart';
import '../theme/alokas_theme.dart';
import '../widgets/message_card.dart';
import 'register_screen.dart';

/// An event's facts and how to enter it. Everything comes from the API; nothing
/// here invites a payment or an entry the server would refuse.
class EventScreen extends StatefulWidget {
  final MobileEventItem event;
  final bool isSignedIn;
  final List<MobilePlayerProfile> profiles;
  final String? profilesUnavailable;
  final List<RegistrationRecord> existingRegistrations;
  final double? distanceKm;
  final String originCity;
  final Future<ApiResult<EventDetail>> Function() loadDetail;
  final ReceiptPicker receiptPicker;
  final Future<List<RegistrationAttempt>> Function(
    List<RegistrationSelection> selections,
    ReceiptFile? receipt,
  )
  onSubmit;
  final VoidCallback onGoToAccount;
  final RegistrationDraft? draft;
  final DraftStore draftStore;
  final String? accountKey;
  final VoidCallback onDraftsChanged;

  const EventScreen({
    super.key,
    required this.event,
    required this.isSignedIn,
    required this.profiles,
    required this.profilesUnavailable,
    required this.existingRegistrations,
    required this.distanceKm,
    required this.originCity,
    required this.loadDetail,
    required this.receiptPicker,
    required this.onSubmit,
    required this.onGoToAccount,
    required this.draft,
    required this.draftStore,
    required this.accountKey,
    required this.onDraftsChanged,
  });

  @override
  State<EventScreen> createState() => _EventScreenState();
}

class _EventScreenState extends State<EventScreen> {
  EventDetail? _detail;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final result = await widget.loadDetail();
    if (!mounted) return;
    setState(() {
      _loading = false;
      switch (result) {
        case ApiSuccess(:final value):
          _detail = value;
          _error = null;
        case ApiFailure(:final message):
          _error = message;
      }
    });
  }

  void _retry() {
    setState(() {
      _loading = true;
      _error = null;
    });
    _load();
  }

  void _goToAccount() {
    Navigator.of(context).pop();
    widget.onGoToAccount();
  }

  void _startRegistration(EventDetail detail) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => RegisterScreen(
          detail: detail,
          profiles: widget.profiles,
          existingRegistrations: widget.existingRegistrations,
          receiptPicker: widget.receiptPicker,
          onSubmit: widget.onSubmit,
          draft: widget.draft,
          draftStore: widget.draftStore,
          accountKey: widget.accountKey,
          onDraftsChanged: widget.onDraftsChanged,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final event = _detail?.event ?? widget.event;
    return Scaffold(
      appBar: AppBar(title: const Text('Event')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          _buildFacts(event),
          const SizedBox(height: 24),
          ..._buildBody(event),
        ],
      ),
    );
  }

  Widget _buildFacts(MobileEventItem event) {
    final p = context.pal;
    final detail = _detail;
    final distance = widget.distanceKm;
    final where = [
      event.venueAddress ?? event.locationLabel ?? 'Venue not listed',
      if (distance != null)
        '${distance.toStringAsFixed(1)} km from ${widget.originCity}',
    ].join('\n');
    final format = [
      if (event.style != null) event.style!.toUpperCase(),
      if (event.rounds != null) pluralize(event.rounds!, 'round'),
      ?event.timeControl,
    ].join(', ');

    Widget fact(String label, String value) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 88,
            child: Text(label, style: atype(16, weight: 600, color: p.accent)),
          ),
          Expanded(
            child: Text(
              value,
              style: atype(16, weight: 600, color: p.ink, height: 1.3),
            ),
          ),
        ],
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          event.organizationName ?? 'Organizer not listed',
          style: atype(16, weight: 600, color: p.accent),
        ),
        const SizedBox(height: 8),
        Text(
          event.displayName,
          style: atype(32, weight: 800, width: 108, color: p.ink, height: 1.12),
        ),
        const SizedBox(height: 12),
        Divider(color: p.accent, thickness: 1.5, height: 2),
        const SizedBox(height: 6),
        fact('When', formatDateForPeople(event.date) ?? 'Date not listed'),
        fact('Where', where),
        fact('Entry', event.feeLabel()),
        if (format.isNotEmpty) fact('Format', format),
        if (event.registrationDeadlineLabel != null)
          fact('Closes', event.registrationDeadlineLabel!),
        if (event.descriptionMd != null) ...[
          const SizedBox(height: 12),
          Text(
            event.descriptionMd!,
            style: atype(16, color: p.ink, height: 1.4),
          ),
        ],
        if (detail?.rulesMd != null) ...[
          const SizedBox(height: 12),
          Text(detail!.rulesMd!, style: atype(14, color: p.ink2, height: 1.4)),
        ],
      ],
    );
  }

  List<Widget> _buildBody(MobileEventItem event) {
    if (_loading) return const [LoadingLine()];
    final detail = _detail;
    if (detail == null) {
      return [
        MessageCard(
          isProblem: true,
          title: "Could not load this event's details",
          message: _error,
          actionLabel: 'Retry',
          onAction: _retry,
        ),
      ];
    }

    final closed = event.closedReason(DateTime.now());
    if (closed != null) {
      final existing = widget.existingRegistrations
          .where((r) => r.isActive)
          .map((r) => '${r.playerName ?? 'Player'}: ${r.statusLabel}')
          .join('\n');
      return [
        MessageCard(
          key: const Key('event-closed-card'),
          title: closed,
          message: existing.isEmpty ? null : existing,
        ),
      ];
    }

    return [
      if (event.isPaid) ...[
        PaymentBlock(event: event, detail: detail),
        const SizedBox(height: 16),
      ],
      ..._buildEntry(detail),
    ];
  }

  List<Widget> _buildEntry(EventDetail detail) {
    if (!widget.isSignedIn) {
      return [
        MessageCard(
          title: 'Sign in to register',
          message: 'Registering a player uses a saved profile on your account.',
          actionLabel: 'Go to Sign In',
          onAction: _goToAccount,
        ),
      ];
    }
    if (widget.profilesUnavailable != null) {
      return [
        MessageCard(
          title: 'Your player profiles are not available',
          message: widget.profilesUnavailable,
        ),
      ];
    }
    if (widget.profiles.isEmpty) {
      return [
        MessageCard(
          title: 'Add a player profile first',
          message: 'Registration uses the details saved on a player profile.',
          actionLabel: 'Go to Profiles',
          onAction: _goToAccount,
        ),
      ];
    }
    final hasDraft = widget.draft != null;
    return [
      SizedBox(
        width: double.infinity,
        child: ElevatedButton(
          key: const Key('start-register-button'),
          onPressed: () => _startRegistration(detail),
          child: Text(
            hasDraft
                ? 'Continue registration'
                : detail.event.isFull
                ? 'Join the waitlist'
                : 'Register a player',
          ),
        ),
      ),
    ];
  }
}

/// What the organizer published about paying, exactly as given. If nothing was
/// published the app says so and invents no instructions.
class PaymentBlock extends StatelessWidget {
  final MobileEventItem event;
  final EventDetail detail;
  final int players;

  const PaymentBlock({
    super.key,
    required this.event,
    required this.detail,
    this.players = 1,
  });

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    final instructions = detail.paymentInstructions;
    final qr = _qrImage(context, detail.paymentQrUrl);
    return BrandCard(
      strong: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Amount', style: atype(14, weight: 600, color: p.accent)),
          Text(
            event.feeLabel(players: players),
            key: const Key('payment-amount'),
            style: atype(
              44,
              weight: 800,
              width: 112,
              color: p.accent,
              tabular: true,
            ),
          ),
          if (players > 1)
            Text(
              'For $players players',
              style: atype(14, weight: 600, color: p.ink2),
            ),
          const SizedBox(height: 8),
          if (qr != null) ...[qr, const SizedBox(height: 8)],
          if (instructions != null)
            SelectableText(
              instructions,
              key: const Key('payment-instructions'),
              style: atype(16, color: p.ink, height: 1.4),
            ),
          if (instructions == null && qr == null)
            Text(
              'The organizer has not published payment instructions. Please '
              'contact the organizer before paying.',
              key: const Key('payment-contact-organizer'),
              style: atype(16, weight: 600, color: p.wait, height: 1.35),
            ),
        ],
      ),
    );
  }

  /// Shows an organizer's QR when the API gave an image the app can display
  /// directly. A private storage path cannot be shown, so it is skipped.
  Widget? _qrImage(BuildContext context, String? source) {
    if (source == null) return null;
    Widget error(BuildContext _, Object _, StackTrace? _) => Text(
      'The payment QR image could not be loaded.',
      style: atype(14, weight: 600, color: context.pal.wait),
    );
    if (source.startsWith('https://')) {
      return Image.network(source, height: 200, errorBuilder: error);
    }
    if (source.startsWith('data:image/')) {
      final data = Uri.tryParse(source)?.data;
      if (data == null) return null;
      return Image.memory(
        data.contentAsBytes(),
        height: 200,
        errorBuilder: error,
      );
    }
    return null;
  }
}
