package com.lockaltime.blocking

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.provider.Telephony
import android.telecom.TelecomManager
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

// The host's actually-installed apps, for the Create Session picker
// (docs/BLOCKLIST_SELECTION_PLAN.md §8). Android-only by nature, not by
// omission: iOS offers no enumeration at all, which is why JS reads this
// through blockable-app-source.ts rather than calling it directly.
//
// Requires QUERY_ALL_PACKAGES (AndroidManifest.xml), a RESTRICTED
// permission needing a Play Console declaration that takes weeks and can be
// refused (§10). Nothing here throws on that: a failure resolves to an
// empty list, which the JS seam reads as "fall back to the bundled
// catalog" — the mitigation is already built rather than hypothetical.
//
// Both methods run off the main thread on a plain single-thread executor
// rather than pulling in kotlinx-coroutines for two call sites (the repo
// has no coroutines dependency; BlockerForegroundService uses a Handler for
// the same reason). getInstalledApps touches PackageManager once per
// installed package and getIcons decodes bitmaps — neither belongs on the
// UI thread.
class InstalledAppsModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "InstalledAppsModule"

  private val executor = Executors.newSingleThreadExecutor()

  // Never blockable — and this is the LAST line of defence, not the only
  // one. The JS seam filters its own static copy (src/config/
  // blocklist-safety.ts) and the server refuses these at the API boundary.
  // What only this layer can add is the DEVICE-ACCURATE part: the default
  // dialer and SMS app differ per device, so a static list is guesswork
  // about precisely the app someone might need in an emergency.
  private fun neverBlockable(): Set<String> {
    val packages = mutableSetOf(reactApplicationContext.packageName)
    runCatching {
      reactApplicationContext.getSystemService(TelecomManager::class.java)?.defaultDialerPackage
    }
      .getOrNull()
      ?.let { packages.add(it) }
    runCatching { Telephony.Sms.getDefaultSmsPackage(reactApplicationContext) }
      .getOrNull()
      ?.let { packages.add(it) }
    return packages
  }

  @ReactMethod
  fun getInstalledApps(promise: Promise) {
    executor.execute {
      // Resolve empty rather than reject: to the JS seam an empty list and
      // a failure mean the same thing (use the catalog), and empty is the
      // shape it already handles.
      val apps = runCatching { collectInstalledApps() }.getOrElse { Arguments.createArray() }
      promise.resolve(apps)
    }
  }

  private fun collectInstalledApps(): WritableArray {
    val packageManager = reactApplicationContext.packageManager
    val excluded = neverBlockable()
    val result = Arguments.createArray()

    // Filtering to apps with a LAUNCHER intent is doing real work here, not
    // tidying: it drops the hundreds of system services and headless
    // providers a raw getInstalledApplications() returns, none of which a
    // person could open or would recognise in a picker.
    val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val launchable = packageManager.queryIntentActivities(launcherIntent, 0)

    val seen = mutableSetOf<String>()
    launchable.forEach { resolveInfo ->
      val packageName = resolveInfo.activityInfo?.packageName ?: return@forEach
      if (packageName in excluded || !seen.add(packageName)) {
        return@forEach
      }
      val applicationInfo =
        runCatching { packageManager.getApplicationInfo(packageName, 0) }.getOrNull()
          ?: return@forEach

      val entry: WritableMap = Arguments.createMap()
      entry.putString("packageName", packageName)
      entry.putString("label", packageManager.getApplicationLabel(applicationInfo).toString())
      // Null, not a placeholder, when Android has no opinion.
      // CATEGORY_UNDEFINED is common: the field is developer-declared and
      // inconsistently populated (ARCHITECTURE.md §4). JS keeps such an app
      // pickable by name; it simply isn't covered by a category toggle.
      val jsCategory = CategoryMapping.jsCategoryFor(applicationInfo.category)
      if (jsCategory == null) {
        entry.putNull("category")
      } else {
        entry.putString("category", jsCategory)
      }
      result.pushMap(entry)
    }

    return result
  }

  // Icons for the visible window only. The plan (§8) corrected an earlier
  // design that returned them inline with the list: ~200 apps x a 96px PNG
  // is 1.5-3 MB of base64 across the bridge in one payload, which will
  // jank. If windowing proves insufficient, the next step is a native view
  // that renders the Drawable directly and transfers nothing at all.
  @ReactMethod
  fun getIcons(packageNames: ReadableArray, promise: Promise) {
    executor.execute {
      val icons = Arguments.createMap()
      val packageManager = reactApplicationContext.packageManager

      for (index in 0 until packageNames.size()) {
        val packageName = packageNames.getString(index) ?: continue
        // Per-icon, so one undecodable drawable costs its own row rather
        // than the whole window.
        runCatching {
          icons.putString(packageName, packageManager.getApplicationIcon(packageName).toDataUri())
        }
      }

      promise.resolve(icons)
    }
  }

  private fun Drawable.toDataUri(): String {
    val source = this
    val rendered =
      if (source is BitmapDrawable && source.bitmap != null) {
        source.bitmap
      } else {
        // Adaptive icons are not BitmapDrawables and carry no intrinsic
        // size worth trusting; ICON_SIZE_PX caps them so one oversized
        // icon can't blow the payload the windowing exists to bound.
        val width = source.intrinsicWidth.coerceIn(1, ICON_SIZE_PX)
        val height = source.intrinsicHeight.coerceIn(1, ICON_SIZE_PX)
        Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { output ->
          val canvas = Canvas(output)
          source.setBounds(0, 0, canvas.width, canvas.height)
          source.draw(canvas)
        }
      }

    val stream = ByteArrayOutputStream()
    rendered.compress(Bitmap.CompressFormat.PNG, 100, stream)
    return "data:image/png;base64," + Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
  }

  private companion object {
    const val ICON_SIZE_PX = 96
  }
}
