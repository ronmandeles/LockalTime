package com.lockaltime.blocking

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.graphics.PixelFormat
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.lockaltime.R
import java.time.Instant
import java.time.format.DateTimeParseException

// Phase 3 task 3.3 (backlog.md): the real Android blocker — Foreground
// Service + UsageStatsManager polling + SYSTEM_ALERT_WINDOW overlay
// (ARCHITECTURE.md §4; deliberately not AccessibilityService — see that
// section for why). Started/stopped by AppBlockerModule.kt, which is the
// only thing JS talks to; this service never talks to JS directly except by
// relaying events through AppBlockerModule.emitEvent (in-process, no IPC
// needed — the service and the RN instance share one process).
//
// Poll loop (every POLL_INTERVAL_MS): self-checks Usage Access/Overlay are
// still granted (§8 item 2 — a mid-session revoke becomes a local violation
// event, not a crash), finds the current foreground app via
// UsageStatsManager, and shows/hides the overlay depending on whether that
// app's category is in this session's blocked set. Also self-stops once
// `endsAt` passes — a local UX safeguard so an offline device never stays
// blocked past a fixed session's planned end; it does NOT decide points or
// the session's server-side end reason (Money-Equivalent Logic Rule,
// CLAUDE.md) — that stays the Node API's job once connectivity resumes.
class BlockerForegroundService : Service() {

  companion object {
    private const val NOTIFICATION_CHANNEL_ID = "lockal_time_session"
    private const val NOTIFICATION_ID = 1001
    private const val POLL_INTERVAL_MS = 2000L

    // ARCHITECTURE.md §4 "Offline mode": the 30-minute offline enforcement
    // window is owned by this native layer, not JS, since React Native can
    // be suspended by the OS while this foreground service keeps polling.
    // Checked every poll cycle against ConnectivityManager rather than via
    // a registered NetworkCallback — simpler, and precise enough at a 2s
    // poll interval for a 30-minute threshold.
    private const val OFFLINE_CUTOFF_MS = 30 * 60 * 1000L
    private const val EXTRA_SESSION_ID = "sessionId"
    private const val EXTRA_ENDS_AT = "endsAt"
    private const val EXTRA_BLOCKED_CATEGORIES = "blockedCategories"
    private const val EXTRA_BLOCKED_PACKAGES = "blockedPackages"
    private const val EXTRA_OVERLAY_BLOCKED_APP = "overlayBlockedApp"
    private const val EXTRA_OVERLAY_BLOCKED_GENERIC = "overlayBlockedGeneric"

    // Read by AppBlockerModule.getStatus() — this service is the only thing
    // that knows whether it's actually alive; the module never assumes.
    @Volatile
    var isRunning: Boolean = false
      private set

    @Volatile
    var currentSessionId: String? = null
      private set

    // Set right before a deliberate stop() call from the module, so
    // onDestroy can tell "JS asked me to stop" apart from an unexpected
    // teardown (the only case that should ever emit service_killed).
    @Volatile
    private var deliberateStop = false

    fun buildStartIntent(
      context: Context,
      sessionId: String,
      endsAt: String?,
      blockedCategories: List<String>,
      blockedPackages: List<String>,
      overlayBlockedApp: String?,
      overlayBlockedGeneric: String?,
    ): Intent =
      Intent(context, BlockerForegroundService::class.java).apply {
        putExtra(EXTRA_SESSION_ID, sessionId)
        putExtra(EXTRA_ENDS_AT, endsAt)
        putExtra(EXTRA_BLOCKED_CATEGORIES, blockedCategories.toTypedArray())
        putExtra(EXTRA_BLOCKED_PACKAGES, blockedPackages.toTypedArray())
        putExtra(EXTRA_OVERLAY_BLOCKED_APP, overlayBlockedApp)
        putExtra(EXTRA_OVERLAY_BLOCKED_GENERIC, overlayBlockedGeneric)
      }

    fun markDeliberateStop() {
      deliberateStop = true
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private var sessionId: String = ""
  private var endsAtMillis: Long? = null
  private var blockedAndroidCategories: Set<Int> = emptySet()
  // Phase 9: specific apps by package name, alongside the categories. The
  // poll blocks a foreground app if EITHER matches.
  private var blockedPackages: Set<String> = emptySet()
  // Already-translated copy handed down from JS at start() (plan §8) — the
  // overlay is a bare TextView with no i18next of its own. Null only on the
  // boot-restart path if nothing was persisted, where the Android string
  // resource is the last-resort fallback.
  private var overlayBlockedAppTemplate: String? = null
  private var overlayBlockedGeneric: String? = null
  private var overlayView: View? = null
  private var batteryReceiver: BroadcastReceiver? = null

  // Assumes connected at service start — a device that's already offline
  // when a session starts gets the same 30-minute grace as one that drops
  // mid-session, rather than an instant cutoff.
  private var lastConnectedAtMillis: Long = System.currentTimeMillis()

  private val pollRunnable: Runnable =
    object : Runnable {
      override fun run() {
        poll()
        handler.postDelayed(this, POLL_INTERVAL_MS)
      }
    }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    isRunning = true
    deliberateStop = false
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    var rawCategories: List<String> = emptyList()
    var rawPackages: List<String> = emptyList()
    if (intent != null) {
      sessionId = intent.getStringExtra(EXTRA_SESSION_ID) ?: ""
      currentSessionId = sessionId
      endsAtMillis = parseEndsAt(intent.getStringExtra(EXTRA_ENDS_AT))
      rawCategories = intent.getStringArrayExtra(EXTRA_BLOCKED_CATEGORIES)?.toList() ?: emptyList()
      blockedAndroidCategories = rawCategories.flatMap { CategoryMapping.androidCategoriesFor(it) }.toSet()
      rawPackages = intent.getStringArrayExtra(EXTRA_BLOCKED_PACKAGES)?.toList() ?: emptyList()
      blockedPackages = rawPackages.toSet()
      overlayBlockedAppTemplate = intent.getStringExtra(EXTRA_OVERLAY_BLOCKED_APP)
      overlayBlockedGeneric = intent.getStringExtra(EXTRA_OVERLAY_BLOCKED_GENERIC)
    }

    // Boot persistence (task 3.4): every real start (not a boot-restart
    // replaying the same config) re-saves the snapshot, so a reboot
    // mid-session always has the latest config to resume from. Phase 9:
    // the packages and the overlay copy go in too — a reboot restarts this
    // service without JS ever running, so anything absent here resumes as
    // a partial blocklist or an empty overlay.
    if (intent != null && sessionId.isNotEmpty()) {
      BootPersistence.save(
        applicationContext,
        sessionId,
        intent.getStringExtra(EXTRA_ENDS_AT),
        rawCategories,
        rawPackages,
        overlayBlockedAppTemplate,
        overlayBlockedGeneric,
      )
    }

    startForeground(NOTIFICATION_ID, buildNotification())
    registerBatteryReceiver()
    handler.removeCallbacks(pollRunnable)
    handler.post(pollRunnable)
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(pollRunnable)
    removeOverlay()
    batteryReceiver?.let { receiver -> runCatching { unregisterReceiver(receiver) } }
    isRunning = false
    currentSessionId = null

    if (deliberateStop) {
      // JS-initiated stop(), or the local endsAt-reached self-stop — either
      // way there's nothing left to resume on a later boot.
      BootPersistence.clear(applicationContext)
    } else if (sessionId.isNotEmpty()) {
      // Unexpected teardown while a session was mid-flight — the persisted
      // snapshot deliberately survives so BOOT_COMPLETED (or a future
      // relaunch-reconciliation task) can restart it.
      AppBlockerModule.emitEvent(
        "service_killed",
        Arguments.createMap().apply {
          putString("sessionId", sessionId)
          putString("lastSeenAt", Instant.now().toString())
        },
      )
    }
    super.onDestroy()
  }

  private fun parseEndsAt(raw: String?): Long? {
    if (raw == null) return null
    return try {
      Instant.parse(raw).toEpochMilli()
    } catch (error: DateTimeParseException) {
      null
    }
  }

  private fun poll() {
    val endsAt = endsAtMillis
    if (endsAt != null && System.currentTimeMillis() >= endsAt) {
      // Local safeguard only — never the server-authoritative end reason.
      markDeliberateStop()
      stopSelf()
      return
    }

    if (isCurrentlyConnected()) {
      lastConnectedAtMillis = System.currentTimeMillis()
    } else if (System.currentTimeMillis() - lastConnectedAtMillis >= OFFLINE_CUTOFF_MS) {
      // Self-enforces the cutoff by lifting the block, per ARCHITECTURE.md
      // §4 — JS only surfaces the resulting state when it wakes, it never
      // decides this. Deliberately does NOT decide session end_reason or
      // points (Money-Equivalent Logic Rule) — that's the server's job
      // once connectivity resumes and the client reconciles.
      AppBlockerModule.emitEvent(
        "offline_cutoff_reached",
        Arguments.createMap().apply {
          putString("sessionId", sessionId)
          putString("lastConnectedAt", Instant.ofEpochMilli(lastConnectedAtMillis).toString())
        },
      )
      markDeliberateStop()
      removeOverlay()
      stopSelf()
      return
    }

    if (!PermissionChecks.hasUsageAccess(this)) {
      emitPermissionRevoked("usage_access")
      return
    }
    if (!PermissionChecks.hasOverlayPermission(this)) {
      emitPermissionRevoked("overlay")
      removeOverlay()
      return
    }

    val foregroundPackage = currentForegroundPackageName()
    if (foregroundPackage == null || foregroundPackage == packageName) {
      removeOverlay()
      return
    }

    // Phase 9: a specific app wins over its category. Not just an order of
    // checks — it decides what the event says, and "Instagram is blocked"
    // is a better answer than "social is blocked" whenever we actually know
    // the host named that app.
    val category = categoryOf(foregroundPackage)
    val trigger: WritableMap? =
      when {
        foregroundPackage in blockedPackages ->
          Arguments.createMap().apply {
            putString("reason", "package")
            putString("packageName", foregroundPackage)
          }
        category != null && category in blockedAndroidCategories ->
          Arguments.createMap().apply {
            putString("reason", "category")
            putString("category", CategoryMapping.jsCategoryFor(category))
          }
        else -> null
      }

    if (trigger == null) {
      removeOverlay()
      return
    }

    showOverlay(foregroundPackage)
    AppBlockerModule.emitEvent(
      "shield_triggered",
      trigger.apply {
        putString("sessionId", sessionId)
        putString("at", Instant.now().toString())
      },
    )
  }

  private fun isCurrentlyConnected(): Boolean {
    val manager =
      runCatching { getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager }
        .getOrNull() ?: return true // fail-open: never cut off blocking over an inability to check
    val network = manager.activeNetwork ?: return false
    val capabilities = manager.getNetworkCapabilities(network) ?: return false
    return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
  }

  private fun emitPermissionRevoked(permission: String) {
    AppBlockerModule.emitEvent(
      "permission_revoked",
      Arguments.createMap().apply {
        putString("sessionId", sessionId)
        putString("permission", permission)
      },
    )
  }

  private fun categoryOf(packageName: String): Int? =
    try {
      packageManager.getApplicationInfo(packageName, 0).category
    } catch (error: Exception) {
      null
    }.takeIf { it != null && it != ApplicationInfo.CATEGORY_UNDEFINED }

  // Standard UsageStatsManager idiom for "what's in the foreground right
  // now": scan recent usage events for the most recent MOVE_TO_FOREGROUND,
  // over a short trailing window sized to the poll interval so a
  // fast app-switch is never missed between polls.
  private fun currentForegroundPackageName(): String? {
    val usageStatsManager = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val end = System.currentTimeMillis()
    val start = end - (POLL_INTERVAL_MS * 3)
    val events = usageStatsManager.queryEvents(start, end)
    // ACTIVITY_RESUMED replaced MOVE_TO_FOREGROUND in API 29; both signal
    // the same thing (an activity became foreground), so use whichever the
    // running OS actually reports.
    val foregroundEventType =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        android.app.usage.UsageEvents.Event.ACTIVITY_RESUMED
      } else {
        @Suppress("DEPRECATION")
        android.app.usage.UsageEvents.Event.MOVE_TO_FOREGROUND
      }
    var lastForegroundPackage: String? = null
    val event = android.app.usage.UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(event)
      if (event.eventType == foregroundEventType) {
        lastForegroundPackage = event.packageName
      }
    }
    return lastForegroundPackage
  }

  // The copy is resolved in JS and handed down at start() (plan §8), so the
  // overlay finally names what it blocked instead of showing one generic
  // sentence — and does it in the user's own language, which a Kotlin-built
  // TextView had no path to before.
  //
  // The label comes from PackageManager, which is the only place it exists:
  // the wire format carries package names only, precisely so nothing a host
  // types ever renders on a stranger's phone.
  private fun overlayTextFor(blockedPackage: String): String {
    val template = overlayBlockedAppTemplate
    val label =
      runCatching {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(blockedPackage, 0)).toString()
      }
        .getOrNull()
        ?.takeIf { it.isNotBlank() }

    if (template != null && label != null) {
      return template.replace("%s", label)
    }
    // Falls back to the generic line, then to the Android string resource —
    // the latter only reachable if a boot-restart found nothing persisted.
    return overlayBlockedGeneric ?: getString(R.string.blocker_notification_text)
  }

  private fun showOverlay(blockedPackage: String) {
    if (overlayView != null) return

    val windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val overlayType =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      } else {
        @Suppress("DEPRECATION")
        WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
      }

    val params =
      WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        overlayType,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.OPAQUE,
      )

    // Minimal native view, deliberately not a full RN screen (the JS thread
    // may be backgrounded/suspended while this overlay must still render
    // reliably) — a plain full-screen block with a return-to-app tap
    // target. No color palette dependency (deferred per CLAUDE.md); a
    // richer/branded overlay is a later pass, once a palette exists.
    val overlay =
      TextView(this).apply {
        text = overlayTextFor(blockedPackage)
        setBackgroundColor(0xFF111111.toInt())
        setTextColor(0xFFFFFFFF.toInt())
        textSize = 18f
        gravity = Gravity.CENTER
        setOnClickListener {
          val launchIntent =
            packageManager.getLaunchIntentForPackage(packageName)?.apply {
              addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            }
          if (launchIntent != null) startActivity(launchIntent)
        }
      }

    runCatching { windowManager.addView(overlay, params) }.onSuccess { overlayView = overlay }
  }

  private fun removeOverlay() {
    val view = overlayView ?: return
    val windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    runCatching { windowManager.removeView(view) }
    overlayView = null
  }

  private fun registerBatteryReceiver() {
    if (batteryReceiver != null) return
    val receiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          val batteryManager = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
          val level = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
          AppBlockerModule.emitEvent(
            "battery_critical",
            Arguments.createMap().apply {
              putString("sessionId", sessionId)
              putInt("level", level)
            },
          )
        }
      }
    registerReceiver(receiver, IntentFilter(Intent.ACTION_BATTERY_LOW))
    batteryReceiver = receiver
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel =
      NotificationChannel(
        NOTIFICATION_CHANNEL_ID,
        getString(R.string.blocker_notification_channel_name),
        NotificationManager.IMPORTANCE_LOW,
      )
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val contentIntent =
      packageManager.getLaunchIntentForPackage(packageName)?.let { launchIntent ->
        PendingIntent.getActivity(
          this,
          0,
          launchIntent,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
      }

    return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
      .setContentTitle(getString(R.string.blocker_notification_title))
      .setContentText(getString(R.string.blocker_notification_text))
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .setContentIntent(contentIntent)
      .build()
  }
}
