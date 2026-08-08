package com.lockaltime.blocking

import android.content.Intent
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

// Phase 3 task 3.3 (backlog.md): the real Android AppBlockerModule
// (apps/mobile/src/services/app-blocker.ts's native seam). start/stop just
// start/stop BlockerForegroundService — all the actual polling/overlay
// logic lives there; this module is a thin bridge plus the event relay
// (BlockerForegroundService.emitEvent below is what the service calls,
// in-process, no IPC needed).
class AppBlockerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    @Volatile
    private var instance: AppBlockerModule? = null

    // Called by BlockerForegroundService to relay a BlockerEvent
    // (app-blocker.ts's discriminated union) to JS. A no-op if no RN
    // instance is currently attached — matches the rest of this module's
    // fail-open posture (a missed event during a brief RN reload is not
    // worth crashing over).
    fun emitEvent(eventName: String, params: WritableMap?) {
      instance?.sendEvent(eventName, params)
    }
  }

  override fun getName(): String = "AppBlockerModule"

  override fun initialize() {
    super.initialize()
    instance = this
  }

  override fun invalidate() {
    if (instance === this) {
      instance = null
    }
    super.invalidate()
  }

  private fun sendEvent(eventName: String, params: WritableMap?) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(eventName, params)
  }

  @ReactMethod
  fun start(config: ReadableMap, promise: Promise) {
    val sessionId = config.getString("sessionId")
    if (sessionId == null) {
      promise.resolve(null)
      return
    }
    val endsAt = if (config.hasKey("endsAt") && !config.isNull("endsAt")) config.getString("endsAt") else null
    val categories = config.readStringList("blockedCategories")
    val packages = config.readStringList("blockedPackages")
    // Phase 9 (plan §8): already-translated overlay copy, resolved by JS and
    // handed down here. The overlay is a bare TextView with no i18next of
    // its own, and duplicating the strings into Android resources would mean
    // a second translation source to keep in sync.
    val overlayBlockedApp = config.readOptionalString("overlayBlockedApp")
    val overlayBlockedGeneric = config.readOptionalString("overlayBlockedGeneric")

    val intent =
      BlockerForegroundService.buildStartIntent(
        reactContext,
        sessionId,
        endsAt,
        categories,
        packages,
        overlayBlockedApp,
        overlayBlockedGeneric,
      )
    ContextCompat.startForegroundService(reactContext, intent)
    promise.resolve(null)
  }

  private fun ReadableMap.readStringList(key: String): List<String> {
    val array: ReadableArray = (if (hasKey(key)) getArray(key) else null) ?: return emptyList()
    val values = mutableListOf<String>()
    for (index in 0 until array.size()) {
      array.getString(index)?.let { values.add(it) }
    }
    return values
  }

  private fun ReadableMap.readOptionalString(key: String): String? =
    if (hasKey(key) && !isNull(key)) getString(key) else null

  @ReactMethod
  fun stop(promise: Promise) {
    BlockerForegroundService.markDeliberateStop()
    reactContext.stopService(Intent(reactContext, BlockerForegroundService::class.java))
    promise.resolve(null)
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    val sessionId = BlockerForegroundService.currentSessionId
    val map = Arguments.createMap()
    if (!BlockerForegroundService.isRunning || sessionId == null) {
      map.putString("state", "inactive")
      promise.resolve(map)
      return
    }

    val stillGranted =
      PermissionChecks.hasUsageAccess(reactContext) && PermissionChecks.hasOverlayPermission(reactContext)
    if (!stillGranted) {
      map.putString("state", "violation")
      map.putString("sessionId", sessionId)
      map.putString("reason", "permission_revoked")
    } else {
      map.putString("state", "active")
      map.putString("sessionId", sessionId)
    }
    promise.resolve(map)
  }

  // Required by NativeEventEmitter's JS-side subscription bookkeeping —
  // this module has no per-listener setup/teardown of its own to do since
  // BlockerForegroundService always emits to the shared RCTDeviceEventEmitter.
  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}
}
