package com.arthur.mapparty

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.os.Looper
import android.content.SharedPreferences
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import org.json.JSONObject

class LocationForegroundService : Service() {
  companion object {
    const val ACTION_LOCATION = "com.arthur.mapparty.LOCATION"
    const val EXTRA_MODE = "mode"
    private const val CHANNEL_ID = "mapparty-location"
    private const val NOTIFICATION_ID = 7403
    private const val PREFS = "mapparty-background-location"
    private const val PENDING = "pending"
    private const val SEQUENCE = "sequence"
  }

  private lateinit var fusedLocation: FusedLocationProviderClient
  private lateinit var preferences: SharedPreferences
  private val uploadExecutor = Executors.newSingleThreadExecutor()
  private val retryHandler = android.os.Handler(Looper.getMainLooper())
  @Volatile private var uploadInFlight = false
  @Volatile private var nextRetryAt = 0L
  @Volatile private var retryDelayMs = 0L
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
        uploadLocation(location)
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    preferences = getSharedPreferences(PREFS, MODE_PRIVATE)
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
    dispatchPending()
    return START_STICKY
  }

  private fun uploadLocation(location: android.location.Location) {
    val sequence = maxOf(preferences.getLong(SEQUENCE, 0L) + 1L, System.currentTimeMillis())
    preferences.edit().putLong(SEQUENCE, sequence).apply()
    val body = JSONObject().apply {
      put("contractVersion", 1)
      put("locationSequence", sequence)
      put("lat", location.latitude)
      put("lng", location.longitude)
      put("accuracy", location.accuracy.toDouble())
      put("timestamp", location.time)
      put("forceBroadcast", true)
      if (location.hasSpeed()) put("speed", location.speed.toDouble())
      if (location.hasBearing()) put("heading", location.bearing.toDouble())
    }.toString()
    preferences.edit().putString(PENDING, body).apply()
    dispatchPending()
  }

  private fun dispatchPending() {
    if (uploadInFlight || System.currentTimeMillis() < nextRetryAt) return
    val serverUrl = preferences.getString("serverUrl", null)?.trimEnd('/') ?: return
    val roomId = preferences.getString("roomId", null) ?: return
    val deviceId = preferences.getString("deviceId", null) ?: return
    val credential = SecureCredentialStore.load(this) ?: return
    val pending = preferences.getString(PENDING, null) ?: return
    uploadInFlight = true
    uploadExecutor.execute {
      var delivered = false
      val connection = (URL("$serverUrl/api/party/$roomId/location").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 5_000
        readTimeout = 5_000
        doOutput = true
        setRequestProperty("Authorization", "Bearer $credential")
        setRequestProperty("X-Device-ID", deviceId)
        setRequestProperty("Content-Type", "application/json")
      }
      try {
        connection.outputStream.use { it.write(pending.toByteArray(Charsets.UTF_8)) }
        if (connection.responseCode in 200..299 && preferences.getString(PENDING, null) == pending) {
          preferences.edit().remove(PENDING).apply()
          delivered = true
        }
      } catch (_: Exception) {
        // Keep the latest valid fix for the next native callback/restart.
      } finally {
        connection.disconnect()
        uploadInFlight = false
        if (delivered) {
          retryDelayMs = 0L
          nextRetryAt = 0L
          if (preferences.getString(PENDING, null) != null) dispatchPending()
        } else {
          retryDelayMs = if (retryDelayMs == 0L) 5_000L else minOf(retryDelayMs * 2L, 60_000L)
          nextRetryAt = System.currentTimeMillis() + retryDelayMs
          retryHandler.postDelayed({
            nextRetryAt = 0L
            dispatchPending()
          }, retryDelayMs)
        }
      }
    }
  }

  private fun request(): LocationRequest {
    val navigation = mode == "navigation" || mode == "boat"
    val interval = when (mode) { "navigation" -> 2_000L; "boat" -> 3_000L; else -> 15_000L }
    val distance = when (mode) { "navigation" -> 3f; "boat" -> 5f; else -> 20f }
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
    retryHandler.removeCallbacksAndMessages(null)
    uploadExecutor.shutdownNow()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
