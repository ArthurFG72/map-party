package com.arthur.mapparty

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class MapPartyNativePackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(
    MapPartyLocalTransportModule(context),
    MapPartyEmergencyCryptoModule(context),
    MapPartyLocationModule(context)
  )

  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
