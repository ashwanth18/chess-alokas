import 'package:flutter/material.dart';

import '../models/draft.dart';
import '../models/models.dart';
import '../services/alokas_api.dart';
import '../services/device_location.dart';
import '../services/file_gateway.dart';
import '../services/local_store.dart';
import '../theme/alokas_theme.dart';
import '../widgets/message_card.dart';
import 'event_screen.dart';
import 'register_screen.dart';

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
  final DeviceLocator locateDevice;
  final SettingsOpener openSettings;
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

  /// Unfinished registrations on this phone, newest first.
  final List<RegistrationDraft> drafts;
  final DraftStore draftStore;
  final String? accountKey;
  final VoidCallback onDraftsChanged;

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
    required this.locateDevice,
    required this.openSettings,
    required this.loadEventDetail,
    required this.onRegister,
    required this.onRefresh,
    required this.onGoToAccount,
    required this.receiptPicker,
    required this.drafts,
    required this.draftStore,
    required this.accountKey,
    required this.onDraftsChanged,
  });

  @override
  State<DiscoverScreen> createState() => _DiscoverScreenState();
}

class _DiscoverScreenState extends State<DiscoverScreen> {
  double? _selectedRadiusKm; // null = no distance limit
  String _selectedCategoryCode = 'All';
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();
  bool _locating = false;
  DeviceLocationProblem? _locationProblem;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  double? _distanceTo(MobileEventItem event) => event.distanceFrom(
    widget.selectedLocation.latitude,
    widget.selectedLocation.longitude,
  );

  Future<void> _useDeviceLocation() async {
    setState(() {
      _locating = true;
      _locationProblem = null;
    });
    final result = await widget.locateDevice();
    if (!mounted) return;
    setState(() {
      _locating = false;
      switch (result) {
        case DeviceLocationFound(:final latitude, :final longitude):
          widget.onLocationChanged(LocationPreset.device(latitude, longitude));
        case DeviceLocationProblem():
          _locationProblem = result;
      }
    });
  }

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

  void _openEvent(MobileEventItem event) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => EventScreen(
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
          onGoToAccount: widget.onGoToAccount,
          draft: widget.drafts.where((d) => d.eventId == event.id).firstOrNull,
          draftStore: widget.draftStore,
          accountKey: widget.accountKey,
          onDraftsChanged: widget.onDraftsChanged,
        ),
      ),
    );
  }

  /// Back to the exact step, even with no signal: the draft holds the event
  /// detail as the API last gave it.
  void _resumeDraft(RegistrationDraft draft) {
    final saved = draft.detailJson;
    final detail = saved == null ? null : EventDetail.tryFromJson(saved);
    if (detail == null) {
      final event = widget.events.where((e) => e.id == draft.eventId);
      if (event.isNotEmpty) _openEvent(event.first);
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => RegisterScreen(
          detail: detail,
          profiles: widget.profiles,
          existingRegistrations:
              widget.registrationsByEvent[draft.eventId] ?? const [],
          receiptPicker: widget.receiptPicker,
          onSubmit: (selections, receipt) =>
              widget.onRegister(detail.event, selections, receipt),
          draft: draft,
          draftStore: widget.draftStore,
          accountKey: widget.accountKey,
          onDraftsChanged: widget.onDraftsChanged,
          reloadDetail: () => widget.loadEventDetail(draft.slugOrId),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    final events = _filteredEvents;
    final countKnown =
        widget.events.isNotEmpty ||
        (!widget.eventsLoading && widget.eventsError == null);
    return RefreshIndicator(
      onRefresh: widget.onRefresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: [
          for (final draft in widget.drafts)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _DraftBanner(
                draft: draft,
                onTap: () => _resumeDraft(draft),
              ),
            ),
          _buildLocation(),
          const SizedBox(height: 12),
          TextField(
            controller: _searchController,
            onChanged: (v) => setState(() => _searchQuery = v),
            decoration: InputDecoration(
              hintText: 'Search tournament, city, venue',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _searchQuery.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear),
                      tooltip: 'Clear search',
                      onPressed: () {
                        _searchController.clear();
                        setState(() => _searchQuery = '');
                      },
                    )
                  : null,
            ),
          ),
          const SizedBox(height: 12),
          _buildRadiusFilter(),
          _buildCategoryFilter(),
          const SizedBox(height: 16),
          SheetHeading(
            countKnown ? 'Tournaments (${events.length})' : 'Tournaments',
          ),
          Padding(
            padding: const EdgeInsets.only(top: 4, bottom: 8),
            child: Text(
              'By distance from ${widget.selectedLocation.city}',
              style: atype(14, color: p.ink2),
            ),
          ),
          ..._buildEventList(events),
        ],
      ),
    );
  }

  List<Widget> _buildEventList(List<MobileEventItem> events) {
    if (widget.eventsLoading && widget.events.isEmpty) {
      return const [LoadingLine()];
    }
    final error = widget.eventsError;
    if (error != null && widget.events.isEmpty) {
      return [
        MessageCard(
          isProblem: true,
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
    return [...notice, ...events.map(_buildEventRow)];
  }

  Widget _buildLocation() {
    final p = context.pal;
    final selected = widget.selectedLocation;
    final usingDevice = selected.id == LocationPreset.deviceId;
    final problem = _locationProblem;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: DropdownButtonFormField<String>(
                key: const Key('city-picker'),
                initialValue: selected.id,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Search near'),
                items: [
                  if (usingDevice)
                    const DropdownMenuItem(
                      value: LocationPreset.deviceId,
                      child: Text('Near: your location'),
                    ),
                  ...locationPresets.map(
                    (preset) => DropdownMenuItem<String>(
                      value: preset.id,
                      child: Text(preset.label),
                    ),
                  ),
                ],
                onChanged: (id) {
                  if (id == null || id == LocationPreset.deviceId) return;
                  widget.onLocationChanged(
                    locationPresets.firstWhere((p) => p.id == id),
                  );
                },
              ),
            ),
            const SizedBox(width: 8),
            Tooltip(
              message: usingDevice ? 'Update my location' : 'Use my location',
              child: OutlinedButton(
                key: const Key('use-my-location'),
                onPressed: _locating ? null : _useDeviceLocation,
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(56, 56),
                  padding: EdgeInsets.zero,
                ),
                child: Icon(
                  usingDevice ? Icons.my_location : Icons.location_searching,
                  semanticLabel: _locating
                      ? 'Finding your location'
                      : usingDevice
                      ? 'Update my location'
                      : 'Use my location',
                ),
              ),
            ),
          ],
        ),
        if (problem != null) ...[
          const SizedBox(height: 8),
          Text(
            problem.message,
            key: const Key('location-problem'),
            style: atype(14, weight: 600, color: p.wait, height: 1.3),
          ),
          if (problem.canOpenSettings)
            TextButton(
              onPressed: widget.openSettings,
              child: const Text('Open app settings'),
            ),
        ],
      ],
    );
  }

  Widget _buildRadiusFilter() {
    const options = <(String, double?)>[
      ('10 km', 10.0),
      ('25 km', 25.0),
      ('50 km', 50.0),
      ('Any distance', null),
    ];
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final (label, radius) in options)
          ChoiceBox.text(
            label: label,
            selected: _selectedRadiusKm == radius,
            onTap: () => setState(() => _selectedRadiusKm = radius),
          ),
      ],
    );
  }

  /// Options come from the categories the loaded events really have.
  Widget _buildCategoryFilter() {
    final codes = <String>{
      for (final event in widget.events)
        for (final category in event.categories) category.code,
    }.toList()..sort();
    if (codes.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final code in ['All', ...codes])
            ChoiceBox.text(
              label: code == 'All' ? 'All sections' : code,
              selected: _selectedCategoryCode == code,
              onTap: () => setState(() => _selectedCategoryCode = code),
            ),
        ],
      ),
    );
  }

  Widget _buildEventRow(MobileEventItem evt) {
    final p = context.pal;
    final distKm = _distanceTo(evt);
    final records = widget.registrationsByEvent[evt.id] ?? const [];
    final count = evt.registeredCount;
    final max = evt.maxParticipants;
    final closed = evt.closedReason(DateTime.now());
    final deadline = evt.registrationDeadlineLabel;

    final facts = [
      formatDateForPeople(evt.date) ?? 'Date not listed',
      ?evt.timeControl,
      if (count != null)
        max != null ? '$count/$max players' : pluralize(count, 'player'),
      evt.feeLabel(),
    ];

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: BrandCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (distKm != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: AlokasBadge(
                  text:
                      '${distKm.toStringAsFixed(1)} km from ${widget.selectedLocation.city}',
                  tone: ChipTone.go,
                  icon: Icons.near_me,
                ),
              ),
            Text(
              evt.displayName,
              style: atype(20, weight: 800, color: p.ink, height: 1.2),
            ),
            const SizedBox(height: 4),
            if (evt.organizationName != null)
              Text(
                evt.organizationName!,
                style: atype(16, weight: 600, color: p.accent),
              ),
            Text(
              evt.locationLabel ?? 'Venue not listed',
              style: atype(14, color: p.ink2, height: 1.3),
            ),
            const SizedBox(height: 4),
            Text(
              facts.join(' · '),
              style: atype(14, weight: 600, color: p.ink, tabular: true),
            ),
            if (evt.categories.isNotEmpty)
              Text(
                evt.categories.map((c) => c.name).join(' · '),
                style: atype(14, color: p.ink2),
              ),
            const SizedBox(height: 8),
            if (closed != null)
              AlokasBadge(
                key: const Key('event-closed-badge'),
                text: closed,
                tone: ChipTone.wait,
              )
            else if (evt.isFull)
              const AlokasBadge(
                text: 'Full: new entries are waitlisted',
                tone: ChipTone.wait,
              )
            else if (deadline != null)
              Text('Register by $deadline', style: atype(14, color: p.ink2)),
            for (final record in records)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: AlokasBadge(
                  text: _recordBadgeText(record),
                  tone: record.isWaitlisted || !record.isActive
                      ? ChipTone.wait
                      : ChipTone.pen,
                ),
              ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => _openEvent(evt),
                child: Text(
                  closed != null
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
}

class _DraftBanner extends StatelessWidget {
  final RegistrationDraft draft;
  final VoidCallback onTap;

  const _DraftBanner({required this.draft, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    return Container(
      key: Key('draft-${draft.eventId}'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: p.waitWash,
        borderRadius: BorderRadius.circular(AlokasTheme.radius),
        border: Border.all(color: p.wait),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              StatusSquare(color: p.wait, hollow: true),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Not sent yet, saved on this phone',
                  style: atype(14, weight: 600, color: p.wait),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            draft.eventName,
            style: atype(16, weight: 700, color: p.ink, height: 1.25),
          ),
          const SizedBox(height: 8),
          ElevatedButton(
            key: const Key('resume-draft'),
            onPressed: onTap,
            child: const Text('Continue registration'),
          ),
        ],
      ),
    );
  }
}
