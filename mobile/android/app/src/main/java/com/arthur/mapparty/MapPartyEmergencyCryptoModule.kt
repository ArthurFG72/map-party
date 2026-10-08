package com.arthur.mapparty

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyFactory
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource

class MapPartyEmergencyCryptoModule(
  context: ReactApplicationContext
) : ReactContextBaseJavaModule(context) {
  override fun getName() = "MapPartyEmergencyCrypto"

  @ReactMethod
  fun seal(publicKeyPem: String, payloadBase64: String, promise: Promise) {
    try {
      val pemBody = publicKeyPem
        .replace("-----BEGIN PUBLIC KEY-----", "")
        .replace("-----END PUBLIC KEY-----", "")
        .replace("\\s".toRegex(), "")
      val keyBytes = Base64.decode(pemBody, Base64.DEFAULT)
      val publicKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(keyBytes))
      val oaep = OAEPParameterSpec(
        "SHA-256",
        "MGF1",
        MGF1ParameterSpec.SHA256,
        PSource.PSpecified.DEFAULT
      )
      val cipher = Cipher.getInstance("RSA/ECB/OAEPPadding")
      cipher.init(Cipher.ENCRYPT_MODE, publicKey, oaep)
      val payload = Base64.decode(payloadBase64, Base64.NO_WRAP)
      promise.resolve(Base64.encodeToString(cipher.doFinal(payload), Base64.NO_WRAP))
    } catch (error: Exception) {
      promise.reject("SOS_CRYPTO_FAILED", "Não foi possível criptografar o SOS.", error)
    }
  }
}
