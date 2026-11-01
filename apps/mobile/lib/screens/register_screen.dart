import 'package:flutter/material.dart';

import '../models/draft.dart';
import '../models/models.dart';
import '../services/alokas_api.dart';
import '../services/file_gateway.dart';
import '../services/local_store.dart';
import '../theme/alokas_theme.dart';
import '../widgets/message_card.dart';
import '../widgets/player_name.dart';
import 'event_screen.dart';

class RegistrationSelection {
  final MobilePlayerProfile profile;
  final String? categoryId;
  final Map<String, String> customAnswers;

  const RegistrationSelection({
    required this.profile,
    this.categoryId,
    this.customAnswers = const {},
  });
}

class RegistrationAttempt {
  final MobilePlayerProfile profile;
  final ApiResult<RegistrationRecord> result;

  const RegistrationAttempt({required this.profile, required this.result});
}

enum _Step { who, questions, pay, receipt }

/// Who is playing, the organizer's questions, paying, the receipt, one step at
/// a time. Every change is saved on the phone, so a parent can go to the banking
/// app, have this app killed, and come back to the same step.
class RegisterScreen extends StatefulWidget {
  final EventDetail detail;
  final List<MobilePlayerProfile> profiles;
  final List<RegistrationRecord> existingRegistrations;
  final ReceiptPicker receiptPicker;
  final Future<List<RegistrationAttempt>> Function(
    List<RegistrationSelection> selections,
    ReceiptFile? receipt,
  )
  onSubmit;
  final RegistrationDraft? draft;
  final DraftStore draftStore;
  final String? accountKey;
  final VoidCallback onDraftsChanged;

  /// Checks the event again on resume; a saved copy may have closed since.
  final Future<ApiResult<EventDetail>> Function()? reloadDetail;

  const RegisterScreen({
    super.key,
    required this.detail,
    required this.profiles,
    required this.existingRegistrations,
    required this.receiptPicker,
    required this.onSubmit,
    required this.draft,
    required this.draftStore,
    required this.accountKey,
    required this.onDraftsChanged,
    this.reloadDetail,
  });

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  late EventDetail _detail = widget.detail;
  int _stepIndex = 0;
  final Set<String> _selected = {};
  final Map<String, String?> _categories = {};
  final Map<String, Map<String, String>> _answers = {};

  /// Accepted by the server, from this flow or earlier. Not offered again, so a
  /// retry cannot create a duplicate.
  final Map<String, RegistrationRecord?> _submitted = {};
  final Map<String, TextEditingController> _answerControllers = {};
  ReceiptFile? _receipt;
  String? _receiptError;
  String? _stepError;
  bool _sending = false;
  List<RegistrationAttempt> _attempts = const [];
  List<RegistrationAttempt>? _finished;

  MobileEventItem get _event => _detail.event;

  /// The draft stays filed under the id it started with, even if a reload of
  /// the event returns a different one.
  late final String _draftKey = widget.draft?.eventId ?? widget.detail.event.id;

  /// Set once the draft is gone, so a late write can't bring it back.
  bool _draftClosed = false;

  List<_Step> get _steps => [
    _Step.who,
    if (_detail.questions.isNotEmpty) _Step.questions,
    if (_event.isPaid) ...[_Step.pay, _Step.receipt],
  ];

  _Step get _step => _steps[_stepIndex.clamp(0, _steps.length - 1)];

  List<MobilePlayerProfile> get _selectedProfiles =>
      widget.profiles.where((p) => _selected.contains(p.id)).toList();

  @override
  void initState() {
    super.initState();
    for (final record in widget.existingRegistrations) {
      final id = record.playerProfileId;
      if (id != null && record.isActive) _submitted[id] = record;
    }
    for (final profile in widget.profiles) {
      _categories[profile.id] = profile.suggestCategory(_event.categories)?.id;
    }
    final draft = widget.draft;
    if (draft != null) {
      _stepIndex = draft.step;
      _selected.addAll(draft.selectedProfileIds);
      _categories.addAll(draft.categoryByProfile);
      draft.answers.forEach((id, map) => _answers[id] = {...map});
      for (final id in draft.submittedProfileIds) {
        _submitted.putIfAbsent(id, () => null);
      }
      _restoreReceipt(draft);
    } else {
      final available = widget.profiles.where(
        (p) => !_submitted.containsKey(p.id),
      );
      if (available.isNotEmpty) _selected.add(available.first.id);
      _persist();
    }
    _selected.removeWhere(_submitted.containsKey);
    _recheckEvent();
  }

  @override
  void dispose() {
    for (final controller in _answerControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _recheckEvent() async {
    final reload = widget.reloadDetail;
    if (reload == null) return;
    final result = await reload();
    if (!mounted) return;
    // No signal is fine: the saved copy carries on and sending will tell.
    if (result case ApiSuccess(:final value)) {
      setState(() => _detail = value);
      _persist();
    }
  }

  Future<void> _restoreReceipt(RegistrationDraft draft) async {
    final name = draft.receiptName;
    final account = widget.accountKey;
    if (name == null || account == null) return;
    final bytes = await widget.draftStore.loadReceipt(account, draft.eventId);
    if (!mounted || bytes == null) return;
    final (receipt, _) = ReceiptFile.validate(
      PickedReceipt(name: name, bytes: bytes),
    );
    setState(() => _receipt = receipt);
  }

  Future<void> _persist() async {
    final account = widget.accountKey;
    if (account == null || _draftClosed) return;
    await widget.draftStore.save(
      RegistrationDraft(
        accountKey: account,
        eventId: _draftKey,
        slugOrId: _event.slugOrId,
        eventName: _event.displayName,
        step: _stepIndex,
        selectedProfileIds: _selected.toList(),
        categoryByProfile: _categories,
        answers: _answers,
        receiptName: _receipt?.name,
        submittedProfileIds: _submitted.keys.toList(),
        detailJson: _detail.raw,
        updatedAt: DateTime.now(),
      ),
    );
    widget.onDraftsChanged();
  }

  Future<void> _discard() async {
    _draftClosed = true;
    final account = widget.accountKey;
    if (account != null) {
      await widget.draftStore.delete(account, _draftKey);
      widget.onDraftsChanged();
    }
    if (mounted) Navigator.of(context).pop();
  }

  TextEditingController _answerController(String profileId, String questionId) {
    return _answerControllers.putIfAbsent(
      '$profileId/$questionId',
      () => TextEditingController(text: _answers[profileId]?[questionId] ?? ''),
    );
  }

  void _setAnswer(String profileId, String questionId, String? value) {
    final answers = _answers.putIfAbsent(profileId, () => {});
    if (value == null || value.trim().isEmpty) {
      answers.remove(questionId);
    } else {
      answers[questionId] = value;
    }
    _persist();
  }

  /// Why the current step can't be left yet; null when it can.
  String? _problemWithStep() {
    switch (_step) {
      case _Step.who:
        return _selected.isEmpty ? 'Choose at least one player.' : null;
      case _Step.questions:
        for (final profile in _selectedProfiles) {
          for (final question in _detail.questions) {
            if (!question.required) continue;
            final answer = _answers[profile.id]?[question.id] ?? '';
            if (answer.trim().isEmpty) {
              return 'Please answer "${question.label}" for '
                  '${displayPlayerName(profile.fullName)}.';
            }
          }
        }
        return null;
      case _Step.pay:
      case _Step.receipt:
        return null;
    }
  }

  void _goNext() {
    final problem = _problemWithStep();
    if (problem != null) {
      setState(() => _stepError = problem);
      return;
    }
    setState(() {
      _stepError = null;
      _stepIndex++;
    });
    _persist();
  }

  void _goBack() {
    setState(() {
      _stepError = null;
      _stepIndex--;
    });
    _persist();
  }

  Future<void> _chooseReceipt() async {
    setState(() => _receiptError = null);
    final PickedReceipt? picked;
    try {
      picked = await widget.receiptPicker();
    } on Object {
      if (mounted) {
        setState(() => _receiptError = 'The file picker could not be opened.');
      }
      return;
    }
    if (picked == null || !mounted) return;
    final (receipt, error) = ReceiptFile.validate(picked);
    setState(() {
      _receipt = receipt ?? _receipt;
      _receiptError = error;
    });
    final account = widget.accountKey;
    if (receipt != null && account != null) {
      await widget.draftStore.saveReceipt(account, _draftKey, receipt.bytes);
      _persist();
    }
  }

  void _removeReceipt() {
    setState(() => _receipt = null);
    final account = widget.accountKey;
    if (account != null) {
      widget.draftStore.deleteReceipt(account, _draftKey);
    }
    _persist();
  }

  /// Each entry reports its own outcome. Only a 201 marks a player as sent; the
  /// rest stay in the draft to try again.
  Future<void> _send() async {
    final problem = _problemWithStep();
    if (problem != null) {
      setState(() => _stepError = problem);
      return;
    }
    final selections = [
      for (final profile in _selectedProfiles)
        RegistrationSelection(
          profile: profile,
          categoryId: _categories[profile.id],
          customAnswers: _answers[profile.id] ?? const {},
        ),
    ];
    setState(() {
      _sending = true;
      _attempts = const [];
      _stepError = null;
    });
    final attempts = await widget.onSubmit(selections, _receipt);
    if (!mounted) return;

    for (final attempt in attempts) {
      if (attempt.result case ApiSuccess(:final value)) {
        _submitted[attempt.profile.id] = value;
        _selected.remove(attempt.profile.id);
      }
    }
    final allAccepted = attempts.every((a) => a.result is ApiSuccess);
    final missingReceipt =
        _receipt != null &&
        attempts.any((a) {
          final result = a.result;
          return result is ApiSuccess<RegistrationRecord> &&
              result.value.hasReceipt == false;
        });
    if (allAccepted && !missingReceipt) {
      _draftClosed = true;
      final account = widget.accountKey;
      if (account != null) {
        await widget.draftStore.delete(account, _draftKey);
        widget.onDraftsChanged();
      }
      if (!mounted) return;
      setState(() {
        _sending = false;
        _finished = attempts;
      });
      return;
    }
    await _persist();
    if (!mounted) return;
    setState(() {
      _sending = false;
      _attempts = attempts;
    });
  }

  @override
  Widget build(BuildContext context) {
    final finished = _finished;
    return Scaffold(
      appBar: AppBar(title: Text(finished == null ? 'Register' : 'Sent')),
      body: SafeArea(
        child: finished != null ? _buildDone(finished) : _buildFlow(),
      ),
    );
  }

  Widget _buildFlow() {
    final p = context.pal;
    final closed = _event.closedReason(DateTime.now());
    if (closed != null) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          MessageCard(
            key: const Key('event-closed-card'),
            title: closed,
            message: 'This registration was not sent.',
            actionLabel: 'Discard it',
            onAction: _discard,
          ),
        ],
      );
    }
    const titles = {
      _Step.who: 'Who is playing?',
      _Step.questions: "The organizer's questions",
      _Step.pay: 'Pay the entry fee',
      _Step.receipt: 'Add your receipt',
    };
    final steps = _steps;
    final index = _stepIndex.clamp(0, steps.length - 1);
    final isLast = index == steps.length - 1;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: p.accent, width: 1.5)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _event.displayName,
                style: atype(14, weight: 600, color: p.ink2),
              ),
              const SizedBox(height: 4),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: Text(
                      titles[_step]!,
                      key: const Key('step-title'),
                      style: atype(20, weight: 800, color: p.ink),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Step ${index + 1} of ${steps.length}',
                    style: atype(
                      14,
                      weight: 600,
                      color: p.accent,
                      tabular: true,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            children: [
              Row(
                children: [
                  StatusSquare(color: p.go),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Saved on this phone, so you can leave and come back.',
                      key: const Key('draft-saved-line'),
                      style: atype(14, weight: 600, color: p.go),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              ...switch (_step) {
                _Step.who => _buildWho(),
                _Step.questions => _buildQuestions(),
                _Step.pay => _buildPay(),
                _Step.receipt => _buildReceipt(),
              },
              if (isLast) ..._attempts.map(_buildAttempt),
              if (_stepError != null) ...[
                const SizedBox(height: 8),
                Text(
                  _stepError!,
                  key: const Key('step-error'),
                  style: atype(16, weight: 600, color: p.flag, height: 1.3),
                ),
              ],
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          decoration: BoxDecoration(
            border: Border(top: BorderSide(color: p.rule)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (isLast)
                ElevatedButton(
                  key: const Key('confirm-register-button'),
                  onPressed: _sending || _selected.isEmpty ? null : _send,
                  child: Text(_sendLabel()),
                )
              else
                ElevatedButton(
                  key: const Key('register-next'),
                  onPressed: _goNext,
                  child: Text(
                    _step == _Step.pay ? "I've paid, add receipt" : 'Continue',
                  ),
                ),
              const SizedBox(height: 4),
              Row(
                children: [
                  if (index > 0)
                    TextButton(
                      key: const Key('register-back'),
                      onPressed: _goBack,
                      child: const Text('Back'),
                    ),
                  const Spacer(),
                  TextButton(
                    key: const Key('discard-draft'),
                    onPressed: _discard,
                    child: const Text('Discard'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  String _sendLabel() {
    if (_sending) return 'Sending...';
    final count = _selected.length;
    final who = count == 1 ? '1 player' : '$count players';
    return _event.isFull ? 'Join waitlist ($who)' : 'Send registration ($who)';
  }

  List<Widget> _buildWho() {
    final p = context.pal;
    final everyone = widget.profiles.every(
      (profile) => _submitted.containsKey(profile.id),
    );
    final selected = _selectedProfiles;
    return [
      if (everyone)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Text(
            'All your players have already submitted a registration for this '
            'event.',
            key: const Key('all-players-submitted'),
            style: atype(16, color: p.ink2),
          ),
        ),
      for (final profile in widget.profiles) ...[
        ChoiceBox(
          key: Key('select-profile-${profile.id}'),
          selected: selected.contains(profile),
          onTap: _submitted.containsKey(profile.id)
              ? null
              : () {
                  setState(() {
                    if (!_selected.remove(profile.id)) {
                      _selected.add(profile.id);
                    }
                    _stepError = null;
                  });
                  _persist();
                },
          builder: (foreground) {
            final done = _submitted[profile.id];
            final alreadySent = _submitted.containsKey(profile.id);
            return PlayerName(
              profile.fullName,
              detail: alreadySent
                  ? (done?.statusLabel ?? 'Already sent')
                  : profile.disambiguator,
              color: foreground,
            );
          },
        ),
        if (selected.contains(profile)) _buildCategory(profile),
        const SizedBox(height: 8),
      ],
      if (_event.isFull && selected.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 4, bottom: 8),
          child: Text(
            selected.length == 1
                ? 'This event is full (${_event.registeredCount} of ${pluralize(_event.maxParticipants!, 'place')}). ${displayPlayerName(selected.single.fullName)} will be waitlisted, not given a place.'
                : 'This event is full (${_event.registeredCount} of ${pluralize(_event.maxParticipants!, 'place')}). These ${selected.length} players will be waitlisted, not given places.',
            key: const Key('event-full-warning'),
            style: atype(16, weight: 600, color: p.wait, height: 1.3),
          ),
        ),
    ];
  }

  Widget _buildCategory(MobilePlayerProfile profile) {
    final p = context.pal;
    final categories = _event.categories;
    if (categories.isEmpty) {
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Text(
          'This event lists no categories. The organizer will place the player.',
          style: atype(14, color: p.ink2),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: DropdownButtonFormField<String?>(
        key: Key('category-${profile.id}'),
        initialValue: _categories[profile.id],
        isExpanded: true,
        decoration: const InputDecoration(
          labelText: 'Section (suggested from age; please check)',
        ),
        items: [
          const DropdownMenuItem<String?>(
            value: null,
            child: Text('Let the organizer decide'),
          ),
          ...categories.map(
            (c) => DropdownMenuItem<String?>(value: c.id, child: Text(c.name)),
          ),
        ],
        onChanged: (value) {
          setState(() => _categories[profile.id] = value);
          _persist();
        },
      ),
    );
  }

  List<Widget> _buildQuestions() {
    final p = context.pal;
    final multiple = _selected.length > 1;
    return [
      for (final profile in _selectedProfiles) ...[
        if (multiple)
          Padding(
            padding: const EdgeInsets.only(bottom: 8, top: 8),
            child: PlayerName(
              profile.fullName,
              detail: profile.disambiguator,
              color: p.ink,
            ),
          ),
        for (final question in _detail.questions)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _buildQuestion(profile, question),
          ),
      ],
    ];
  }

  Widget _buildQuestion(
    MobilePlayerProfile profile,
    RegistrationQuestion question,
  ) {
    final label = question.required ? '${question.label} *' : question.label;
    final current = _answers[profile.id]?[question.id];
    if (question.isChoice) {
      return DropdownButtonFormField<String?>(
        key: Key('question-${profile.id}-${question.id}'),
        initialValue: question.options.contains(current) ? current : null,
        isExpanded: true,
        decoration: InputDecoration(labelText: label),
        items: [
          const DropdownMenuItem<String?>(
            value: null,
            child: Text('Choose...'),
          ),
          ...question.options.map(
            (o) => DropdownMenuItem<String?>(value: o, child: Text(o)),
          ),
        ],
        onChanged: (value) {
          setState(() => _stepError = null);
          _setAnswer(profile.id, question.id, value);
        },
      );
    }
    return TextField(
      key: Key('question-${profile.id}-${question.id}'),
      controller: _answerController(profile.id, question.id),
      decoration: InputDecoration(labelText: label),
      onChanged: (value) {
        if (_stepError != null) setState(() => _stepError = null);
        _setAnswer(profile.id, question.id, value);
      },
    );
  }

  List<Widget> _buildPay() {
    final p = context.pal;
    return [
      PaymentBlock(
        event: _event,
        detail: _detail,
        players: _selected.isEmpty ? 1 : _selected.length,
      ),
      const SizedBox(height: 16),
      Text(
        'Pay in your banking app, keep the receipt, then come back here. If '
        'this app closes, your details are still here.',
        style: atype(16, color: p.ink, height: 1.35),
      ),
    ];
  }

  List<Widget> _buildReceipt() {
    final p = context.pal;
    final receipt = _receipt;
    return [
      if (receipt != null)
        Text(
          _selected.length > 1
              ? 'Attaching ${receipt.name} to each selected player.'
              : 'Attaching ${receipt.name}.',
          key: const Key('receipt-chosen'),
          style: atype(16, weight: 600, color: p.ink, height: 1.3),
        )
      else
        Text(
          'No receipt chosen. You can still send this: the organizer will see '
          'it as unpaid until a receipt arrives.',
          key: const Key('receipt-pending-note'),
          style: atype(16, weight: 600, color: p.wait, height: 1.35),
        ),
      if (_receiptError != null) ...[
        const SizedBox(height: 4),
        Text(
          _receiptError!,
          key: const Key('receipt-error'),
          style: atype(16, weight: 600, color: p.flag),
        ),
      ],
      const SizedBox(height: 12),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          OutlinedButton(
            key: const Key('choose-receipt-button'),
            onPressed: _chooseReceipt,
            child: Text(
              receipt == null ? 'Choose file' : 'Choose a different one',
            ),
          ),
          if (receipt != null)
            TextButton(
              key: const Key('remove-receipt-button'),
              onPressed: _removeReceipt,
              child: const Text('Remove'),
            ),
        ],
      ),
      const SizedBox(height: 4),
      Text(
        'PNG, JPEG, WebP or PDF, up to 5 MB.',
        style: atype(14, color: p.ink2),
      ),
      const SizedBox(height: 12),
    ];
  }

  Widget _buildAttempt(RegistrationAttempt attempt) {
    final p = context.pal;
    final name = displayPlayerName(attempt.profile.fullName);
    final result = attempt.result;
    final String text;
    final Color color;
    switch (result) {
      case ApiFailure(:final message):
        text = '$name: NOT registered. $message';
        color = p.flag;
      case ApiSuccess(:final value):
        text = value.hasReceipt == false && _receipt != null
            ? '$name: ${value.statusLabel}, but the server did not record the receipt.'
            : value.paymentLabel == null
            ? '$name: ${value.statusLabel}'
            : '$name: ${value.statusLabel}. ${value.paymentLabel}';
        color = p.wait;
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: atype(16, weight: 600, color: color, height: 1.3),
      ),
    );
  }

  Widget _buildDone(List<RegistrationAttempt> attempts) {
    final p = context.pal;
    final organizer = _event.organizationName;
    final unpaid = attempts.any((a) {
      final result = a.result;
      return result is ApiSuccess<RegistrationRecord> &&
          result.value.needsReceipt;
    });
    return ListView(
      key: const Key('register-done'),
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          organizer == null ? 'Sent to the organizer' : 'Sent to $organizer',
          style: atype(32, weight: 800, color: p.accent, height: 1.12),
        ),
        const SizedBox(height: 8),
        Text(
          'Not on the player list yet. The organizer checks each entry first.',
          style: atype(18, color: p.ink, height: 1.3),
        ),
        const SizedBox(height: 16),
        for (final attempt in attempts)
          if (attempt.result case ApiSuccess(:final value))
            Container(
              padding: const EdgeInsets.symmetric(vertical: 10),
              decoration: BoxDecoration(
                border: Border(bottom: BorderSide(color: p.rule)),
              ),
              child: PlayerName(
                attempt.profile.fullName,
                detail: [value.statusLabel, ?value.paymentLabel].join(' · '),
                color: p.ink,
              ),
            ),
        if (unpaid) ...[
          const SizedBox(height: 16),
          Text(
            'No receipt was sent. Add it from the Account tab under '
            'Registrations.',
            key: const Key('done-add-receipt-later'),
            style: atype(16, weight: 600, color: p.wait, height: 1.35),
          ),
        ],
        const SizedBox(height: 24),
        ElevatedButton(
          key: const Key('register-done-button'),
          onPressed: () =>
              Navigator.of(context).popUntil((route) => route.isFirst),
          child: const Text('Back to events'),
        ),
      ],
    );
  }
}
