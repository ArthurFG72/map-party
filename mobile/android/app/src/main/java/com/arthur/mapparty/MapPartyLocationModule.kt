package com.arthur.mapparty

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.os.Build
import android.content.pm.PackageManager
import android.location.Location
import android.os.Bundle
import android.os.Looper
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import androidx.core.content.ContextCompat

class MapPartyLocationModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), ActivityEventListener {
  companion object {
    private const val REQUEST = 7402
    private const val MAX_LOCATION_AGE_MS = 120_000L
  }
  private val fusedLocation: FusedLocationProviderClient = LocationServices.getFusedLocationProviderClient(context)
  private var mode = "tracking"
  private fun buildRequest(): LocationRequest {
    val navigation = mode == "navigation" || mode == "boat"
    val interval = when (mode) { "navigation" -> 2_000L; "boat" -> 3_000L; else -> 8_000L }
    val distance = when (mode) { "navigation" -> 3f; "boat" -> 5f; else -> 10f }
    return LocationRequest.Builder(if (navigation) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY, interval)
      .setMinUpdateIntervalMillis(if (navigation) interval / 2 else interval)
      .setMinUpdateDistanceMeters(distance)
      .setWaitForAccurateLocation(navigation)
      .setMaxUpdateDelayMillis(interval)
      .build()
  }
  private var request = buildRequest()
  private var running = false
  private val locationReceiver = object : BroadcastReceiver() {
    override fun onReceive(receiverContext: Context, intent: Intent) {
      if (intent.action != LocationForegroundService.ACTION_LOCATION) return
      val value = Arguments.createMap()
      value.putDouble("latitude", intent.getDoubleExtra("latitude", Double.NaN))
      value.putDouble("longitude", intent.getDoubleExtra("longitude", Double.NaN))
      value.putDouble("accuracy", intent.getFloatExtra("accuracy", 0f).toDouble())
      value.putDouble("timestamp", intent.getLongExtra("timestamp", 0L).toDouble())
      if (intent.hasExtra("speed")) value.putDouble("speed", intent.getFloatExtra("speed", 0f).toDouble())
      if (intent.hasExtra("heading")) value.putDouble("heading", intent.getFloatExtra("heading", 0f).toDouble())
      context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("MapPartyLocation", value)
    }
  }

  init {
    val filter = IntentFilter(LocationForegroundService.ACTION_LOCATION)
    if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(locationReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    else context.registerReceiver(locationReceiver, filter)
  }

  override fun getName() = "MapPartyLocation"

  private fun hasPermission() = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  private fun emit(location: Location) {
    val age = System.currentTimeMillis() - location.time
    if (age < -30_000L || age > MAX_LOCATION_AGE_MS) return
    val value = Arguments.createMap()
    value.putDouble("latitude", location.latitude)
    value.putDouble("longitude", location.longitude)
    value.putDouble("accuracy", location.accuracy.toDouble())
    value.putDouble("timestamp", location.time.toDouble())
    if (location.hasSpeed()) value.putDouble("speed", location.speed.toDouble())
    if (location.hasBearing()) value.putDouble("heading", location.bearing.toDouble())
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("MapPartyLocation", value)
  }

  private val callback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      result.locations.forEach(::emit)
    }
  }

  @ReactMethod
  fun isPermissionGranted(promise: Promise) { promise.resolve(hasPermission()) }

  @ReactMethod
  fun setMode(value: String, promise: Promise) {
    mode = value
    request = buildRequest()
    if (running) ContextCompat.startForegroundService(context, Intent(context, LocationForegroundService::class.java).putExtra(LocationForegroundService.EXTRA_MODE, mode))
    promise.resolve(true)
  }

  @ReactMethod
  fun requestPermission(promise: Promise) {
    if (hasPermission()) { promise.resolve(true); return }
    val activity = getCurrentActivity()
    if (activity !is PermissionAwareActivity) { promise.resolve(false); return }
    activity.requestPermissions(
      arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
      REQUEST,
      PermissionListener { code, _, results ->
        if (code != REQUEST) return@PermissionListener false
        promise.resolve(results.any { it == PackageManager.PERMISSION_GRANTED })
        true
      }
    )
  }

  @ReactMethod
  fun start(promise: Promise) {
    if (!hasPermission()) { promise.reject("LOCATION_PERMISSION", "Permissão de localização não concedida"); return }
    stopInternal()
    try {
      ContextCompat.startForegroundService(context, Intent(context, LocationForegroundService::class.java).putExtra(LocationForegroundService.EXTRA_MODE, mode))
      running = true
      promise.resolve(true)
    } catch (error: SecurityException) {
      promise.reject("LOCATION_PERMISSION", error.message, error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise?) { stopInternal(); promise?.resolve(true) }

  private fun stopInternal() {
    if (!running) return
    fusedLocation.removeLocationUpdates(callback)
    context.stopService(Intent(context, LocationForegroundService::class.java))
    running = false
  }

  override fun onCatalystInstanceDestroy() {
    stopInternal()
    context.unregisterReceiver(locationReceiver)
    super.onCatalystInstanceDestroy()
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) = Unit
  override fun onNewIntent(intent: Intent) = Unit
}
