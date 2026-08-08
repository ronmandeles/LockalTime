package com.lockaltime.blocking

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

// Answers one narrow question per app: **is this specific package
// installed?** (docs/BLOCKLIST_SELECTION_PLAN.md §8.)
//
// **This used to enumerate every launchable app on the device.** It stopped
// (owner decision 2026-08-08, superseding the full-enumeration choice of
// 2026-08-07): Android and iOS now offer the same fixed, bundled catalog
// (src/config/app-catalog.json), and this module only filters that catalog
// down to what the host actually has — exactly what iOS does with
// canOpenURL. Two consequences, both wanted:
//
//   * The picker is the same product on both platforms.
//   * QUERY_ALL_PACKAGES is gone. It is a RESTRICTED permission needing a
//     Play Console declaration that takes weeks and can be refused; the
//     manifest's <queries> block is the sanctioned narrow alternative and
//     needs no declaration at all. Once the catalog is the only source of
//     app names, full enumeration bought nothing but that risk.
//
// Every package this can see is one the manifest's <queries> block names,
// which is generated from the catalog. Asking about anything else simply
// reports "not installed" — the OS filters it, not this code. That is also
// why there is no safety-denylist filtering here any more: the queryable
// set IS the catalog, and the catalog is asserted denylist-free by
// app-catalog.test.ts.
//
// Runs off the main thread on a plain single-thread executor rather than
// pulling in kotlinx-coroutines for two call sites (the repo has no
// coroutines dependency; BlockerForegroundService uses a Handler for the
// same reason).
class InstalledAppsModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "InstalledAppsModule"

  private val executor = Executors.newSingleThreadExecutor()

  /// Which of the given packages are present. Returns the installed subset,
  /// never an error — an unanswerable question resolves to "not in the
  /// list", and the JS seam reads a missing entry as "unknown" rather than
  /// as absence.
  @ReactMethod
  fun getInstalledPackages(packageNames: ReadableArray, promise: Promise) {
    executor.execute {
      val installed = Arguments.createArray()
      val packageManager = reactApplicationContext.packageManager

      for (index in 0 until packageNames.size()) {
        val packageName = packageNames.getString(index) ?: continue
        // Per-package, so one odd entry costs only itself. A package outside
        // the <queries> block throws NameNotFoundException exactly as an
        // uninstalled one does — indistinguishable by design, which is the
        // privacy property the block exists to provide.
        val isInstalled =
          runCatching { packageManager.getApplicationInfo(packageName, 0) }.isSuccess
        if (isInstalled) {
          installed.pushString(packageName)
        }
      }

      promise.resolve(installed)
    }
  }

  // Icons for the visible window only. The plan (§8) corrected an earlier
  // design that returned them inline with the list: ~200 apps x a 96px PNG
  // is 1.5-3 MB of base64 across the bridge in one payload, which will
  // jank. Still windowed even though the catalog is bounded at 87 — the
  // cost is per-icon decode work, not list length.
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
