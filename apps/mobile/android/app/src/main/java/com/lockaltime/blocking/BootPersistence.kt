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
object BootPersistence {
  private const val PREFS_FILE_NAME = "lockal_time_blocker_session"
  private const val KEY_SESSION_ID = "sessionId"
  private const val KEY_ENDS_AT = "endsAt"
  private const val KEY_BLOCKED_CATEGORIES = "blockedCategories"
  private const val CATEGORY_DELIMITER = ","

  data class PersistedSession(
    val sessionId: String,
    val endsAt: String?,
    val blockedCategories: List<String>,
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

  fun save(context: Context, sessionId: String, endsAt: String?, blockedCategories: List<String>) {
    runCatching {
      prefs(context)
        .edit()
        .putString(KEY_SESSION_ID, sessionId)
        .putString(KEY_ENDS_AT, endsAt)
        .putString(KEY_BLOCKED_CATEGORIES, blockedCategories.joinToString(CATEGORY_DELIMITER))
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
        val endsAt = store.getString(KEY_ENDS_AT, null)
        val categories =
          store.getString(KEY_BLOCKED_CATEGORIES, null)?.split(CATEGORY_DELIMITER)?.filter { it.isNotEmpty() }
            ?: emptyList()
        PersistedSession(sessionId, endsAt, categories)
      }
      .getOrNull()
}
