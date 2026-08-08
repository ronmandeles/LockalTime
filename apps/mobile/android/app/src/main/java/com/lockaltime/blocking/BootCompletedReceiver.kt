package com.lockaltime.blocking

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import java.time.Instant
import java.time.format.DateTimeParseException

// Phase 3 task 3.4 (backlog.md): restarts the Foreground Service if a
// session was mid-flight at reboot (ARCHITECTURE.md §4 "Boot persistence").
// Only ever resumes what BootPersistence has (an unexpected teardown, never
// a deliberate stop() — see BlockerForegroundService.onDestroy) and never
// resumes a session whose endsAt has already passed while the device was
// off, since there's nothing left to enforce.
class BootCompletedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context?, intent: Intent?) {
    if (context == null || intent?.action != Intent.ACTION_BOOT_COMPLETED) {
      return
    }

    val persisted = BootPersistence.load(context) ?: return

    val endsAtMillis =
      persisted.endsAt?.let { raw ->
        try {
          Instant.parse(raw).toEpochMilli()
        } catch (error: DateTimeParseException) {
          null
        }
      }
    if (endsAtMillis != null && System.currentTimeMillis() >= endsAtMillis) {
      BootPersistence.clear(context)
      return
    }

    // Phase 9: the packages and the overlay copy resume from the same
    // snapshot. JS never runs on this path, so anything not persisted is
    // simply gone — omitting the packages would resume mid-session with a
    // partial blocklist, silently under-blocking exactly the apps the host
    // singled out by name.
    val startIntent =
      BlockerForegroundService.buildStartIntent(
        context,
        persisted.sessionId,
        persisted.endsAt,
        persisted.blockedCategories,
        persisted.blockedPackages,
        persisted.overlayBlockedApp,
        persisted.overlayBlockedGeneric,
      )
    ContextCompat.startForegroundService(context, startIntent)
  }
}
