import 'package:flutter/material.dart';

import 'alokas_tokens.dart';

/// Which of the Pairing Sheet themes the user asked for.
enum AlokasThemeChoice {
  system('Auto'),
  light('Light'),
  dark('Dark'),
  sun('Sunlight');

  final String label;
  const AlokasThemeChoice(this.label);

  static AlokasThemeChoice fromName(String? name) => AlokasThemeChoice.values
      .firstWhere((c) => c.name == name, orElse: () => AlokasThemeChoice.system);
}

/// The design's semantic colours. Ink is fact, pen is what was just entered,
/// flag needs a person, go is delivered, wait is on this device.
@immutable
class AlokasPalette extends ThemeExtension<AlokasPalette> {
  final Color paper, paper2, paper3;
  final Color ink, ink2, ink3, onInk;
  final Color rule, ruleStrong;
  final Color pen, penWash;
  final Color flag, flagWash;
  final Color go, goWash;
  final Color wait, waitWash;

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
  });

  static const light = AlokasPalette(
    paper: AlokasTokens.lightPaper,
    paper2: AlokasTokens.lightPaper2,
    paper3: AlokasTokens.lightPaper3,
    ink: AlokasTokens.lightInk,
    ink2: AlokasTokens.lightInk2,
    ink3: AlokasTokens.lightInk3,
    onInk: AlokasTokens.lightOnInk,
    rule: AlokasTokens.lightRule,
    ruleStrong: AlokasTokens.lightRuleStrong,
    pen: AlokasTokens.lightPen,
    penWash: AlokasTokens.lightPenWash,
    flag: AlokasTokens.lightFlag,
    flagWash: AlokasTokens.lightFlagWash,
    go: AlokasTokens.lightGo,
    goWash: AlokasTokens.lightGoWash,
    wait: AlokasTokens.lightWait,
    waitWash: AlokasTokens.lightWaitWash,
  );

  static const dark = AlokasPalette(
    paper: AlokasTokens.darkPaper,
    paper2: AlokasTokens.darkPaper2,
    paper3: AlokasTokens.darkPaper3,
    ink: AlokasTokens.darkInk,
    ink2: AlokasTokens.darkInk2,
    ink3: AlokasTokens.darkInk3,
    onInk: AlokasTokens.darkOnInk,
    rule: AlokasTokens.darkRule,
    ruleStrong: AlokasTokens.darkRuleStrong,
    pen: AlokasTokens.darkPen,
    penWash: AlokasTokens.darkPenWash,
    flag: AlokasTokens.darkFlag,
    flagWash: AlokasTokens.darkFlagWash,
    go: AlokasTokens.darkGo,
    goWash: AlokasTokens.darkGoWash,
    wait: AlokasTokens.darkWait,
    waitWash: AlokasTokens.darkWaitWash,
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

/// The design's type scale. Variable fonts ignore [FontWeight] unless the wght
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
  static const double radius = 3;
  static const double minTarget = 48;

  static ThemeData of(AlokasThemeChoice choice, Brightness platform) {
    switch (choice) {
      case AlokasThemeChoice.light:
        return build(AlokasPalette.light, Brightness.light);
      case AlokasThemeChoice.dark:
        return build(AlokasPalette.dark, Brightness.dark);
      case AlokasThemeChoice.sun:
        return build(AlokasPalette.sun, Brightness.light);
      case AlokasThemeChoice.system:
        return platform == Brightness.dark
            ? build(AlokasPalette.dark, Brightness.dark)
            : build(AlokasPalette.light, Brightness.light);
    }
  }

  static ThemeData build(AlokasPalette p, Brightness brightness) {
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(radius),
    );
    final scheme = ColorScheme(
      brightness: brightness,
      primary: p.ink,
      onPrimary: p.onInk,
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
      shadow: p.ink,
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
        shape: Border(bottom: BorderSide(color: p.rule)),
      ),
      cardTheme: CardThemeData(
        color: p.paper,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radius),
          side: BorderSide(color: p.rule),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: p.paper,
        surfaceTintColor: p.paper,
        indicatorColor: p.paper3,
        indicatorShape: shape,
        elevation: 0,
        height: 64,
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            size: 22,
            color: states.contains(WidgetState.selected) ? p.ink : p.ink3,
          ),
        ),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? atype(13, weight: 700, color: p.ink)
              : atype(13, weight: 500, color: p.ink3),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: false,
        hintStyle: atype(16, color: p.ink3),
        labelStyle: atype(16, color: p.ink2),
        floatingLabelStyle: atype(14, weight: 600, color: p.ink),
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
        focusedBorder: border(p.pen, 2),
        errorBorder: border(p.flag),
        focusedErrorBorder: border(p.flag, 2),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          elevation: 0,
          shadowColor: p.paper,
          backgroundColor: p.ink,
          foregroundColor: p.onInk,
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
          foregroundColor: p.ink,
          disabledForegroundColor: p.ink3,
          side: BorderSide(color: p.ruleStrong, width: 1.5),
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
        backgroundColor: p.paper,
        surfaceTintColor: p.paper,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radius),
          side: BorderSide(color: p.ruleStrong),
        ),
        titleTextStyle: atype(20, weight: 800, color: p.ink),
        contentTextStyle: atype(16, color: p.ink, height: 1.35),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: p.paper,
        surfaceTintColor: p.paper,
        elevation: 0,
        shape: Border(top: BorderSide(color: p.ink, width: 2)),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: p.ink,
        contentTextStyle: atype(16, color: p.onInk),
        actionTextColor: p.onInk,
        elevation: 0,
        shape: shape,
        behavior: SnackBarBehavior.floating,
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: p.ink),
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

  const AlokasBadge({
    super.key,
    required this.text,
    this.tone = ChipTone.neutral,
  });

  @override
  Widget build(BuildContext context) {
    final p = context.pal;
    final (background, foreground) = switch (tone) {
      ChipTone.neutral => (p.paper2, p.ink),
      ChipTone.pen => (p.penWash, p.pen),
      ChipTone.flag => (p.flagWash, p.flag),
      ChipTone.go => (p.goWash, p.go),
      ChipTone.wait => (p.waitWash, p.wait),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(AlokasTheme.radius),
      ),
      child: Text(
        text,
        style: atype(14, weight: 600, color: foreground, height: 1.25),
      ),
    );
  }
}
