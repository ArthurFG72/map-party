package com.arthur.mapparty

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import com.google.android.gms.nearby.connection.AdvertisingOptions
import org.json.JSONArray
import org.json.JSONObject
import java.util.LinkedHashSet
import java.util.UUID

class MapPartyLocalTransportModule(
  private val context: ReactApplicationContext
) : ReactContextBaseJavaModule(context), ActivityEventListener {
  companion object {
    private const val NAME = "MapPartyLocalTransport"
    private const val SERVICE_ID = "com.arthur.mapparty.offline"
    private const val PERMISSION_REQUEST = 7401
    private const val MAX_ENVELOPE_BYTES = 16 * 1024
    private const val MAX_TTL_MS = 180_000L
    private const val MAX_HOPS = 3
    private const val MAX_SEEN = 512
    private val STRATEGY = Strategy.P2P_CLUSTER
  }

  private val client: ConnectionsClient = Nearby.getConnectionsClient(context)
  private val pending = mutableSetOf<String>()
  private val connected = mutableSetOf<String>()
  private var roomId = ""
  private var participantId = ""
  private var running = false
  private var permissionPromise: Promise? = null
  private val seen = LinkedHashSet<String>()

  init { context.addActivityEventListener(this) }

  override fun getName() = NAME

  private fun emit(event: String, values: Map<String, String> = emptyMap()) {
    val payload = Arguments.createMap()
    values.forEach { (key, value) -> payload.putString(key, value) }
    context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, payload)
  }

  private fun permissions(): Array<String> = buildList {
    if (android.os.Build.VERSION.SDK_INT >= 31) {
      add(Manifest.permission.BLUETOOTH_SCAN)
      add(Manifest.permission.BLUETOOTH_CONNECT)
      add(Manifest.permission.BLUETOOTH_ADVERTISE)
      add(Manifest.permission.NEARBY_WIFI_DEVICES)
    } else add(Manifest.permission.ACCESS_FINE_LOCATION)
    if (android.os.Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
  }.toTypedArray()

  private fun hasPermissions(): Boolean = permissions().all {
    context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED
  }

  @ReactMethod
  fun requestPermissions(promise: Promise) {
    if (hasPermissions()) { promise.resolve(true); return }
    val activity = getCurrentActivity()
    if (activity == null) { promise.resolve(false); return }
    if (activity is PermissionAwareActivity) {
      permissionPromise = promise
      activity.requestPermissions(permissions(), PERMISSION_REQUEST, PermissionListener { requestCode, _, grantResults ->
        if (requestCode != PERMISSION_REQUEST) return@PermissionListener false
        val granted = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        permissionPromise?.resolve(granted)
        permissionPromise = null
        true
      })
    } else promise.resolve(false)
  }

  private val payloadCallback = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      val bytes = payload.asBytes() ?: return
      if (bytes.size > MAX_ENVELOPE_BYTES) return
      val json = runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }.getOrNull() ?: return
      if (!validEnvelope(json)) return
      val messageId = json.optString("messageId")
      synchronized(seen) {
        if (!seen.add(messageId)) return
        while (seen.size > MAX_SEEN) seen.remove(seen.first())
      }
      emit("message", mapOf("json" to json.toString(), "endpointId" to endpointId))
      val hops = json.optInt("hops", 0)
      if (hops < MAX_HOPS && connected.size > 1) {
        json.put("hops", hops + 1)
        val relay = Payload.fromBytes(json.toString().toByteArray(Charsets.UTF_8))
        connected.filter { it != endpointId }.let { peers -> if (peers.isNotEmpty()) client.sendPayload(peers, relay) }
      }
    }

    override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) = Unit
  }

  private val lifecycleCallback = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
      pending.add(endpointId)
      emit("connectionVerification", mapOf("endpointId" to endpointId, "authenticationToken" to info.authenticationToken))
    }

    override fun onConnectionResult(endpointId: String, resolution: ConnectionResolution) {
      pending.remove(endpointId)
      if (resolution.status.isSuccess) {
        connected.add(endpointId)
        emit("connected", mapOf("endpointId" to endpointId, "state" to "connected"))
      } else emit("connectionFailed", mapOf("endpointId" to endpointId, "state" to "failed"))
    }

    override fun onDisconnected(endpointId: String) {
      pending.remove(endpointId)
      connected.remove(endpointId)
      emit("disconnected", mapOf("endpointId" to endpointId, "state" to "disconnected"))
    }
  }

  private val discoveryCallback = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(endpointId: String, info: com.google.android.gms.nearby.connection.DiscoveredEndpointInfo) {
      if (info.serviceId != SERVICE_ID || endpointId in connected || endpointId in pending) return
      pending.add(endpointId)
      client.requestConnection(participantId, endpointId, lifecycleCallback)
        .addOnFailureListener { pending.remove(endpointId); emit("connectionFailed", mapOf("endpointId" to endpointId)) }
    }

    override fun onEndpointLost(endpointId: String) {
      connected.remove(endpointId)
      emit("disconnected", mapOf("endpointId" to endpointId, "state" to "lost"))
    }
  }

  @ReactMethod
  fun start(options: ReadableMap, promise: Promise?) {
    roomId = if (options.hasKey("roomId")) options.getString("roomId") ?: "" else ""
    participantId = if (options.hasKey("participantId")) options.getString("participantId") ?: "participant" else "participant"
    if (roomId.isEmpty() || !hasPermissions()) { emit("permissionsRequired"); promise?.resolve(false); return }
    stopInternal()
    synchronized(seen) { seen.clear() }
    running = true
    val advertising = AdvertisingOptions.Builder().setStrategy(STRATEGY).build()
    val discovery = DiscoveryOptions.Builder().setStrategy(STRATEGY).build()
    client.startAdvertising(participantId, SERVICE_ID, lifecycleCallback, advertising)
      .addOnFailureListener { emit("error", mapOf("message" to "advertising_failed")) }
    client.startDiscovery(SERVICE_ID, discoveryCallback, discovery)
      .addOnFailureListener { emit("error", mapOf("message" to "discovery_failed")) }
    promise?.resolve(true)
  }

  @ReactMethod
  fun stop(promise: Promise?) { stopInternal(); promise?.resolve(true) }

  private fun stopInternal() {
    if (!running) return
    client.stopAdvertising()
    client.stopDiscovery()
    connected.forEach { client.disconnectFromEndpoint(it) }
    connected.clear(); pending.clear(); synchronized(seen) { seen.clear() }; running = false
  }

  @ReactMethod
  fun send(message: ReadableMap, promise: Promise?) {
    if (!running || connected.isEmpty()) { promise?.resolve(false); return }
    val objectToSend = toJson(message)
    val now = System.currentTimeMillis()
    objectToSend.put("roomId", roomId)
    if (!objectToSend.has("messageId") || objectToSend.optString("messageId").isBlank()) objectToSend.put("messageId", "local-${now}-${UUID.randomUUID()}")
    if (!objectToSend.has("createdAt")) objectToSend.put("createdAt", now)
    objectToSend.put("expiresAt", minOf(objectToSend.optLong("expiresAt", now + MAX_TTL_MS), now + MAX_TTL_MS))
    objectToSend.put("hops", objectToSend.optInt("hops", 0).coerceIn(0, MAX_HOPS))
    val json = objectToSend.toString().toByteArray(Charsets.UTF_8)
    if (json.size > MAX_ENVELOPE_BYTES) { promise?.resolve(false); return }
    val payload = Payload.fromBytes(json)
    client.sendPayload(connected.toList(), payload)
      .addOnSuccessListener { promise?.resolve(true) }
      .addOnFailureListener { promise?.resolve(false) }
  }

  private fun validEnvelope(json: JSONObject): Boolean {
    if (json.optString("roomId") != roomId) return false
    val messageId = json.optString("messageId")
    if (messageId.isBlank() || messageId.length > 96) return false
    val expiresAt = json.optLong("expiresAt", 0L)
    val hops = json.optInt("hops", -1)
    return expiresAt > System.currentTimeMillis() && hops in 0..MAX_HOPS
  }

  @ReactMethod
  fun acceptConnection(endpointId: String, accepted: Boolean, promise: Promise?) {
    if (!accepted) {
      client.rejectConnection(endpointId)
      pending.remove(endpointId)
      promise?.resolve(true)
      return
    }
    client.acceptConnection(endpointId, payloadCallback)
      .addOnSuccessListener { promise?.resolve(true) }
      .addOnFailureListener { promise?.resolve(false) }
  }

  private fun toJson(map: ReadableMap): JSONObject {
    val result = JSONObject()
    val iterator = map.keySetIterator()
    while (iterator.hasNextKey()) {
      val key = iterator.nextKey()
      result.put(key, when (map.getType(key)) {
        ReadableType.Null -> JSONObject.NULL
        ReadableType.Boolean -> map.getBoolean(key)
        ReadableType.Number -> map.getDouble(key)
        ReadableType.String -> map.getString(key)
        ReadableType.Map -> toJson(map.getMap(key)!!)
        ReadableType.Array -> toJsonArray(map.getArray(key)!!)
      })
    }
    return result
  }

  private fun toJsonArray(array: com.facebook.react.bridge.ReadableArray): JSONArray {
    val result = JSONArray()
    for (index in 0 until array.size()) {
      result.put(when (array.getType(index)) {
        ReadableType.Null -> JSONObject.NULL
        ReadableType.Boolean -> array.getBoolean(index)
        ReadableType.Number -> array.getDouble(index)
        ReadableType.String -> array.getString(index)
        ReadableType.Map -> toJson(array.getMap(index)!!)
        ReadableType.Array -> toJsonArray(array.getArray(index)!!)
      })
    }
    return result
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) = Unit

  override fun onNewIntent(intent: Intent) = Unit
}
