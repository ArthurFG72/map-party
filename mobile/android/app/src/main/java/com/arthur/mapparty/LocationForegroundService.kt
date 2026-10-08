package com.arthur.mapparty

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

class LocationForegroundService : Service() {
  companion object {
    const val ACTION_LOCATION = "com.arthur.mapparty.LOCATION"
    const val EXTRA_MODE = "mode"
    private const val CHANNEL_ID = "mapparty-location"
    private const val NOTIFICATION_ID = 7403
  }

  private lateinit var fusedLocation: FusedLocationProviderClient
  private var mode = "tracking"
  private val callback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      result.locations.forEach { location ->
        sendBroadcast(Intent(ACTION_LOCATION).apply {
          setPackage(packageName)
          putExtra("latitude", location.latitude)
          putExtra("longitude", location.longitude)
          putExtra("accuracy", location.accuracy)
          putExtra("timestamp", location.time)
          if (location.hasSpeed()) putExtra("speed", location.speed)
          if (location.hasBearing()) putExtra("heading", location.bearing)
        })
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    fusedLocation = LocationServices.getFusedLocationProviderClient(this)
    createChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    mode = intent?.getStringExtra(EXTRA_MODE) ?: mode
    startForeground(NOTIFICATION_ID, notification())
    if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
      stopSelf()
      return START_NOT_STICKY
    }
    fusedLocation.removeLocationUpdates(callback)
    fusedLocation.requestLocationUpdates(request(), callback, Looper.getMainLooper())
    return START_STICKY
  }

  private fun request(): LocationRequest {
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

  private fun notification(): Notification = NotificationCompat.Builder(this, CHANNEL_ID)
    .setSmallIcon(android.R.drawable.ic_menu_mylocation)
    .setContentTitle("Passeio das Águias")
    .setContentText("Localização ativa para navegação")
    .setOngoing(true)
    .setCategory(NotificationCompat.CATEGORY_SERVICE)
    .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    .build()

  private fun createChannel() {
    getSystemService(NotificationManager::class.java)?.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Localização e navegação", NotificationManager.IMPORTANCE_LOW)
    )
  }

  override fun onDestroy() {
    fusedLocation.removeLocationUpdates(callback)
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
