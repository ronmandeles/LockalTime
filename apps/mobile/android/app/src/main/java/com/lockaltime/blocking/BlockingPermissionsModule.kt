package com.lockaltime.blocking

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

// Phase 3 task 3.2 (backlog.md): the real Android half of the
// blockingPermissions seam (apps/mobile/src/services/blocking-permissions.ts).
// Reports ONE combined status for Usage Access + Overlay together — the JS
// side never sees per-permission nuance, matching the "weakest link"
// contract blocking-permissions.ts has pinned since Phase 1. Neither Usage
// Access nor Overlay is a normal runtime-permission dialog: both are
// special/"app op" grants that only Settings screens can toggle, so
// request() launches whichever is still missing and resolves 'undetermined'
// — the JS side re-checks getStatus() when the app resumes foreground
// (PermissionPrimingScreen's AppState recheck), not from this call's result.
//
// SEQUENCING: two grants, two Settings screens, one Allow tap. The screen
// re-drives request() on every foreground return while a trip is in flight,
// so this module — not the JS side — decides whether that turns into another
// Settings launch. It advances only on PROGRESS: if the permission it last
// asked for is still ungranted, the user backed out, and re-launching would
// bounce them into Settings again on every single return with no way back
// into the app. That case answers 'denied' instead, which lands the screen in
// its recovery state. Keeping this here is what lets the JS contract stay a
// single combined status with no per-permission detail leaking across.
class BlockingPermissionsModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "BlockingPermissionsModule"

  // Which permission's Settings screen this module last opened, or null when
  // no trip is outstanding. Read once per request() to tell "granted it and
  // came back" from "backed out without granting".
  private var pendingPermission: PendingPermission? = null

  private enum class PendingPermission {
    USAGE_ACCESS,
    OVERLAY,
  }

  private fun isGranted(permission: PendingPermission): Boolean =
    when (permission) {
      PendingPermission.USAGE_ACCESS -> PermissionChecks.hasUsageAccess(reactContext)
      PendingPermission.OVERLAY -> PermissionChecks.hasOverlayPermission(reactContext)
    }

  private fun currentStatusMap(): WritableMap {
    val granted =
      PermissionChecks.hasUsageAccess(reactContext) && PermissionChecks.hasOverlayPermission(reactContext)
    val map = Arguments.createMap()
    map.putString("status", if (granted) "granted" else "denied")
    return map
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    promise.resolve(currentStatusMap())
  }

  @ReactMethod
  fun request(promise: Promise) {
    // One settings screen at a time: Usage Access first, then Overlay once
    // Usage Access is granted — asking for both at once isn't possible,
    // there is no combined settings screen.
    val next =
      when {
        !PermissionChecks.hasUsageAccess(reactContext) -> PendingPermission.USAGE_ACCESS
        !PermissionChecks.hasOverlayPermission(reactContext) -> PendingPermission.OVERLAY
        else -> null
      }

    if (next == null) {
      // Everything granted — the sequence is done.
      pendingPermission = null
      promise.resolve(currentStatusMap())
      return
    }

    // No progress since the last launch: the user saw that screen and came
    // back without granting it. Re-opening it here is the relaunch loop this
    // guard exists to prevent, so report the refusal and let the screen fall
    // back to its recovery state. Clearing the pending marker means a later
    // deliberate Allow press starts the sequence over rather than being
    // refused a second time.
    val outstanding = pendingPermission
    if (outstanding != null && !isGranted(outstanding)) {
      pendingPermission = null
      promise.resolve(currentStatusMap())
      return
    }

    val intent =
      when (next) {
        PendingPermission.USAGE_ACCESS -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
        PendingPermission.OVERLAY -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
      }.apply {
        // Scopes the screen to Lockal Time's own toggle rather than the full
        // per-app list, where the user would have to hunt for the entry.
        data = Uri.parse("package:${reactContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }

    try {
      reactContext.startActivity(intent)
      pendingPermission = next
      val map = Arguments.createMap()
      map.putString("status", "undetermined")
      promise.resolve(map)
    } catch (error: Exception) {
      // No Settings activity available to handle the intent (unusual, but
      // not a crash-worthy condition) — report the real current status.
      pendingPermission = null
      promise.resolve(currentStatusMap())
    }
  }

  // Battery-optimization exemption (ARCHITECTURE.md §8 item 13): a
  // separate, best-effort reliability ask, never part of the granted/denied
  // capability above — Android never lets an app force this, so it can't
  // gate session start. Resolves true only when already exempt; otherwise
  // launches the one-tap system dialog and resolves false (fire-and-forget,
  // the JS side never awaits a grant here).
  @ReactMethod
  fun requestBatteryOptimizationExemption(promise: Promise) {
    val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
    if (powerManager.isIgnoringBatteryOptimizations(reactContext.packageName)) {
      promise.resolve(true)
      return
    }

    try {
      val intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:${reactContext.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      reactContext.startActivity(intent)
      promise.resolve(false)
    } catch (error: Exception) {
      promise.resolve(false)
    }
  }
}
