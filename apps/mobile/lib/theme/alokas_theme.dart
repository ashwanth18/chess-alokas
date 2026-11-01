import 'package:flutter/material.dart';

import 'alokas_tokens.dart';

/// The looks on offer: Alokas green always, whatever the phone's light or dark
/// setting, or high-contrast Sunlight for outdoors.
enum AlokasThemeChoice {
  forest('Alokas green'),
  sun('Sunlight');

  final String label;
  const AlokasThemeChoice(this.label);

  static AlokasThemeChoice fromName(String? name) =>
      AlokasThemeChoice.values.firstWhere(
        (c) => c.name == name,
        orElse: () => AlokasThemeChoice.forest,
      );
}

/// The app's semantic colours. Every colour in the app comes from here, so the
/// look can change in one place.
@immutable
class AlokasPalette extends ThemeExtension<AlokasPalette> {
  final Color paper, paper2, paper3;
  final Color ink, ink2, ink3, onInk;
  final Color rule, ruleStrong;
  final Color pen, penWash;
  final Color flag, flagWash;
  final Color go, goWash;
  final Color wait, waitWash;

  /// Primary buttons, active nav, key labels.
  final Color accent, onAccent, accentWash;
  final Color elevated, gradientStart, gradientEnd, shadow;

  const AlokasPalette({
    required this.paper,
    required this.paper2,
    required this.paper3,
    required this.ink,
    required this.ink2,
    required this.ink3,
    required this.onInk,
    required this.rule,
    required this.ruleStrong,
    required this.pen,
    required this.penWash,
    required this.flag,
    required this.flagWash,
    required this.go,
    required this.goWash,
    required this.wait,
    required this.waitWash,
    required this.accent,
    required this.onAccent,
    required this.accentWash,
    required this.elevated,
    required this.gradientStart,
    required this.gradientEnd,
    required this.shadow,
  });

  static const forest = AlokasPalette(
    paper: AlokasTokens.forestPaper,
    paper2: AlokasTokens.forestPaper2,
    paper3: AlokasTokens.forestPaper3,
    ink: AlokasTokens.forestInk,
    ink2: AlokasTokens.forestInk2,
    ink3: AlokasTokens.forestInk3,
    onInk: AlokasTokens.forestPaper,
    rule: AlokasTokens.forestRule,
    ruleStrong: AlokasTokens.forestRuleStrong,
    pen: AlokasTokens.forestPen,
    penWash: AlokasTokens.forestPenWash,
    flag: AlokasTokens.forestFlag,
    flagWash: AlokasTokens.forestFlagWash,
    go: AlokasTokens.forestGo,
    goWash: AlokasTokens.forestGoWash,
    wait: AlokasTokens.forestWait,
    waitWash: AlokasTokens.forestWaitWash,
    accent: AlokasTokens.forestAccent,
    onAccent: AlokasTokens.forestOnAccent,
    accentWash: AlokasTokens.forestAccentWash,
    elevated: AlokasTokens.forestElevated,
    gradientStart: AlokasTokens.forestElevated,
    gradientEnd: AlokasTokens.forestPaper3,
    shadow: AlokasTokens.forestShadow,
  );

  static const sun = AlokasPalette(
    paper: AlokasTokens.sunPaper,
    paper2: AlokasTokens.sunPaper2,
    paper3: AlokasTokens.sunPaper3,
    ink: AlokasTokens.sunInk,
    ink2: AlokasTokens.sunInk2,
    ink3: AlokasTokens.sunInk3,
    onInk: AlokasTokens.sunOnInk,
    rule: AlokasTokens.sunRule,
    ruleStrong: AlokasTokens.sunRuleStrong,
    pen: AlokasTokens.sunPen,
    penWash: AlokasTokens.sunPenWash,
    flag: AlokasTokens.sunFlag,
    flagWash: AlokasTokens.sunFlagWash,
    go: AlokasTokens.sunGo,
    goWash: AlokasTokens.sunGoWash,
    wait: AlokasTokens.sunWait,
    waitWash: AlokasTokens.sunWaitWash,
    accent: AlokasTokens.sunInk,
    onAccent: AlokasTokens.sunOnInk,
    accentWash: AlokasTokens.sunPenWash,
    elevated: AlokasTokens.sunPaper2,
    gradientStart: AlokasTokens.sunPaper,
    gradientEnd: AlokasTokens.sunPaper,
    shadow: AlokasTokens.sunShadow,
  );

  @override
  AlokasPalette copyWith() => this;

  /// Themes switch with a hard cut; the design has almost no motion.
  @override
  AlokasPalette lerp(ThemeExtension<AlokasPalette>? other, double t) =>
      other is AlokasPalette && t >= 0.5 ? other : this;
}

extension AlokasContext on BuildContext {
  AlokasPalette get pal => Theme.of(this).extension<AlokasPalette>()!;
}

/// The app's type scale. Variable fonts ignore [FontWeight] unless the wght
/// axis is set too, so every style in the app goes through [atype].
TextStyle atype(
  double size, {
  int weight = 400,
  Color? color,
  double? height,
  double width = 100,
  bool tabular = false,
  double? spacing,
  TextDecoration? decoration,
}) {
  return TextStyle(
    fontFamily: AlokasTheme.fontFamily,
    fontFamilyFallback: AlokasTheme.fontFallback,
    fontSize: size,
    fontWeight: FontWeight.values[((weight / 100).round() - 1).clamp(0, 8)],
    fontVariations: [
      FontVariation('wght', weight.toDouble()),
      FontVariation('wdth', width),
    ],
    fontFeatures: tabular ? const [FontFeature.tabularFigures()] : null,
    color: color,
    height: height,
    letterSpacing: spacing,
    decoration: decoration,
  );
}

class AlokasTheme {
  static const String fontFamily = 'Archivo';

  /// Then the system fonts, which carry Chinese and Tamil.
  static const List<String> fontFallback = ['ArchivoExt'];
  static const double radius = 12;
  static const double cardRadius = 16;
  static const double minTarget = 48;

  static ThemeData of(AlokasThemeChoice choice) => switch (choice) {
    AlokasThemeChoice.forest => build(AlokasPalette.forest, Brightness.dark),
    AlokasThemeChoice.sun => build(AlokasPalette.sun, Brightness.light),
  };

  static ThemeData build(AlokasPalette p, Brightness brightness) {
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(radius),
    );
    final scheme = ColorScheme(
      brightness: brightness,
      primary: p.accent,
      onPrimary: p.onAccent,
      secondary: p.pen,
      onSecondary: p.paper,
      surface: p.paper,
      onSurface: p.ink,
      onSurfaceVariant: p.ink2,
      surfaceContainerLowest: p.paper,
      surfaceContainerLow: p.paper,
      surfaceContainer: p.paper,
      surfaceContainerHigh: p.paper2,
      surfaceContainerHighest: p.paper3,
      surfaceTint: p.paper,
      error: p.flag,
      onError: p.paper,
      outline: p.ruleStrong,
      outlineVariant: p.rule,
      shadow: p.shadow,
    );

    OutlineInputBorder border(Color color, [double width = 1.5]) =>
        OutlineInputBorder(
          borderRadius: BorderRadius.circular(radius),
          borderSide: BorderSide(color: color, width: width),
        );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      extensions: [p],
      fontFamily: fontFamily,
      fontFamilyFallback: fontFallback,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      scaffoldBackgroundColor: p.paper,
      canvasColor: p.paper,
      dividerColor: p.rule,
      splashFactory: NoSplash.splashFactory,
      textTheme: TextTheme(
        displayLarge: atype(44, weight: 800, width: 112, color: p.ink),
        headlineLarge: atype(32, weight: 800, width: 108, color: p.ink),
        headlineMedium: atype(24, weight: 800, width: 108, color: p.ink),
        titleLarge: atype(20, weight: 800, color: p.ink),
        titleMedium: atype(18, weight: 700, color: p.ink),
        titleSmall: atype(16, weight: 600, color: p.ink),
        bodyLarge: atype(16, color: p.ink, height: 1.35),
        bodyMedium: atype(16, color: p.ink, height: 1.35),
        bodySmall: atype(14, color: p.ink2, height: 1.3),
        labelLarge: atype(16, weight: 700, color: p.ink),
        labelMedium: atype(14, weight: 600, color: p.ink),
        labelSmall: atype(13, weight: 600, color: p.ink2),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: p.paper,
        foregroundColor: p.ink,
        surfaceTintColor: p.paper,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: atype(18, weight: 700, color: p.ink),
      ),
      cardTheme: CardThemeData(
        color: p.paper3,
        surfaceTintColor: p.paper3,
        shadowColor: p.shadow,
        elevation: 2,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(cardRadius),
          side: BorderSide(color: p.rule),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: p.paper2,
        surfaceTintColor: p.paper2,
        indicatorColor: p.accentWash,
        indicatorShape: shape,
        elevation: 0,
        height: 64,
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            size: 22,
            color: states.contains(WidgetState.selected) ? p.accent : p.ink3,
          ),
        ),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? atype(13, weight: 700, color: p.accent)
              : atype(13, weight: 500, color: p.ink3),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: false,
        hintStyle: atype(16, color: p.ink3),
        labelStyle: atype(16, color: p.ink2),
        floatingLabelStyle: atype(14, weight: 600, color: p.accent),
        helperStyle: atype(14, color: p.ink2),
        errorStyle: atype(14, weight: 600, color: p.flag),
        prefixIconColor: p.ink2,
        suffixIconColor: p.ink2,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 12,
          vertical: 14,
        ),
        border: border(p.ruleStrong),
        enabledBorder: border(p.ruleStrong),
        focusedBorder: border(p.accent, 2),
        errorBorder: border(p.flag),
        focusedErrorBorder: border(p.flag, 2),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          elevation: 2,
          shadowColor: p.shadow,
          backgroundColor: p.accent,
          foregroundColor: p.onAccent,
          disabledBackgroundColor: p.paper3,
          disabledForegroundColor: p.ink2,
          textStyle: atype(16, weight: 700),
          minimumSize: const Size(minTarget, 52),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          shape: shape,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: p.accent,
          disabledForegroundColor: p.ink3,
          side: BorderSide(color: p.accent, width: 1.5),
          textStyle: atype(16, weight: 600),
          minimumSize: const Size(minTarget, minTarget),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          shape: shape,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: p.pen,
          textStyle: atype(16, weight: 600),
          minimumSize: const Size(minTarget, minTarget),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          shape: shape,
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          foregroundColor: p.ink,
          minimumSize: const Size(minTarget, minTarget),
          shape: shape,
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: p.paper2,
        surfaceTintColor: p.paper2,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(cardRadius),
          side: BorderSide(color: p.ruleStrong),
        ),
        titleTextStyle: atype(20, weight: 800, color: p.ink),
        contentTextStyle: atype(16, color: p.ink, height: 1.35),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: p.paper2,
        surfaceTintColor: p.paper2,
        elevation: 0,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(cardRadius)),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: p.elevated,
        contentTextStyle: atype(16, color: p.ink),
        actionTextColor: p.accent,
        elevation: 0,
        shape: shape,
        behavior: SnackBarBehavior.floating,
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: p.accent),
      dividerTheme: DividerThemeData(color: p.rule, thickness: 1, space: 1),
      dropdownMenuTheme: DropdownMenuThemeData(
        textStyle: atype(16, color: p.ink),
      ),
    );
  }
}

/// A square chip on a wash, for status and facts. Words carry the meaning, so
/// colour is never the only signal.
enum ChipTone { neutral, pen, flag, go, wait }

class AlokasBadge extends StatelessWidget {
  final String text;
  final ChipTone tone;
  final IconData? icon;

  const AlokasBadge({
    super.key,
    required this.text,
    this.tone = ChipTone.neutral,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    final (background, foreground) = switch (tone) {
      ChipTone.neutral => (p.accentWash, p.accent),
      ChipTone.pen => (p.penWash, p.pen),
      ChipTone.flag => (p.flagWash, p.flag),
      ChipTone.go => (p.goWash, p.go),
      ChipTone.wait => (p.waitWash, p.wait),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 15, color: foreground),
            const SizedBox(width: 5),
          ],
          Flexible(
            child: Text(
              text,
              style: atype(14, weight: 600, color: foreground, height: 1.25),
            ),
          ),
        ],
      ),
    );
  }
}
