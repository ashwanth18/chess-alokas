import 'dart:async';

import 'package:flutter/material.dart';

import '../models/draft.dart';
import '../models/models.dart';
import '../services/alokas_api.dart';
import '../services/device_location.dart';
import '../services/file_gateway.dart';
import '../services/local_store.dart';
import '../services/map_style.dart';
import '../services/place_search.dart';
import '../theme/alokas_theme.dart';
import '../widgets/event_facts.dart';
import '../widgets/message_card.dart';
import 'event_screen.dart';
import 'events_map.dart';
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
  final NearMeController nearMe;
  final SettingsOpener openSettings;
  final SettingsOpener openDeviceLocationSettings;
  final SettingsOpener requestPreciseLocation;
  final MapStyleLoader loadMapStyle;
  final MapSurfaceBuilder mapSurfaceBuilder;
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
    required this.nearMe,
    required this.openSettings,
    required this.openDeviceLocationSettings,
    required this.requestPreciseLocation,
    required this.loadMapStyle,
    required this.mapSurfaceBuilder,
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
  String _selectedCategoryCode = 'All';
  String _searchQuery = '';

  /// Chosen from the dropdown. Null while the user is only typing.
  Place? _chosenPlace;
  bool _showMap = false;
  bool _mapFailed = false;
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocus = FocusNode();

  /// Keeps "Updated 5 min ago" true while the screen stays open.
  Timer? _freshnessTimer;

  @override
  void initState() {
    super.initState();
    widget.nearMe.addListener(_rebuild);
    _freshnessTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (widget.nearMe.fix != null) _rebuild();
    });
  }

  @override
  void dispose() {
    _freshnessTimer?.cancel();
    widget.nearMe.removeListener(_rebuild);
    _searchController.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  void _rebuild() {
    if (mounted) setState(() {});
  }

  NearMeController get _nearMe => widget.nearMe;

  void _clearSearch() {
    _searchController.clear();
    setState(() {
      _searchQuery = '';
      _chosenPlace = null;
    });
  }

  void _chooseSuggestion(SearchSuggestion suggestion) {
    _searchFocus.unfocus();
    setState(() {
      _searchQuery = suggestion.title;
      _chosenPlace = suggestion.place;
    });
  }

  List<MobileEventItem> get _filteredEvents {
    final places = placesFor(widget.events);
    final place = _chosenPlace;
    final filtered = widget.events.where((event) {
      if (_selectedCategoryCode != 'All' &&
          !event.categories.any((c) => c.code == _selectedCategoryCode)) {
        return false;
      }
      return place != null
          ? place.matchesEvent(event)
          : eventMatchesQuery(event, _searchQuery, places);
    }).toList();

    if (_nearMe.fix != null) {
      filtered.sort((a, b) {
        final da = _nearMe.distanceTo(a);
        final db = _nearMe.distanceTo(b);
        if (da == null && db == null) return 0;
        if (da == null) return 1;
        if (db == null) return -1;
        return da.compareTo(db);
      });
    } else {
      filtered.sort(_soonestFirst);
    }
    return filtered;
  }

  /// Upcoming events by date, then undated ones, then past ones, latest first.
  int _soonestFirst(MobileEventItem a, MobileEventItem b) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final da = a.date == null ? null : DateTime.tryParse(a.date!);
    final db = b.date == null ? null : DateTime.tryParse(b.date!);
    int group(DateTime? d) => d == null ? 1 : (d.isBefore(today) ? 2 : 0);
    final byGroup = group(da).compareTo(group(db));
    if (byGroup != 0 || da == null || db == null) return byGroup;
    return group(da) == 2 ? db.compareTo(da) : da.compareTo(db);
  }

  void _openEvent(MobileEventItem event) {
    // Otherwise focus returns on the way back and reopens the dropdown over the
    // controls.
    _searchFocus.unfocus();
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => EventScreen(
          event: event,
          isSignedIn: widget.isSignedIn,
          profiles: widget.profiles,
          profilesUnavailable: widget.profilesUnavailable,
          existingRegistrations:
              widget.registrationsByEvent[event.id] ?? const [],
          distanceLabel: _nearMe.distanceLabel(event),
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
    final events = _filteredEvents;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _buildSearch(),
              const SizedBox(height: 8),
              _NearMeStrip(
                nearMe: _nearMe,
                openSettings: widget.openSettings,
                openDeviceLocationSettings: widget.openDeviceLocationSettings,
                requestPrecise: () async {
                  await widget.requestPreciseLocation();
                  await _nearMe.refresh(prompt: false);
                },
              ),
              const SizedBox(height: 8),
              _buildViewAndFilters(),
            ],
          ),
        ),
        Expanded(child: _showMap ? _buildMap(events) : _buildList(events)),
      ],
    );
  }

  Widget _buildMap(List<MobileEventItem> events) => EventsMapView(
    events: events,
    nearMe: _nearMe,
    sunlight: Theme.of(context).brightness == Brightness.light,
    loadStyle: widget.loadMapStyle,
    surfaceBuilder: widget.mapSurfaceBuilder,
    onOpenEvent: _openEvent,
    onUnavailable: () => setState(() {
      _showMap = false;
      _mapFailed = true;
    }),
  );

  Widget _buildList(List<MobileEventItem> events) {
    final p = context.pal;
    final countKnown =
        widget.events.isNotEmpty ||
        (!widget.eventsLoading && widget.eventsError == null);
    return RefreshIndicator(
      onRefresh: widget.onRefresh,
      child: ListView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
        children: [
          for (final draft in widget.drafts)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _DraftBanner(
                draft: draft,
                onTap: () => _resumeDraft(draft),
              ),
            ),
          if (_mapFailed)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                'Map not available right now',
                key: const Key('map-unavailable'),
                style: atype(14, weight: 600, color: p.wait),
              ),
            ),
          SheetHeading(
            countKnown ? 'Tournaments (${events.length})' : 'Tournaments',
            trailing: Text(
              _nearMe.fix != null ? 'Nearest first' : 'Soonest first',
              style: atype(14, color: p.ink2),
            ),
          ),
          const SizedBox(height: 4),
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
          title: 'No matches',
          actionLabel: 'Clear filters',
          onAction: () {
            _clearSearch();
            setState(() => _selectedCategoryCode = 'All');
          },
        ),
      ];
    }
    return [...notice, ...events.map(_buildEventRow)];
  }

  Widget _buildSearch() {
    final p = context.pal;
    return RawAutocomplete<SearchSuggestion>(
      textEditingController: _searchController,
      focusNode: _searchFocus,
      displayStringForOption: (option) => option.title,
      optionsBuilder: (value) {
        // Once chosen, the text is the choice: don't offer it again.
        if (_chosenPlace != null && value.text == _chosenPlace!.name) {
          return const [];
        }
        return suggestionsFor(value.text, widget.events);
      },
      onSelected: _chooseSuggestion,
      fieldViewBuilder: (context, controller, focusNode, onSubmitted) {
        return TextField(
          key: const Key('event-search'),
          controller: controller,
          focusNode: focusNode,
          textInputAction: TextInputAction.search,
          onTapOutside: (_) => focusNode.unfocus(),
          onChanged: (text) => setState(() {
            _searchQuery = text;
            if (_chosenPlace?.name != text) _chosenPlace = null;
          }),
          decoration: InputDecoration(
            hintText: 'Tournament, city or venue',
            prefixIcon: const Icon(Icons.search),
            suffixIcon: _searchQuery.isNotEmpty
                ? IconButton(
                    icon: const Icon(Icons.clear),
                    tooltip: 'Clear search',
                    onPressed: _clearSearch,
                  )
                : null,
          ),
        );
      },
      optionsViewBuilder: (context, onSelected, options) {
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            key: const Key('search-suggestions'),
            color: p.paper2,
            elevation: 6,
            borderRadius: BorderRadius.circular(AlokasTheme.radius),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 320),
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.symmetric(vertical: 4),
                children: [
                  for (final option in options)
                    _suggestionRow(option, onSelected),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _suggestionRow(
    SearchSuggestion option,
    AutocompleteOnSelected<SearchSuggestion> onSelected,
  ) {
    final p = context.pal;
    final place = option.place;
    return InkWell(
      onTap: () => onSelected(option),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: AlokasTheme.minTarget),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          child: Row(
            children: [
              Icon(
                place != null
                    ? Icons.place_outlined
                    : Icons.emoji_events_outlined,
                size: 20,
                color: p.accent,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  option.title,
                  style: atype(16, weight: 600, color: p.ink, height: 1.25),
                ),
              ),
              if (place != null) ...[
                const SizedBox(width: 8),
                Text(
                  pluralize(option.eventCount, 'event'),
                  style: atype(13, color: p.ink2, tabular: true),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  /// List or Map, then the sections the loaded events really have.
  Widget _buildViewAndFilters() {
    final codes = <String>{
      for (final event in widget.events)
        for (final category in event.categories) category.code,
    }.toList()..sort();
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          SegmentedButton<bool>(
            key: const Key('list-map-switch'),
            showSelectedIcon: false,
            style: const ButtonStyle(
              minimumSize: WidgetStatePropertyAll(
                Size(0, AlokasTheme.minTarget),
              ),
            ),
            segments: const [
              ButtonSegment(
                value: false,
                label: Text('List'),
                icon: Icon(Icons.view_list),
              ),
              ButtonSegment(
                value: true,
                label: Text('Map'),
                icon: Icon(Icons.map_outlined),
              ),
            ],
            selected: {_showMap},
            onSelectionChanged: (selection) => setState(() {
              _showMap = selection.first;
              if (_showMap) _mapFailed = false;
            }),
          ),
          if (codes.isNotEmpty)
            for (final code in ['All', ...codes])
              Padding(
                padding: const EdgeInsets.only(left: 8),
                child: ChoiceBox.text(
                  label: code == 'All' ? 'All sections' : code,
                  selected: _selectedCategoryCode == code,
                  onTap: () => setState(() => _selectedCategoryCode = code),
                ),
              ),
        ],
      ),
    );
  }

  Widget _buildEventRow(MobileEventItem evt) {
    final p = context.pal;
    final distance = _nearMe.distanceLabel(evt);
    final records = widget.registrationsByEvent[evt.id] ?? const [];
    final now = DateTime.now();
    final closed = evt.closedReason(now);
    final deadline = evt.deadlineAt(now);
    final when = [
      formatDateForPeople(evt.date) ?? 'Date not listed',
      ?evt.timeControl,
    ].join(' · ');

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: BrandCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (distance != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: AlokasBadge(
                  text: distance,
                  tone: ChipTone.go,
                  icon: Icons.near_me,
                ),
              ),
            Text(
              evt.displayName,
              style: atype(20, weight: 800, color: p.ink, height: 1.2),
            ),
            if (evt.organizationName != null)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  evt.organizationName!,
                  style: atype(14, weight: 600, color: p.accent),
                ),
              ),
            const SizedBox(height: 8),
            EventFact(icon: Icons.event, text: when),
            const SizedBox(height: 4),
            EventFact(
              icon: Icons.place_outlined,
              text: evt.locationLabel ?? 'Venue not listed',
            ),
            const SizedBox(height: 4),
            EntryAndPlayers(event: evt),
            if (evt.categories.isNotEmpty) ...[
              const SizedBox(height: 4),
              EventFact(
                icon: Icons.category_outlined,
                text: evt.categories.map((c) => c.name).join(' · '),
              ),
            ],
            if (deadline != null) ...[
              const SizedBox(height: 10),
              DeadlineBanner(deadline: deadline),
            ],
            if (closed == null && evt.isFull) ...[
              const SizedBox(height: 8),
              const AlokasBadge(
                text: 'Full · waitlist open',
                tone: ChipTone.wait,
              ),
            ],
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
                      ? 'View details'
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

/// The one Near me control, and the proof of what it found. A green dot and a
/// place name appear only with a real fix from this phone; otherwise it says
/// Location off, and no distance appears anywhere.
class _NearMeStrip extends StatelessWidget {
  final NearMeController nearMe;
  final SettingsOpener openSettings;
  final SettingsOpener openDeviceLocationSettings;
  final Future<void> Function() requestPrecise;

  const _NearMeStrip({
    required this.nearMe,
    required this.openSettings,
    required this.openDeviceLocationSettings,
    required this.requestPrecise,
  });

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    final fix = nearMe.fix;
    final located = fix != null;
    return Container(
      key: const Key('near-me-strip'),
      padding: const EdgeInsets.only(left: 12, right: 6),
      constraints: const BoxConstraints(minHeight: 52),
      decoration: BoxDecoration(
        color: located ? p.goWash : p.paper2,
        borderRadius: BorderRadius.circular(AlokasTheme.radius),
        border: Border.all(color: located ? p.go : p.rule),
      ),
      child: Row(
        children: [
          Expanded(child: _status(context)),
          const SizedBox(width: 6),
          Text('Near me', style: atype(13, weight: 600, color: p.ink2)),
          Switch(
            key: const Key('near-me-toggle'),
            value: nearMe.isOn,
            onChanged: (on) => on ? nearMe.turnOn() : nearMe.turnOff(),
          ),
        ],
      ),
    );
  }

  Widget _status(BuildContext context) {
    final p = context.pal;
    final fix = nearMe.fix;
    if (fix != null) return _located(context, fix);
    if (nearMe.isLocating) {
      return Row(
        children: [
          const SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              'Finding you',
              key: const Key('near-me-finding'),
              style: atype(14, weight: 600, color: p.ink),
            ),
          ),
        ],
      );
    }
    final problem = nearMe.problem;
    return Row(
      children: [
        Icon(Icons.location_disabled, size: 16, color: p.ink2),
        const SizedBox(width: 8),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Location off',
                key: const Key('near-me-off'),
                style: atype(14, weight: 700, color: p.ink),
              ),
              if (problem != null)
                Text(
                  problem.message,
                  key: const Key('location-problem'),
                  style: atype(13, color: p.wait, height: 1.2),
                ),
            ],
          ),
        ),
        if (problem != null)
          TextButton(
            key: const Key('near-me-fix'),
            onPressed: switch (problem.fix) {
              LocationProblemFix.retry ||
              LocationProblemFix.permission => nearMe.refresh,
              LocationProblemFix.appSettings => openSettings,
              LocationProblemFix.locationSettings => openDeviceLocationSettings,
            },
            child: Text(switch (problem.fix) {
              LocationProblemFix.retry => 'Retry',
              LocationProblemFix.permission => 'Allow',
              _ => 'Settings',
            }),
          ),
      ],
    );
  }

  Widget _located(BuildContext context, DeviceLocationFound fix) {
    final p = context.pal;
    final name = nearMe.placeName;
    final accuracy = fix.accuracyMeters;
    final details = [
      if (fix.isApproximate) 'Approximate',
      // Without a place name, the coordinates and accuracy are the proof.
      if (name == null && accuracy != null && !fix.isApproximate)
        '±${accuracy.round()} m',
      freshnessLabel(fix.fixedAt, DateTime.now()),
    ].join(' · ');
    final where =
        name ??
        '${fix.latitude.toStringAsFixed(2)}, ${fix.longitude.toStringAsFixed(2)}';
    return Row(
      children: [
        Expanded(
          child: Semantics(
            button: true,
            label: 'Update my location',
            child: InkWell(
              key: const Key('near-me-refresh'),
              onTap: nearMe.isLocating ? null : nearMe.refresh,
              child: Container(
                constraints: const BoxConstraints(
                  minHeight: AlokasTheme.minTarget,
                ),
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Container(
                      key: const Key('near-me-dot'),
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(
                        color: p.go,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'Near you · $where',
                            key: const Key('near-me-place'),
                            style: atype(
                              14,
                              weight: 700,
                              color: p.ink,
                              height: 1.2,
                            ),
                          ),
                          Text(
                            details,
                            style: atype(12, color: p.ink2, height: 1.2),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 4),
                    if (nearMe.isLocating)
                      const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    else
                      Icon(Icons.refresh, size: 16, color: p.ink2),
                  ],
                ),
              ),
            ),
          ),
        ),
        if (fix.isApproximate)
          TextButton(
            key: const Key('near-me-precise'),
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 6),
              minimumSize: const Size(48, AlokasTheme.minTarget),
              textStyle: atype(13, weight: 700),
            ),
            onPressed: requestPrecise,
            child: const Text('Precise'),
          ),
      ],
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
