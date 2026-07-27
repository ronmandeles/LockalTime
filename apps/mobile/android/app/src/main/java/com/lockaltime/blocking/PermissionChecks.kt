package com.lockaltime.blocking

import android.app.AppOpsManager
import android.content.Context
import android.provider.Settings

// Shared Usage Access / Overlay checks — used by both
// BlockingPermissionsModule (Screen 2's grant flow, task 3.2) and
// BlockerForegroundService (self-polls for a revoked grant mid-session,
// task 3.3), so the two never drift on what "granted" means.
object PermissionChecks {
  fun hasUsageAccess(context: Context): Boolean {
    val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode =
      appOps.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS,
        android.os.Process.myUid(),
        context.packageName,
      )
    return mode == AppOpsManager.MODE_ALLOWED
  }

  fun hasOverlayPermission(context: Context): Boolean = Settings.canDrawOverlays(context)
}
