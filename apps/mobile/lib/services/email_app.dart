import 'dart:io';

import 'package:flutter/services.dart';

/// Opens the phone's email app at its inbox. False when there is none, or on
/// a platform where this is not supported.
typedef EmailAppOpener = Future<bool> Function();

const MethodChannel _channel = MethodChannel('com.alokas.chess/email');

Future<bool> openEmailApp() async {
  if (!Platform.isAndroid) return false;
  try {
    return await _channel.invokeMethod<bool>('openInbox') ?? false;
  } on Object {
    return false;
  }
}
