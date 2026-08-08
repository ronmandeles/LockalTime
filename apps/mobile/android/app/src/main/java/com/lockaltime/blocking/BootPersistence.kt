package com.lockaltime.blocking

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

// Phase 3 task 3.4 (backlog.md): persists the active session's blocker
// config to encrypted local storage — not just Supabase, since the device
// may boot offline (ARCHITECTURE.md §4 "Boot persistence"). Written by
// BlockerForegroundService whenever a session starts, cleared whenever it
// stops deliberately (JS stop() or the local endsAt-reached self-stop —
// both mean "nothing to resume"); read by BootCompletedReceiver on
// BOOT_COMPLETED to decide whether to restart the service.
//
// Phase 9: carries the blocked PACKAGES and the overlay copy too. Both are
// load-bearing on this path specifically — a reboot restarts the service
// without JS ever running, so anything not persisted here is simply absent.
// Missing the packages would resume mid-session with a partial blocklist
// (silently under-blocking); missing the copy would show an empty overlay.
object BootPersistence {
  private const val PREFS_FILE_NAME = "lockal_time_blocker_session"
  private const val KEY_SESSION_ID = "sessionId"
  private const val KEY_ENDS_AT = "endsAt"
  private const val KEY_BLOCKED_CATEGORIES = "blockedCategories"
  private const val KEY_BLOCKED_PACKAGES = "blockedPackages"
  private const val KEY_OVERLAY_BLOCKED_APP = "overlayBlockedApp"
  private const val KEY_OVERLAY_BLOCKED_GENERIC = "overlayBlockedGeneric"

  // Safe as a separator for both kinds of value: a category is drawn from a
  // fixed comma-free vocabulary, and a package name cannot contain a comma
  // (the server's own regex enforces that at the API boundary).
  private const val DELIMITER = ","

  data class PersistedSession(
    val sessionId: String,
    val endsAt: String?,
    val blockedCategories: List<String>,
    val blockedPackages: List<String>,
    val overlayBlockedApp: String?,
    val overlayBlockedGeneric: String?,
  )

  private fun prefs(context: Context): SharedPreferences {
    val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
    return EncryptedSharedPreferences.create(
      context,
      PREFS_FILE_NAME,
      masterKey,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
  }

  fun save(
    context: Context,
    sessionId: String,
    endsAt: String?,
    blockedCategories: List<String>,
    blockedPackages: List<String>,
    overlayBlockedApp: String?,
    overlayBlockedGeneric: String?,
  ) {
    runCatching {
      prefs(context)
        .edit()
        .putString(KEY_SESSION_ID, sessionId)
        .putString(KEY_ENDS_AT, endsAt)
        .putString(KEY_BLOCKED_CATEGORIES, blockedCategories.joinToString(DELIMITER))
        .putString(KEY_BLOCKED_PACKAGES, blockedPackages.joinToString(DELIMITER))
        .putString(KEY_OVERLAY_BLOCKED_APP, overlayBlockedApp)
        .putString(KEY_OVERLAY_BLOCKED_GENERIC, overlayBlockedGeneric)
        .apply()
    }
  }

  fun clear(context: Context) {
    runCatching { prefs(context).edit().clear().apply() }
  }

  fun load(context: Context): PersistedSession? =
    runCatching {
        val store = prefs(context)
        val sessionId = store.getString(KEY_SESSION_ID, null) ?: return@runCatching null
        PersistedSession(
          sessionId = sessionId,
          endsAt = store.getString(KEY_ENDS_AT, null),
          blockedCategories = store.readList(KEY_BLOCKED_CATEGORIES),
          blockedPackages = store.readList(KEY_BLOCKED_PACKAGES),
          overlayBlockedApp = store.getString(KEY_OVERLAY_BLOCKED_APP, null),
          overlayBlockedGeneric = store.getString(KEY_OVERLAY_BLOCKED_GENERIC, null),
        )
      }
      .getOrNull()

  private fun SharedPreferences.readList(key: String): List<String> =
    getString(key, null)?.split(DELIMITER)?.filter { it.isNotEmpty() } ?: emptyList()
}
