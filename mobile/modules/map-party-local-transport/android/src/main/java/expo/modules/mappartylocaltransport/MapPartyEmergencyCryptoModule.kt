package expo.modules.mappartylocaltransport

import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyFactory
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource

class MapPartyEmergencyCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MapPartyEmergencyCrypto")

    AsyncFunction("seal") { publicKeyPem: String, payloadBase64: String ->
      val pemBody = publicKeyPem
        .replace("-----BEGIN PUBLIC KEY-----", "")
        .replace("-----END PUBLIC KEY-----", "")
        .replace("\\s".toRegex(), "")
      val publicKey = KeyFactory.getInstance("RSA").generatePublic(
        X509EncodedKeySpec(Base64.decode(pemBody, Base64.DEFAULT))
      )
      val cipher = Cipher.getInstance("RSA/ECB/OAEPPadding")
      cipher.init(
        Cipher.ENCRYPT_MODE,
        publicKey,
        OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT)
      )
      Base64.encodeToString(
        cipher.doFinal(Base64.decode(payloadBase64, Base64.NO_WRAP)),
        Base64.NO_WRAP
      )
    }
  }
}
