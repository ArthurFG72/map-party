import ExpoModulesCore
import Foundation
import Security

public final class MapPartyEmergencyCryptoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MapPartyEmergencyCrypto")

    AsyncFunction("seal") { (publicKeyPem: String, payloadBase64: String) throws -> String in
      let pemBody = publicKeyPem
        .replacingOccurrences(of: "-----BEGIN PUBLIC KEY-----", with: "")
        .replacingOccurrences(of: "-----END PUBLIC KEY-----", with: "")
        .components(separatedBy: .whitespacesAndNewlines)
        .joined()
      guard let keyData = Data(base64Encoded: pemBody),
            let payload = Data(base64Encoded: payloadBase64) else {
        throw NSError(domain: "MapPartyEmergencyCrypto", code: 1, userInfo: [NSLocalizedDescriptionKey: "Chave ou pacote SOS inválido."])
      }
      let attributes: [CFString: Any] = [
        kSecAttrKeyType: kSecAttrKeyTypeRSA,
        kSecAttrKeyClass: kSecAttrKeyClassPublic,
        kSecAttrKeySizeInBits: 2048
      ]
      var keyError: Unmanaged<CFError>?
      guard let publicKey = SecKeyCreateWithData(keyData as CFData, attributes as CFDictionary, &keyError) else {
        throw (keyError?.takeRetainedValue() as Error?) ?? NSError(domain: "MapPartyEmergencyCrypto", code: 2, userInfo: [NSLocalizedDescriptionKey: "Chave pública SOS inválida."])
      }
      let algorithm = SecKeyAlgorithm.rsaEncryptionOAEPSHA256
      guard SecKeyIsAlgorithmSupported(publicKey, .encrypt, algorithm) else {
        throw NSError(domain: "MapPartyEmergencyCrypto", code: 3, userInfo: [NSLocalizedDescriptionKey: "Criptografia SOS não suportada neste iPhone."])
      }
      var encryptionError: Unmanaged<CFError>?
      guard let encrypted = SecKeyCreateEncryptedData(publicKey, algorithm, payload as CFData, &encryptionError) as Data? else {
        throw (encryptionError?.takeRetainedValue() as Error?) ?? NSError(domain: "MapPartyEmergencyCrypto", code: 4, userInfo: [NSLocalizedDescriptionKey: "Não foi possível criptografar o SOS."])
      }
      return encrypted.base64EncodedString()
    }
  }
}
