package com.lockaltime.blocking

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

// ReactPackage's createNativeModules override triggers a spurious
// "overrides a deprecated member" warning under this RN/AGP version even
// though ReactPackage itself is the standard, supported registration
// interface (matches BlockingPermissionsPackage.kt).
@Suppress("DEPRECATION")
class AppBlockerPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    // InstalledAppsModule rides along in this package rather than getting
    // its own: it is part of the same blocking feature, and one more
    // ReactPackage in MainApplication buys nothing (Phase 9 task 4).
    listOf(AppBlockerModule(reactContext), InstalledAppsModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
