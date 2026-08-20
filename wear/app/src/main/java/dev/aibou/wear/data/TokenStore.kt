package dev.aibou.wear.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Secure storage for the Bridge bearer token (AC5.1.1).
 *
 * Values are encrypted with an AES-256-GCM key held in the Android Keystore, so
 * the key material never enters app memory or backups. The ciphertext lives in
 * ordinary SharedPreferences.
 *
 * This deliberately does not use androidx.security:security-crypto
 * (EncryptedSharedPreferences), which is deprecated.
 */
class TokenStore(context: Context) {

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var token: String?
        get() = read(KEY_TOKEN)
        set(value) = write(KEY_TOKEN, value)

    var bridgeUrl: String?
        get() = read(KEY_BRIDGE_URL)
        set(value) = write(KEY_BRIDGE_URL, value)

    val isPaired: Boolean
        get() = !token.isNullOrEmpty() && !bridgeUrl.isNullOrEmpty()

    fun clear() {
        prefs.edit().clear().apply()
    }

    // ─── Crypto ──────────────────────────────────────────────────────────────

    private fun write(key: String, value: String?) {
        if (value == null) {
            prefs.edit().remove(key).apply()
            return
        }
        val encoded = runCatching { encrypt(value) }.getOrNull()
        if (encoded == null) {
            // Never silently fall back to plaintext for a credential.
            prefs.edit().remove(key).apply()
            return
        }
        prefs.edit().putString(key, encoded).apply()
    }

    private fun read(key: String): String? {
        val stored = prefs.getString(key, null) ?: return null
        return runCatching { decrypt(stored) }.getOrElse {
            // Key rotated, app data restored to a new device, or corrupt value.
            // Drop it so the user is prompted to pair again.
            prefs.edit().remove(key).apply()
            null
        }
    }

    private fun encrypt(plainText: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        val cipherText = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))

        // Store IV length + IV + ciphertext so decryption is self-describing.
        val combined = ByteArray(1 + iv.size + cipherText.size)
        combined[0] = iv.size.toByte()
        System.arraycopy(iv, 0, combined, 1, iv.size)
        System.arraycopy(cipherText, 0, combined, 1 + iv.size, cipherText.size)

        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String): String {
        val combined = Base64.decode(encoded, Base64.NO_WRAP)
        require(combined.isNotEmpty()) { "empty payload" }

        val ivSize = combined[0].toInt()
        require(ivSize in 1..combined.size - 2) { "bad IV length" }

        val iv = combined.copyOfRange(1, 1 + ivSize)
        val cipherText = combined.copyOfRange(1 + ivSize, combined.size)

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        return String(cipher.doFinal(cipherText), Charsets.UTF_8)
    }

    /** Fetch the Keystore key, creating it on first use. */
    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let {
            return it.secretKey
        }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                // No user-authentication requirement: the watch must be able to
                // reconnect and receive approvals without an unlock first.
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val PREFS_NAME = "aibou_secure_prefs"
        const val KEY_TOKEN = "auth_token"
        const val KEY_BRIDGE_URL = "bridge_url"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "aibou_token_key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_BITS = 128
    }
}
