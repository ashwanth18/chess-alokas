import 'package:flutter/material.dart';

import '../models/models.dart';
import '../services/alokas_api.dart';
import '../services/file_gateway.dart';
import '../theme/alokas_theme.dart';
import '../widgets/message_card.dart';

class RegistrationSelection {
  final MobilePlayerProfile profile;
  final String? categoryId;

  const RegistrationSelection({required this.profile, this.categoryId});
}

class RegistrationAttempt {
  final MobilePlayerProfile profile;
  final ApiResult<RegistrationRecord> result;

  const RegistrationAttempt({required this.profile, required this.result});
}

String _recordBadgeText(RegistrationRecord record) {
  final name = record.playerName ?? 'Player';
  final String state;
  switch (record.status) {
    case 'pending':
      state = 'Pending';
    case 'approved':
      state = 'Approved';
    default:
      state = record.statusLabel;
  }
  final payment = record.paymentLabel;
  return payment == null ? '$state: $name' : '$state: $name. $payment';
}

class DiscoverScreen extends StatefulWidget {
  final bool eventsLoading;
  final String? eventsError;

  /// When [events] last came from the server; null if they never have.
  final DateTime? eventsUpdatedAt;
  final List<MobileEventItem> events;
  final bool isSignedIn;
  final List<MobilePlayerProfile> profiles;

  /// Why [profiles] cannot be trusted right now: still loading, or the error.
  final String? profilesUnavailable;
  final Map<String, List<RegistrationRecord>> registrationsByEvent;
  final LocationPreset selectedLocation;
  final ValueChanged<LocationPreset> onLocationChanged;
  final Future<ApiResult<EventDetail>> Function(String slugOrId)
  loadEventDetail;
  final Future<List<RegistrationAttempt>> Function(
    MobileEventItem event,
    List<RegistrationSelection> selections,
    ReceiptFile? receipt,
  )
  onRegister;
  final Future<void> Function() onRefresh;
  final VoidCallback onGoToAccount;
  final ReceiptPicker receiptPicker;

  const DiscoverScreen({
    super.key,
    required this.eventsLoading,
    required this.eventsError,
    this.eventsUpdatedAt,
    required this.events,
    required this.isSignedIn,
    required this.profiles,
    required this.profilesUnavailable,
    required this.registrationsByEvent,
    required this.selectedLocation,
    required this.onLocationChanged,
    required this.loadEventDetail,
    required this.onRegister,
    required this.onRefresh,
    required this.onGoToAccount,
    required this.receiptPicker,
  });

  @override
  State<DiscoverScreen> createState() => _DiscoverScreenState();
}

class _DiscoverScreenState extends State<DiscoverScreen> {
  double? _selectedRadiusKm; // null = no distance limit
  String _selectedCategoryCode = 'All';
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  double? _distanceTo(MobileEventItem event) => event.distanceFrom(
    widget.selectedLocation.latitude,
    widget.selectedLocation.longitude,
  );

  List<MobileEventItem> get _filteredEvents {
    final q = _searchQuery.trim().toLowerCase();
    final radius = _selectedRadiusKm;

    final filtered = widget.events.where((evt) {
      if (radius != null) {
        // An event with no coordinates cannot be shown to be within a radius.
        final dist = _distanceTo(evt);
        if (dist == null || dist > radius) return false;
      }
      if (_selectedCategoryCode != 'All' &&
          !evt.categories.any((c) => c.code == _selectedCategoryCode)) {
        return false;
      }
      if (q.isNotEmpty) {
        final hay = [
          evt.name,
          evt.city,
          evt.state,
          evt.venueName,
          evt.organizationName,
        ].whereType<String>().join(' ').toLowerCase();
        if (!hay.contains(q)) return false;
      }
      return true;
    }).toList();

    filtered.sort((a, b) {
      final da = _distanceTo(a);
      final db = _distanceTo(b);
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da.compareTo(db);
    });
    return filtered;
  }

  void _openRegistrationSheet(MobileEventItem event) {
    final messenger = ScaffoldMessenger.of(context);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AlokasColors.forestSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => _EventDetailRegistrationSheet(
        event: event,
        isSignedIn: widget.isSignedIn,
        profiles: widget.profiles,
        profilesUnavailable: widget.profilesUnavailable,
        existingRegistrations:
            widget.registrationsByEvent[event.id] ?? const [],
        distanceKm: _distanceTo(event),
        originCity: widget.selectedLocation.city,
        loadDetail: () => widget.loadEventDetail(event.slugOrId),
        receiptPicker: widget.receiptPicker,
        onSubmit: (selections, receipt) =>
            widget.onRegister(event, selections, receipt),
        onGoToAccount: () {
          Navigator.of(ctx).pop();
          widget.onGoToAccount();
        },
        onAllSubmitted: (summary) {
          Navigator.of(ctx).pop();
          messenger.showSnackBar(
            SnackBar(
              backgroundColor: AlokasColors.forestElevated,
              content: Text(
                summary,
                style: const TextStyle(color: AlokasColors.creamIvory),
              ),
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final events = _filteredEvents;
    final countKnown =
        widget.events.isNotEmpty ||
        (!widget.eventsLoading && widget.eventsError == null);
    return RefreshIndicator(
      color: AlokasColors.warmGold,
      backgroundColor: AlokasColors.forestCard,
      onRefresh: widget.onRefresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
        children: [
          _buildLocationHeaderCard(),
          const SizedBox(height: 12),
          TextField(
            controller: _searchController,
            onChanged: (v) => setState(() => _searchQuery = v),
            style: const TextStyle(color: AlokasColors.creamIvory),
            decoration: InputDecoration(
              hintText: 'Search tournaments, city, venue, or academy...',
              prefixIcon: const Icon(
                Icons.search,
                color: AlokasColors.warmGold,
              ),
              suffixIcon: _searchQuery.isNotEmpty
                  ? IconButton(
                      icon: const Icon(
                        Icons.clear,
                        color: AlokasColors.mutedSage,
                      ),
                      onPressed: () {
                        _searchController.clear();
                        setState(() => _searchQuery = '');
                      },
                    )
                  : null,
            ),
          ),
          const SizedBox(height: 12),
          _buildRadiusFilterRow(),
          const SizedBox(height: 8),
          _buildCategoryFilterRow(),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: Text(
                  countKnown ? 'TOURNAMENTS (${events.length})' : 'TOURNAMENTS',
                  style: const TextStyle(
                    color: AlokasColors.warmGold,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.9,
                  ),
                ),
              ),
              Flexible(
                child: Text(
                  'By distance from ${widget.selectedLocation.city}',
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: AlokasColors.mutedSage.withValues(alpha: 0.85),
                    fontSize: 11.5,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ..._buildEventList(events),
        ],
      ),
    );
  }

  List<Widget> _buildEventList(List<MobileEventItem> events) {
    if (widget.eventsLoading && widget.events.isEmpty) {
      return const [
        Padding(
          padding: EdgeInsets.all(32),
          child: Center(
            child: CircularProgressIndicator(color: AlokasColors.warmGold),
          ),
        ),
      ];
    }
    final error = widget.eventsError;
    if (error != null && widget.events.isEmpty) {
      return [
        MessageCard(
          icon: Icons.cloud_off,
          accent: AlokasColors.crimsonDanger,
          title: 'Could not load events',
          message: error,
          actionLabel: 'Retry',
          onAction: widget.onRefresh,
        ),
      ];
    }
    if (widget.events.isEmpty) {
      return [
        MessageCard(
          icon: Icons.event_busy,
          title: 'No events yet',
          message: 'Published tournaments will appear here.',
          actionLabel: 'Check again',
          onAction: widget.onRefresh,
        ),
      ];
    }
    final notice = [
      if (error != null)
        StaleNotice(
          reason: error,
          lastLoadedAt: widget.eventsUpdatedAt,
          onRetry: widget.onRefresh,
        ),
    ];
    if (events.isEmpty) {
      return [
        ...notice,
        MessageCard(
          icon: Icons.location_searching,
          title: 'No tournaments match these filters.',
          actionLabel: 'Reset Filters',
          onAction: () {
            setState(() {
              _selectedRadiusKm = null;
              _selectedCategoryCode = 'All';
              _searchQuery = '';
              _searchController.clear();
            });
          },
        ),
      ];
    }
    return [
      ...notice,
      ...events.map(
        (evt) => Padding(
          padding: const EdgeInsets.only(bottom: 14),
          child: _buildEventCard(evt),
        ),
      ),
    ];
  }

  Widget _buildLocationHeaderCard() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AlokasColors.forestElevated, AlokasColors.forestCard],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AlokasColors.goldBorder),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AlokasColors.warmGold.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(
              Icons.place_outlined,
              color: AlokasColors.brightGold,
              size: 20,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'SEARCHING NEAR A CITY YOU CHOOSE',
                  style: TextStyle(
                    color: AlokasColors.warmGold,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.7,
                  ),
                ),
                DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    isExpanded: true,
                    isDense: true,
                    dropdownColor: AlokasColors.forestSurface,
                    value: widget.selectedLocation.id,
                    icon: const Icon(
                      Icons.expand_more,
                      color: AlokasColors.brightGold,
                      size: 18,
                    ),
                    style: const TextStyle(
                      color: AlokasColors.creamIvory,
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                    ),
                    items: locationPresets
                        .map(
                          (preset) => DropdownMenuItem<String>(
                            value: preset.id,
                            child: Text(
                              preset.label,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (id) {
                      if (id == null) return;
                      widget.onLocationChanged(
                        locationPresets.firstWhere((p) => p.id == id),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRadiusFilterRow() {
    final options = <MapEntry<String, double?>>[
      const MapEntry('10 km', 10.0),
      const MapEntry('25 km', 25.0),
      const MapEntry('50 km', 50.0),
      const MapEntry('Any distance', null),
    ];

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          const Text(
            'Radius: ',
            style: TextStyle(
              color: AlokasColors.mutedSage,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 4),
          ...options.map((entry) {
            final selected = _selectedRadiusKm == entry.value;
            return Padding(
              padding: const EdgeInsets.only(right: 8),
              child: ChoiceChip(
                label: Text(entry.key),
                selected: selected,
                selectedColor: AlokasColors.warmGold,
                backgroundColor: AlokasColors.forestSurface,
                labelStyle: TextStyle(
                  color: selected
                      ? AlokasColors.deepForest
                      : AlokasColors.creamIvory,
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                ),
                onSelected: (_) =>
                    setState(() => _selectedRadiusKm = entry.value),
              ),
            );
          }),
        ],
      ),
    );
  }

  /// Chips come from the categories the loaded events really have.
  Widget _buildCategoryFilterRow() {
    final codes = <String>{
      for (final event in widget.events)
        for (final category in event.categories) category.code,
    }.toList()..sort();
    if (codes.isEmpty) return const SizedBox.shrink();
    final categories = ['All', ...codes];
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          const Text(
            'Section: ',
            style: TextStyle(
              color: AlokasColors.mutedSage,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(width: 4),
          ...categories.map((cat) {
            final selected = _selectedCategoryCode == cat;
            return Padding(
              padding: const EdgeInsets.only(right: 8),
              child: FilterChip(
                label: Text(cat),
                selected: selected,
                selectedColor: AlokasColors.brightGold,
                checkmarkColor: AlokasColors.deepForest,
                backgroundColor: AlokasColors.forestSurface,
                labelStyle: TextStyle(
                  color: selected
                      ? AlokasColors.deepForest
                      : AlokasColors.creamIvory,
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                ),
                onSelected: (_) => setState(() => _selectedCategoryCode = cat),
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildEventCard(MobileEventItem evt) {
    final distKm = _distanceTo(evt);
    final records = widget.registrationsByEvent[evt.id] ?? const [];
    final registeredCount = evt.registeredCount;
    final maxParticipants = evt.maxParticipants;
    final closed = evt.closedReason(DateTime.now()) != null;
    final deadline = evt.registrationDeadlineLabel;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                if (distKm != null)
                  AlokasBadge(
                    text:
                        '${distKm.toStringAsFixed(1)} km from ${widget.selectedLocation.city}',
                    color: AlokasColors.emeraldSuccess,
                    icon: Icons.near_me,
                  ),
                if (evt.organizationName != null)
                  AlokasBadge(
                    text: evt.organizationName!,
                    color: AlokasColors.warmGold,
                    icon: Icons.groups_outlined,
                  ),
                ...records.map(
                  (record) => AlokasBadge(
                    text: _recordBadgeText(record),
                    color: record.isWaitlisted || !record.isActive
                        ? AlokasColors.amberWarning
                        : AlokasColors.skyInfo,
                    icon: record.isWaitlisted
                        ? Icons.hourglass_top
                        : record.isActive
                        ? Icons.check_circle
                        : Icons.cancel_outlined,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              evt.displayName,
              style: const TextStyle(
                color: AlokasColors.creamIvory,
                fontSize: 16.5,
                fontWeight: FontWeight.w800,
                height: 1.25,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(
                  Icons.place_outlined,
                  size: 15,
                  color: AlokasColors.warmGold,
                ),
                const SizedBox(width: 5),
                Expanded(
                  child: Text(
                    evt.locationLabel ?? 'Venue not listed',
                    style: const TextStyle(
                      color: AlokasColors.mutedSage,
                      fontSize: 12.5,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 12,
              runSpacing: 6,
              children: [
                _metaItem(
                  Icons.calendar_today,
                  formatDateForPeople(evt.date) ?? 'Date not listed',
                ),
                if (evt.timeControl != null)
                  _metaItem(Icons.timer_outlined, evt.timeControl!),
                if (registeredCount != null)
                  _metaItem(
                    Icons.people_outline,
                    maxParticipants != null
                        ? '$registeredCount/$maxParticipants players'
                        : pluralize(registeredCount, 'player'),
                  ),
                _metaItem(Icons.payments_outlined, evt.feeLabel()),
              ],
            ),
            if (closed) ...[
              const SizedBox(height: 8),
              AlokasBadge(
                key: const Key('event-closed-badge'),
                text: evt.closedReason(DateTime.now())!,
                color: AlokasColors.amberWarning,
                icon: Icons.event_busy,
              ),
            ] else if (evt.isFull) ...[
              const SizedBox(height: 8),
              const AlokasBadge(
                text: 'Full: new entries are waitlisted',
                color: AlokasColors.amberWarning,
                icon: Icons.hourglass_top,
              ),
            ] else if (deadline != null) ...[
              const SizedBox(height: 6),
              Text(
                'Register by $deadline',
                style: const TextStyle(
                  color: AlokasColors.mutedSage,
                  fontSize: 12,
                ),
              ),
            ],
            if (evt.categories.isNotEmpty) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: evt.categories
                    .map(
                      (c) => Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: AlokasColors.forestSurface,
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: AlokasColors.goldBorder),
                        ),
                        child: Text(
                          c.name,
                          style: const TextStyle(
                            color: AlokasColors.creamIvory,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    )
                    .toList(),
              ),
            ],
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () => _openRegistrationSheet(evt),
                icon: Icon(closed ? Icons.info_outline : Icons.bolt, size: 18),
                label: Text(
                  closed
                      ? 'View Details (Registration Closed)'
                      : evt.isFull
                      ? 'View & Join Waitlist'
                      : 'View & Register',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _metaItem(IconData icon, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: AlokasColors.brightGold),
        const SizedBox(width: 4),
        Flexible(
          child: Text(
            label,
            style: const TextStyle(
              color: AlokasColors.creamIvory,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    );
  }
}

class _EventDetailRegistrationSheet extends StatefulWidget {
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
  final ValueChanged<String> onAllSubmitted;

  const _EventDetailRegistrationSheet({
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
    required this.onAllSubmitted,
  });

  @override
  State<_EventDetailRegistrationSheet> createState() =>
      _EventDetailRegistrationSheetState();
}

class _EventDetailRegistrationSheetState
    extends State<_EventDetailRegistrationSheet> {
  EventDetail? _detail;
  bool _detailLoading = true;
  String? _detailError;

  final Set<String> _selectedProfileIds = <String>{};
  final Map<String, String?> _categoryByProfile = <String, String?>{};

  /// Players already accepted by the server, from this sheet or earlier. They
  /// are not offered again, so a retry cannot create a duplicate.
  final Map<String, RegistrationRecord> _alreadySubmitted = {};

  ReceiptFile? _receipt;
  String? _receiptError;
  bool _submitting = false;
  List<RegistrationAttempt> _attempts = const [];

  @override
  void initState() {
    super.initState();
    for (final record in widget.existingRegistrations) {
      final profileId = record.playerProfileId;
      if (profileId != null && record.isActive) {
        _alreadySubmitted[profileId] = record;
      }
    }
    _loadDetail();
  }

  Future<void> _loadDetail() async {
    final result = await widget.loadDetail();
    if (!mounted) return;
    setState(() {
      _detailLoading = false;
      switch (result) {
        case ApiSuccess(:final value):
          _detail = value;
          _detailError = null;
          _prepareSelections(value);
        case ApiFailure(:final message):
          _detailError = message;
      }
    });
  }

  void _prepareSelections(EventDetail detail) {
    for (final profile in widget.profiles) {
      _categoryByProfile[profile.id] = profile
          .suggestCategory(detail.event.categories)
          ?.id;
    }
    final available = widget.profiles.where(
      (p) => !_alreadySubmitted.containsKey(p.id),
    );
    if (available.isNotEmpty) _selectedProfileIds.add(available.first.id);
  }

  void _retryDetail() {
    setState(() {
      _detailLoading = true;
      _detailError = null;
    });
    _loadDetail();
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
  }

  Future<void> _submit(MobileEventItem event) async {
    final selections = widget.profiles
        .where((p) => _selectedProfileIds.contains(p.id))
        .map(
          (p) => RegistrationSelection(
            profile: p,
            categoryId: _categoryByProfile[p.id],
          ),
        )
        .toList();
    setState(() {
      _submitting = true;
      _attempts = const [];
    });
    final attempts = await widget.onSubmit(selections, _receipt);
    if (!mounted) return;

    final accepted = <String>[];
    for (final attempt in attempts) {
      if (attempt.result case ApiSuccess(:final value)) {
        _alreadySubmitted[attempt.profile.id] = value;
        _selectedProfileIds.remove(attempt.profile.id);
        final payment = value.paymentLabel;
        accepted.add(
          payment == null
              ? '${attempt.profile.fullName}: ${value.statusLabel}'
              : '${attempt.profile.fullName}: ${value.statusLabel}. $payment',
        );
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
      widget.onAllSubmitted('Submitted. ${accepted.join(' • ')}');
      return;
    }
    setState(() {
      _submitting = false;
      _attempts = attempts;
    });
  }

  @override
  Widget build(BuildContext context) {
    final event = _detail?.event ?? widget.event;

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.86,
      minChildSize: 0.55,
      maxChildSize: 0.95,
      builder: (context, scrollController) {
        return SingleChildScrollView(
          controller: scrollController,
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 44,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AlokasColors.mutedSage.withValues(alpha: 0.4),
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              _buildEventHeader(event),
              const SizedBox(height: 16),
              ..._buildBody(event),
            ],
          ),
        );
      },
    );
  }

  Widget _buildEventHeader(MobileEventItem event) {
    final distanceKm = widget.distanceKm;
    final rounds = event.rounds;
    final style = event.style;
    final deadline = event.registrationDeadlineLabel;
    final rules = _detail?.rulesMd;
    final address = event.venueAddress ?? event.locationLabel;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            if (distanceKm != null)
              AlokasBadge(
                text:
                    '${distanceKm.toStringAsFixed(1)} km from ${widget.originCity}',
                color: AlokasColors.emeraldSuccess,
                icon: Icons.near_me,
              ),
            if (event.timeControl != null)
              AlokasBadge(
                text: event.timeControl!,
                color: AlokasColors.warmGold,
                icon: Icons.timer,
              ),
            if (rounds != null)
              AlokasBadge(
                text: style == null
                    ? '$rounds Rounds'
                    : '$rounds Rounds (${style.toUpperCase()})',
                color: AlokasColors.skyInfo,
              ),
          ],
        ),
        const SizedBox(height: 10),
        Text(
          event.displayName,
          style: const TextStyle(
            color: AlokasColors.creamIvory,
            fontSize: 19,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          [
            address ?? 'Venue not listed',
            formatDateForPeople(event.date) ?? 'Date not listed',
            event.organizationName ?? 'Organizer not listed',
          ].join(' • '),
          style: const TextStyle(color: AlokasColors.mutedSage, fontSize: 13),
        ),
        if (deadline != null) ...[
          const SizedBox(height: 4),
          Text(
            'Registration deadline: $deadline',
            style: const TextStyle(color: AlokasColors.mutedSage, fontSize: 12),
          ),
        ],
        if (event.descriptionMd != null) ...[
          const SizedBox(height: 12),
          Text(
            event.descriptionMd!,
            style: const TextStyle(
              color: AlokasColors.creamIvory,
              fontSize: 13.5,
              height: 1.4,
            ),
          ),
        ],
        if (rules != null) ...[
          const SizedBox(height: 12),
          Text(
            rules,
            style: const TextStyle(
              color: AlokasColors.creamIvory,
              fontSize: 13,
              height: 1.4,
            ),
          ),
        ],
      ],
    );
  }

  List<Widget> _buildBody(MobileEventItem event) {
    if (_detailLoading) {
      return const [
        Padding(
          padding: EdgeInsets.all(24),
          child: Center(
            child: CircularProgressIndicator(color: AlokasColors.warmGold),
          ),
        ),
      ];
    }
    final detail = _detail;
    if (detail == null) {
      return [
        MessageCard(
          icon: Icons.cloud_off,
          accent: AlokasColors.crimsonDanger,
          title: 'Could not load this event\'s details',
          message: _detailError,
          actionLabel: 'Retry',
          onAction: _retryDetail,
        ),
      ];
    }

    // Nothing here should invite a payment or an entry the server would refuse.
    final closed = event.closedReason(DateTime.now());
    if (closed != null) {
      final existing = _alreadySubmitted.values
          .map((r) => '${r.playerName ?? 'Player'}: ${r.statusLabel}')
          .join(' • ');
      return [
        MessageCard(
          key: const Key('event-closed-card'),
          icon: Icons.event_busy,
          title: closed,
          message: existing.isEmpty ? null : existing,
        ),
      ];
    }

    return [
      if (event.isPaid) ...[
        _buildPaymentInfo(event, detail),
        const SizedBox(height: 14),
      ],
      ..._buildRegistrationArea(event, detail),
    ];
  }

  Widget _buildPaymentInfo(MobileEventItem event, EventDetail detail) {
    final instructions = detail.paymentInstructions;
    final qr = _QrImage.tryBuild(detail.paymentQrUrl);
    final players = _selectedProfileIds.isEmpty
        ? 1
        : _selectedProfileIds.length;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AlokasColors.forestCard,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AlokasColors.warmGold),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            players == 1
                ? 'PAYMENT: ${event.feeLabel()}'
                : 'PAYMENT: ${event.feeLabel(players: players)} FOR $players PLAYERS',
            style: const TextStyle(
              color: AlokasColors.brightGold,
              fontWeight: FontWeight.w800,
              fontSize: 12.5,
            ),
          ),
          const SizedBox(height: 6),
          if (instructions != null)
            Text(
              instructions,
              key: const Key('payment-instructions'),
              style: const TextStyle(
                color: AlokasColors.creamIvory,
                fontSize: 12.5,
              ),
            ),
          if (qr != null) ...[const SizedBox(height: 8), Center(child: qr)],
          if (instructions == null && qr == null)
            const Text(
              'The organizer has not published payment instructions. Please contact the organizer before paying.',
              key: Key('payment-contact-organizer'),
              style: TextStyle(
                color: AlokasColors.amberWarning,
                fontSize: 12.5,
              ),
            ),
        ],
      ),
    );
  }

  List<Widget> _buildRegistrationArea(
    MobileEventItem event,
    EventDetail detail,
  ) {
    if (!widget.isSignedIn) {
      return [
        MessageCard(
          icon: Icons.login,
          title: 'Sign in to register',
          message: 'Registering a player uses a saved profile on your account.',
          actionLabel: 'Go to Sign In',
          onAction: widget.onGoToAccount,
        ),
      ];
    }
    if (widget.profilesUnavailable != null) {
      return [
        MessageCard(
          icon: Icons.cloud_off,
          title: 'Your player profiles are not available',
          message: widget.profilesUnavailable,
        ),
      ];
    }
    if (widget.profiles.isEmpty) {
      return [
        MessageCard(
          icon: Icons.person_add_alt_1,
          title: 'Add a player profile first',
          message: 'Registration uses the details saved on a player profile.',
          actionLabel: 'Go to Profiles',
          onAction: widget.onGoToAccount,
        ),
      ];
    }

    final selectedProfiles = widget.profiles
        .where((p) => _selectedProfileIds.contains(p.id))
        .toList();
    final everyoneSubmitted = widget.profiles.every(
      (p) => _alreadySubmitted.containsKey(p.id),
    );

    return [
      const Text(
        'WHO IS PLAYING?',
        style: TextStyle(
          color: AlokasColors.warmGold,
          fontSize: 12,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.8,
        ),
      ),
      const SizedBox(height: 10),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: widget.profiles.map((prof) {
          final submitted = _alreadySubmitted[prof.id];
          final isSelected = _selectedProfileIds.contains(prof.id);
          return FilterChip(
            key: Key('select-profile-${prof.id}'),
            selected: isSelected,
            selectedColor: AlokasColors.warmGold,
            checkmarkColor: AlokasColors.deepForest,
            backgroundColor: AlokasColors.forestCard,
            label: Text(
              submitted == null
                  ? '${prof.fullName} (${prof.relationshipLabel})'
                  : '${prof.fullName} (${submitted.statusLabel})',
            ),
            labelStyle: TextStyle(
              color: isSelected
                  ? AlokasColors.deepForest
                  : AlokasColors.creamIvory,
              fontWeight: FontWeight.w700,
              fontSize: 12.5,
            ),
            onSelected: submitted != null
                ? null
                : (val) {
                    setState(() {
                      if (val) {
                        _selectedProfileIds.add(prof.id);
                      } else {
                        _selectedProfileIds.remove(prof.id);
                      }
                    });
                  },
          );
        }).toList(),
      ),
      const SizedBox(height: 12),
      ...selectedProfiles.map((prof) => _buildPlayerCard(prof, event)),
      if (detail.customQuestionCount > 0) ...[
        const Text(
          'This organizer asks extra questions the app cannot collect yet. They may contact you, or you can use the event\'s web form.',
          style: TextStyle(color: AlokasColors.amberWarning, fontSize: 12.5),
        ),
        const SizedBox(height: 12),
      ],
      if (event.isPaid) ...[_buildReceiptPicker(), const SizedBox(height: 12)],
      ..._attempts.map(_buildAttemptRow),
      if (event.isFull && selectedProfiles.isNotEmpty) ...[
        Text(
          selectedProfiles.length == 1
              ? 'This event is full (${event.registeredCount} of ${pluralize(event.maxParticipants!, 'place')}). ${selectedProfiles.single.fullName} will be waitlisted, not given a place.'
              : 'This event is full (${event.registeredCount} of ${pluralize(event.maxParticipants!, 'place')}). These ${selectedProfiles.length} players will be waitlisted, not given places.',
          key: const Key('event-full-warning'),
          style: const TextStyle(
            color: AlokasColors.amberWarning,
            fontSize: 12.5,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 10),
      ],
      const SizedBox(height: 4),
      if (everyoneSubmitted)
        const Text(
          'All your players have already submitted a registration for this event.',
          key: Key('all-players-submitted'),
          style: TextStyle(color: AlokasColors.mutedSage, fontSize: 12.5),
        )
      else
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            key: const Key('confirm-register-button'),
            onPressed: _submitting || selectedProfiles.isEmpty
                ? null
                : () => _submit(event),
            icon: const Icon(Icons.check_circle_outline),
            label: Text(
              _submitting
                  ? 'Submitting Registration...'
                  : '${event.isFull ? 'Join Waitlist' : 'Confirm Registration'} (${selectedProfiles.length} ${selectedProfiles.length == 1 ? "Player" : "Players"})',
            ),
          ),
        ),
    ];
  }

  Widget _buildPlayerCard(MobilePlayerProfile prof, MobileEventItem event) {
    final categories = event.categories;
    final born = prof.yearOfBirth;
    final rating = prof.bestRating;
    final details = [
      born == null ? 'Birth year not set' : 'Born $born (Age ${prof.age})',
      prof.fideId == null ? 'No FIDE ID' : 'FIDE ID: ${prof.fideId}',
      rating == null ? 'No FIDE rating' : 'Rating: $rating',
    ].join(' • ');
    final affiliation = prof.affiliationLabel;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AlokasColors.forestCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AlokasColors.goldBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            prof.fullName,
            style: const TextStyle(
              color: AlokasColors.creamIvory,
              fontWeight: FontWeight.w800,
              fontSize: 14.5,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            details,
            style: const TextStyle(color: AlokasColors.mutedSage, fontSize: 12),
          ),
          if (affiliation != null)
            Text(
              affiliation,
              style: const TextStyle(
                color: AlokasColors.mutedSage,
                fontSize: 12,
              ),
            ),
          const SizedBox(height: 8),
          if (categories.isEmpty)
            const Text(
              'This event lists no categories. The organizer will place the player.',
              style: TextStyle(color: AlokasColors.mutedSage, fontSize: 12),
            )
          else
            DropdownButtonFormField<String?>(
              key: Key('category-${prof.id}'),
              initialValue: _categoryByProfile[prof.id],
              isExpanded: true,
              dropdownColor: AlokasColors.forestSurface,
              style: const TextStyle(color: AlokasColors.creamIvory),
              decoration: const InputDecoration(
                labelText: 'Category (suggested from age; please check)',
              ),
              items: [
                const DropdownMenuItem<String?>(
                  value: null,
                  child: Text('Let the organizer decide'),
                ),
                ...categories.map(
                  (c) => DropdownMenuItem<String?>(
                    value: c.id,
                    child: Text(c.name, overflow: TextOverflow.ellipsis),
                  ),
                ),
              ],
              onChanged: (value) =>
                  setState(() => _categoryByProfile[prof.id] = value),
            ),
        ],
      ),
    );
  }

  Widget _buildReceiptPicker() {
    final receipt = _receipt;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AlokasColors.forestCard,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AlokasColors.goldBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Payment Receipt',
            style: TextStyle(
              color: AlokasColors.creamIvory,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          if (receipt != null)
            Text(
              _selectedProfileIds.length > 1
                  ? 'Attaching ${receipt.name} to each selected player.'
                  : 'Attaching ${receipt.name}.',
              key: const Key('receipt-chosen'),
              style: const TextStyle(
                color: AlokasColors.mutedSage,
                fontSize: 12,
              ),
            )
          else
            const Text(
              'No receipt chosen. The registration will be pending until a receipt is provided. The app cannot add one later, so you would need to send it to the organizer.',
              key: Key('receipt-pending-note'),
              style: TextStyle(color: AlokasColors.amberWarning, fontSize: 12),
            ),
          if (_receiptError != null) ...[
            const SizedBox(height: 4),
            Text(
              _receiptError!,
              key: const Key('receipt-error'),
              style: const TextStyle(
                color: AlokasColors.crimsonDanger,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
          const SizedBox(height: 8),
          Row(
            children: [
              OutlinedButton.icon(
                key: const Key('choose-receipt-button'),
                onPressed: _chooseReceipt,
                icon: const Icon(Icons.attach_file, size: 16),
                label: Text(receipt == null ? 'Choose File' : 'Change File'),
              ),
              if (receipt != null)
                TextButton(
                  onPressed: () => setState(() => _receipt = null),
                  child: const Text('Remove'),
                ),
            ],
          ),
          const Text(
            'PNG, JPEG, WebP or PDF, up to 5 MB.',
            style: TextStyle(color: AlokasColors.mutedSage, fontSize: 11),
          ),
        ],
      ),
    );
  }

  Widget _buildAttemptRow(RegistrationAttempt attempt) {
    final result = attempt.result;
    final String text;
    final Color color;
    switch (result) {
      case ApiFailure(:final message):
        text = '${attempt.profile.fullName}: NOT registered. $message';
        color = AlokasColors.crimsonDanger;
      case ApiSuccess(:final value):
        text = value.hasReceipt == false && _receipt != null
            ? '${attempt.profile.fullName}: ${value.statusLabel}, but the server did not record the receipt.'
            : value.paymentLabel == null
            ? '${attempt.profile.fullName}: ${value.statusLabel}'
            : '${attempt.profile.fullName}: ${value.statusLabel}. ${value.paymentLabel}';
        color = AlokasColors.amberWarning;
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: TextStyle(
          color: color,
          fontSize: 12.5,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

/// Shows an organizer's payment QR when the API gave an image the app can
/// display directly. A private storage path cannot be shown, so it is skipped.
class _QrImage {
  static Widget? tryBuild(String? source) {
    if (source == null) return null;
    Widget error(BuildContext _, Object _, StackTrace? _) => const Text(
      'The payment QR image could not be loaded.',
      style: TextStyle(color: AlokasColors.amberWarning, fontSize: 12),
    );
    if (source.startsWith('https://')) {
      return Image.network(source, height: 180, errorBuilder: error);
    }
    if (source.startsWith('data:image/')) {
      final data = Uri.tryParse(source)?.data;
      if (data == null) return null;
      return Image.memory(
        data.contentAsBytes(),
        height: 180,
        errorBuilder: error,
      );
    }
    return null;
  }
}
