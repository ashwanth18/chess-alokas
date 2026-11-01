import 'package:flutter/material.dart';

class AlokasColors {
  static const Color deepForest = Color(0xFF071F17);
  static const Color forestSurface = Color(0xFF0C2B20);
  static const Color forestCard = Color(0xFF11382A);
  static const Color forestElevated = Color(0xFF174936);
  static const Color warmGold = Color(0xFFD4B98A);
  static const Color brightGold = Color(0xFFE6C994);
  static const Color goldBorder = Color(0x44D4B98A);
  static const Color creamIvory = Color(0xFFF5EFE6);
  static const Color mutedSage = Color(0xFFA6B8AF);
  static const Color emeraldSuccess = Color(0xFF34D399);
  static const Color amberWarning = Color(0xFFFBBF24);
  static const Color crimsonDanger = Color(0xFFF87171);
  static const Color skyInfo = Color(0xFF38BDF8);
}

class AlokasTheme {
  static ThemeData get darkTheme {
    final base = ThemeData.dark(useMaterial3: true);
    return base.copyWith(
      scaffoldBackgroundColor: AlokasColors.deepForest,
      colorScheme: const ColorScheme.dark(
        primary: AlokasColors.warmGold,
        onPrimary: AlokasColors.deepForest,
        secondary: AlokasColors.brightGold,
        onSecondary: AlokasColors.deepForest,
        surface: AlokasColors.forestSurface,
        onSurface: AlokasColors.creamIvory,
        error: AlokasColors.crimsonDanger,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: AlokasColors.deepForest,
        foregroundColor: AlokasColors.creamIvory,
        elevation: 0,
        centerTitle: false,
      ),
      cardTheme: CardThemeData(
        color: AlokasColors.forestCard,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: AlokasColors.goldBorder, width: 1),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AlokasColors.forestSurface,
        indicatorColor: AlokasColors.warmGold.withValues(alpha: 0.22),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const IconThemeData(color: AlokasColors.brightGold);
          }
          return const IconThemeData(color: AlokasColors.mutedSage);
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const TextStyle(
              color: AlokasColors.brightGold,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            );
          }
          return const TextStyle(
            color: AlokasColors.mutedSage,
            fontSize: 12,
            fontWeight: FontWeight.w500,
          );
        }),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AlokasColors.forestSurface,
        hintStyle: const TextStyle(color: AlokasColors.mutedSage, fontSize: 14),
        labelStyle: const TextStyle(color: AlokasColors.warmGold, fontSize: 14),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AlokasColors.goldBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AlokasColors.brightGold, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AlokasColors.crimsonDanger),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(
            color: AlokasColors.crimsonDanger,
            width: 1.5,
          ),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AlokasColors.warmGold,
          foregroundColor: AlokasColors.deepForest,
          textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AlokasColors.brightGold,
          side: const BorderSide(color: AlokasColors.warmGold),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      dividerColor: AlokasColors.goldBorder,
    );
  }
}

class AlokasBadge extends StatelessWidget {
  final String text;
  final Color color;
  final IconData? icon;

  const AlokasBadge({
    super.key,
    required this.text,
    this.color = AlokasColors.warmGold,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 13, color: color),
            const SizedBox(width: 4),
          ],
          Flexible(
            child: Text(
              text,
              style: TextStyle(
                color: color,
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.2,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
