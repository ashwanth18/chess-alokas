import 'package:flutter/material.dart';

import '../models/models.dart';
import '../services/alokas_api.dart';
import '../theme/alokas_theme.dart';

class DiscoverScreen extends StatefulWidget {
  final List<MobileEventItem> events;
  final List<MobilePlayerProfile> profiles;
  final GpsLocationPreset selectedLocation;
  final ValueChanged<GpsLocationPreset> onLocationChanged;
  final Future<void> Function(
    MobileEventItem event,
    List<MobilePlayerProfile> selectedProfiles,
    bool attachReceipt,
  ) onRegisterProfiles;
  final Future<void> Function() onRefresh;

  const DiscoverScreen({
    super.key,
    required this.events,
    required this.profiles,
    required this.selectedLocation,
    required this.onLocationChanged,
    required this.onRegisterProfiles,
    required this.onRefresh,
  });

  @override
  State<DiscoverScreen> createState() => _DiscoverScreenState();
}

class _DiscoverScreenState extends State<DiscoverScreen> {
  double? _selectedRadiusKm; // null = 'All'
  String _selectedCategoryCode = 'All';
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<MobileEventItem> get _filteredEvents {
    final lat = widget.selectedLocation.latitude;
    final lng = widget.selectedLocation.longitude;
    final q = _searchQuery.trim().toLowerCase();

    final filtered = widget.events.where((evt) {
      final dist = evt.distanceFrom(lat, lng);
      if (_selectedRadiusKm != null && dist > _selectedRadiusKm!) {
        return false;
      }
      if (_selectedCategoryCode != 'All') {
        final hasCat = evt.categories.any(
          (c) => c.code.toUpperCase() == _selectedCategoryCode.toUpperCase(),
        );
        if (!hasCat) return false;
      }
      if (q.isNotEmpty) {
        final hay =
            '${evt.name} ${evt.city} ${evt.state} ${evt.venueName} ${evt.organizationName}'
                .toLowerCase();
        if (!hay.contains(q)) return false;
      }
      return true;
    }).toList();

    filtered.sort(
      (a, b) => a
          .distanceFrom(lat, lng)
          .compareTo(b.distanceFrom(lat, lng)),
    );
    return filtered;
  }

  void _openRegistrationSheet(MobileEventItem event) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AlokasColors.forestSurface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => _EventDetailRegistrationSheet(
        event: event,
        profiles: widget.profiles,
        distanceKm: event.distanceFrom(
          widget.selectedLocation.latitude,
          widget.selectedLocation.longitude,
        ),
        onSubmit: (selectedProfiles, attachReceipt) async {
          await widget.onRegisterProfiles(
            event,
            selectedProfiles,
            attachReceipt,
          );
          if (ctx.mounted) {
            Navigator.of(ctx).pop();
          }
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                backgroundColor: AlokasColors.forestElevated,
                content: Text(
                  '1-Tap Registration submitted for ${selectedProfiles.map((p) => p.fullName).join(', ')}!',
                  style: const TextStyle(color: AlokasColors.creamIvory),
                ),
              ),
            );
          }
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final events = _filteredEvents;
    return RefreshIndicator(
      color: AlokasColors.warmGold,
      backgroundColor: AlokasColors.forestCard,
      onRefresh: widget.onRefresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
        children: [
          _buildGpsHeaderCard(),
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
                  'NEARBY TOURNAMENTS (${events.length})',
                  style: const TextStyle(
                    color: AlokasColors.warmGold,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.9,
                  ),
                ),
              ),
              Text(
                'Sorted by GPS distance',
                style: TextStyle(
                  color: AlokasColors.mutedSage.withValues(alpha: 0.85),
                  fontSize: 11.5,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (events.isEmpty)
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: AlokasColors.forestCard,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AlokasColors.goldBorder),
              ),
              child: Column(
                children: [
                  const Icon(
                    Icons.location_searching,
                    color: AlokasColors.warmGold,
                    size: 36,
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'No tournaments within this radius/filter.',
                    style: TextStyle(
                      color: AlokasColors.creamIvory,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 6),
                  TextButton(
                    onPressed: () {
                      setState(() {
                        _selectedRadiusKm = null;
                        _selectedCategoryCode = 'All';
                        _searchQuery = '';
                        _searchController.clear();
                      });
                    },
                    child: const Text('Reset Radius & Category Filters'),
                  ),
                ],
              ),
            )
          else
            ...events.map((evt) => Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: _buildEventCard(evt),
                )),
        ],
      ),
    );
  }

  Widget _buildGpsHeaderCard() {
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
              Icons.my_location,
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
                  'GPS DISCOVERY ORIGIN (HAVERSINE)',
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
                    items: AlokasApiClient.gpsPresets
                        .map(
                          (preset) => DropdownMenuItem<String>(
                            value: preset.id,
                            child: Text(
                              '${preset.label} (${preset.latitude.toStringAsFixed(2)}, ${preset.longitude.toStringAsFixed(2)})',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (id) {
                      if (id == null) return;
                      final found = AlokasApiClient.gpsPresets.firstWhere(
                        (p) => p.id == id,
                      );
                      widget.onLocationChanged(found);
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
      const MapEntry('All Malaysia', null),
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

  Widget _buildCategoryFilterRow() {
    const categories = ['All', 'U8', 'U12', 'U18', 'Open'];
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
                onSelected: (_) =>
                    setState(() => _selectedCategoryCode = cat),
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildEventCard(MobileEventItem evt) {
    final distKm = evt.distanceFrom(
      widget.selectedLocation.latitude,
      widget.selectedLocation.longitude,
    );

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
                AlokasBadge(
                  text: '${distKm.toStringAsFixed(1)} km away',
                  color: AlokasColors.emeraldSuccess,
                  icon: Icons.near_me,
                ),
                AlokasBadge(
                  text: evt.organizationName,
                  color: AlokasColors.warmGold,
                  icon: Icons.verified,
                ),
                if (evt.isRegistered)
                  AlokasBadge(
                    text:
                        'Registered (${evt.registeredProfileNames.join(', ')})',
                    color: AlokasColors.skyInfo,
                    icon: Icons.check_circle,
                  ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              evt.name,
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
                    '${evt.venueName} • ${evt.city}, ${evt.state}',
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
                _metaItem(Icons.calendar_today, evt.date),
                _metaItem(Icons.timer_outlined, evt.timeControl),
                _metaItem(
                  Icons.people_outline,
                  evt.maxParticipants != null
                      ? '${evt.registeredCount}/${evt.maxParticipants} players'
                      : '${evt.registeredCount} players',
                ),
                _metaItem(Icons.payments_outlined, evt.formattedFee),
              ],
            ),
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
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () => _openRegistrationSheet(evt),
                icon: Icon(
                  evt.isRegistered ? Icons.check_circle : Icons.bolt,
                  size: 18,
                ),
                label: Text(
                  evt.isRegistered
                      ? 'Registered • View Details or Add Family Member'
                      : 'View & 1-Tap Register',
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
        Text(
          label,
          style: const TextStyle(
            color: AlokasColors.creamIvory,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

class _EventDetailRegistrationSheet extends StatefulWidget {
  final MobileEventItem event;
  final List<MobilePlayerProfile> profiles;
  final double distanceKm;
  final Future<void> Function(
    List<MobilePlayerProfile> selectedProfiles,
    bool attachReceipt,
  ) onSubmit;

  const _EventDetailRegistrationSheet({
    required this.event,
    required this.profiles,
    required this.distanceKm,
    required this.onSubmit,
  });

  @override
  State<_EventDetailRegistrationSheet> createState() =>
      _EventDetailRegistrationSheetState();
}

class _EventDetailRegistrationSheetState
    extends State<_EventDetailRegistrationSheet> {
  late Set<String> _selectedProfileIds;
  bool _attachReceipt = true;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _selectedProfileIds = widget.profiles.isNotEmpty
        ? {widget.profiles.first.id}
        : <String>{};
  }

  @override
  Widget build(BuildContext context) {
    final selectedProfiles = widget.profiles
        .where((p) => _selectedProfileIds.contains(p.id))
        .toList();
    final totalFeeCents =
        widget.event.entryFeeCents * selectedProfiles.length;

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
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                AlokasBadge(
                  text: '${widget.distanceKm.toStringAsFixed(1)} km away',
                  color: AlokasColors.emeraldSuccess,
                  icon: Icons.near_me,
                ),
                AlokasBadge(
                  text: widget.event.timeControl,
                  color: AlokasColors.warmGold,
                  icon: Icons.timer,
                ),
                AlokasBadge(
                  text: '${widget.event.rounds} Rounds (${widget.event.style.toUpperCase()})',
                  color: AlokasColors.skyInfo,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              widget.event.name,
              style: const TextStyle(
                color: AlokasColors.creamIvory,
                fontSize: 19,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              widget.event.venueAddress,
              style: const TextStyle(
                color: AlokasColors.mutedSage,
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              widget.event.descriptionMd,
              style: const TextStyle(
                color: AlokasColors.creamIvory,
                fontSize: 13.5,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              '1-TAP FAMILY & PLAYER PROFILE AUTOFILL',
              style: TextStyle(
                color: AlokasColors.warmGold,
                fontSize: 12,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.8,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Select one or more family profiles below. Age, FIDE ID, Rating, School, and eligible Category are auto-matched:',
              style: TextStyle(color: AlokasColors.mutedSage, fontSize: 12.5),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: widget.profiles.map((prof) {
                final isSelected = _selectedProfileIds.contains(prof.id);
                final matchedCat =
                    prof.matchCategory(widget.event.categories);
                return FilterChip(
                  selected: isSelected,
                  selectedColor: AlokasColors.warmGold,
                  checkmarkColor: AlokasColors.deepForest,
                  backgroundColor: AlokasColors.forestCard,
                  label: Text(
                    '${prof.fullName} (${prof.relationshipLabel} • ${matchedCat.code})',
                  ),
                  labelStyle: TextStyle(
                    color: isSelected
                        ? AlokasColors.deepForest
                        : AlokasColors.creamIvory,
                    fontWeight: FontWeight.w700,
                    fontSize: 12.5,
                  ),
                  onSelected: (val) {
                    setState(() {
                      if (val) {
                        _selectedProfileIds.add(prof.id);
                      } else if (_selectedProfileIds.length > 1) {
                        _selectedProfileIds.remove(prof.id);
                      }
                    });
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 12),
            ...selectedProfiles.map((prof) {
              final matchedCat = prof.matchCategory(widget.event.categories);
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
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text(
                            prof.fullName,
                            style: const TextStyle(
                              color: AlokasColors.creamIvory,
                              fontWeight: FontWeight.w800,
                              fontSize: 14.5,
                            ),
                          ),
                        ),
                        AlokasBadge(
                          text: 'Auto-Matched: ${matchedCat.name}',
                          color: AlokasColors.emeraldSuccess,
                          icon: Icons.auto_awesome,
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'YOB ${prof.yearOfBirth} (Age ${prof.age}) • FIDE ID: ${prof.fideId ?? "Unregistered"} • Rating: ${prof.bestRating}',
                      style: const TextStyle(
                        color: AlokasColors.mutedSage,
                        fontSize: 12,
                      ),
                    ),
                    Text(
                      'School / Club: ${prof.school} • ${prof.city}, ${prof.state}',
                      style: const TextStyle(
                        color: AlokasColors.mutedSage,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              );
            }),
            if (widget.event.entryFeeCents > 0) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AlokasColors.forestCard,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AlokasColors.warmGold),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(
                          Icons.qr_code_2,
                          color: AlokasColors.brightGold,
                          size: 22,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'ORGANIZER DUITNOW / BANK QR (${widget.event.currency} ${(totalFeeCents / 100).toStringAsFixed(0)})',
                            style: const TextStyle(
                              color: AlokasColors.brightGold,
                              fontWeight: FontWeight.w800,
                              fontSize: 12.5,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      widget.event.paymentInstructions,
                      style: const TextStyle(
                        color: AlokasColors.creamIvory,
                        fontSize: 12.5,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Attach DuitNow Payment Receipt Screenshot',
                                style: TextStyle(
                                  color: AlokasColors.creamIvory,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              Text(
                                _attachReceipt
                                    ? 'Receipt attached (DuitNow_Receipt_2026.png)'
                                    : 'Submit now & upload receipt later',
                                style: const TextStyle(
                                  color: AlokasColors.mutedSage,
                                  fontSize: 11.5,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Switch(
                          activeThumbColor: AlokasColors.warmGold,
                          value: _attachReceipt,
                          onChanged: (v) => setState(() => _attachReceipt = v),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                key: const Key('confirm-1tap-register-button'),
                onPressed: _submitting || selectedProfiles.isEmpty
                    ? null
                    : () async {
                        setState(() => _submitting = true);
                        await widget.onSubmit(
                          selectedProfiles,
                          _attachReceipt,
                        );
                      },
                icon: const Icon(Icons.check_circle_outline),
                label: Text(
                  _submitting
                      ? 'Submitting Registration...'
                      : 'Confirm 1-Tap Registration (${selectedProfiles.length} ${selectedProfiles.length == 1 ? "Player" : "Players"})',
                ),
              ),
            ),
          ],
          ),
        );
      },
    );
  }
}
