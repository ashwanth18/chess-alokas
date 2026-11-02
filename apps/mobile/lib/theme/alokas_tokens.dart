// Colour tokens: the Alokas green and gold brand, plus Sunlight for outdoors.
// Only lib/theme/ may hold raw colours.
import 'package:flutter/material.dart';

class AlokasTokens {
  // Piece colours are physical: the same in every theme.
  static const pieceWhite = Color(0xFFFFFFFF);
  static const pieceBlack = Color(0xFF000000);

  // Alokas brand: forest green surfaces, gold accent, cream text. The default
  // look of the app. Every text pair is checked against WCAG AA in
  // test/design_and_flows_test.dart.
  static const forestPaper = Color(0xFF071F17);
  static const forestPaper2 = Color(0xFF0C2B20);
  static const forestPaper3 = Color(0xFF11382A);
  static const forestElevated = Color(0xFF174936);
  static const forestInk = Color(0xFFF5EFE6);
  static const forestInk2 = Color(0xFFD3DCD5);
  static const forestInk3 = Color(0xFFB4C4BB);
  static const forestRule = Color(0xFF2B5A47);
  static const forestRuleStrong = Color(0xFFB39E76);
  static const forestAccent = Color(0xFFD4B98A);
  static const forestAccentBright = Color(0xFFE6C994);
  static const forestOnAccent = Color(0xFF071F17);
  static const forestAccentWash = Color(0xFF3A4A2C);
  static const forestPen = Color(0xFFE6C994);
  static const forestPenWash = Color(0xFF3A4A2C);
  static const forestFlag = Color(0xFFFFB4AB);
  static const forestFlagWash = Color(0xFF4A1F1C);
  static const forestGo = Color(0xFF6EE7B7);
  static const forestGoWash = Color(0xFF123F2E);
  static const forestWait = Color(0xFFFBCB5A);
  static const forestWaitWash = Color(0xFF3A3010);
  static const forestShadow = Color(0x66000000);

  // The crown logo, from docs/design/logo. The same in every theme.
  static const logoGreen = Color(0xFF0F3D2E);
  static const logoGoldTop = Color(0xFFF0DFB8);
  static const logoGoldBottom = Color(0xFFC7A56C);

  // The map. Blue is the convention for "you are here", so it stays blue.
  static const mapUserDot = Color(0xFF3D8BFF);
  static const mapUserRing = Color(0xFFFFFFFF);

  static const sunPaper = Color(0xFFFFFFFF);
  static const sunPaper2 = Color(0xFFF2F2F2);
  static const sunPaper3 = Color(0xFFE0E0E0);
  static const sunInk = Color(0xFF000000);
  static const sunInk2 = Color(0xFF1C1C1C);
  static const sunInk3 = Color(0xFF333333);
  static const sunRule = Color(0xFF6E6E6E);
  static const sunRuleStrong = Color(0xFF000000);
  static const sunPen = Color(0xFF002FA8);
  static const sunPenWash = Color(0xFFDCE5FF);
  static const sunFlag = Color(0xFF9E0B0B);
  static const sunFlagWash = Color(0xFFFFE1DC);
  static const sunGo = Color(0xFF0A4A26);
  static const sunGoWash = Color(0xFFD6F0DF);
  static const sunWait = Color(0xFF5C3C00);
  static const sunWaitWash = Color(0xFFFFEDB8);
  static const sunOnInk = Color(0xFFFFFFFF);
  static const sunShadow = Color(0x00000000);
}
