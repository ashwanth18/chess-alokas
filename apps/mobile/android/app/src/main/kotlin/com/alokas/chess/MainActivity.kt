package com.alokas.chess

import android.content.ActivityNotFoundException
import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // "Open email app" after sign-up: the inbox of whichever email app the
        // phone has, never a compose screen.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.alokas.chess/email")
            .setMethodCallHandler { call, result ->
                if (call.method != "openInbox") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                val intent = Intent.makeMainSelectorActivity(
                    Intent.ACTION_MAIN,
                    Intent.CATEGORY_APP_EMAIL,
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try {
                    startActivity(intent)
                    result.success(true)
                } catch (e: ActivityNotFoundException) {
                    result.success(false)
                }
            }
    }
}
