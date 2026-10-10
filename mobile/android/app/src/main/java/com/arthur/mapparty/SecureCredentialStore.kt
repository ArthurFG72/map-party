package com.arthur.mapparty

import android.content.Context
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object SecureCredentialStore {
  private const val KEYSTORE = "AndroidKeyStore"
  private const val KEY_ALIAS = "mapparty.background.credential"
  private const val PREFS = "mapparty-background-location"
  private const val ENCRYPTED = "credential_ciphertext"
  private const val LEGACY = "credential"

  private fun key(): SecretKey {
    val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance("AES", KEYSTORE)
    generator.init(256)
    return generator.generateKey()
  }

  fun save(context: Context, credential: String) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val ciphertext = cipher.doFinal(credential.toByteArray(StandardCharsets.UTF_8))
    val encrypted = ByteArray(cipher.iv.size + ciphertext.size)
    cipher.iv.copyInto(encrypted, 0)
    ciphertext.copyInto(encrypted, cipher.iv.size)
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString(ENCRYPTED, Base64.encodeToString(encrypted, Base64.NO_WRAP))
      .remove(LEGACY)
      .apply()
  }

  fun load(context: Context): String? {
    val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val encoded = preferences.getString(ENCRYPTED, null)
    if (encoded != null) {
      return try {
        val encrypted = Base64.decode(encoded, Base64.NO_WRAP)
        val iv = encrypted.copyOfRange(0, 12)
        val payload = encrypted.copyOfRange(12, encrypted.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        String(cipher.doFinal(payload), StandardCharsets.UTF_8)
      } catch (_: Exception) { null }
    }
    return preferences.getString(LEGACY, null)?.also { save(context, it) }
  }
}
