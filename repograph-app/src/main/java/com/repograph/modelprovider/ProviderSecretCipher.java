package com.repograph.modelprovider;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.util.Base64;

/** Authenticated encryption for provider secrets; the master key never lives in SQLite. */
final class ProviderSecretCipher {
    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    ProviderSecretCipher(Path keyFile, String configuredKey, boolean encryptedDataExists) {
        try {
            byte[] bytes;
            if (configuredKey != null && !configuredKey.isBlank()) {
                bytes = Base64.getDecoder().decode(configuredKey.trim());
            } else {
                if (!Files.exists(keyFile, LinkOption.NOFOLLOW_LINKS)) {
                    if (encryptedDataExists) throw new IllegalStateException("Provider encryption key is missing");
                    bytes = new byte[32];
                    random.nextBytes(bytes);
                    Path temporary = Files.createTempFile(keyFile.getParent(), ".provider-key-", ".tmp",
                            PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
                    try {
                        Files.writeString(temporary, Base64.getEncoder().encodeToString(bytes),
                                StandardOpenOption.WRITE);
                        // A hard link publishes complete bytes atomically and refuses to replace an existing key.
                        try { Files.createLink(keyFile, temporary); }
                        catch (java.nio.file.FileAlreadyExistsException concurrentInitialization) { /* Read winner. */ }
                    } finally {
                        Files.deleteIfExists(temporary);
                    }
                }
                if (!Files.isRegularFile(keyFile, LinkOption.NOFOLLOW_LINKS)) {
                    throw new IllegalStateException("Provider encryption key must be a regular file");
                }
                Files.setPosixFilePermissions(keyFile, PosixFilePermissions.fromString("rw-------"));
                bytes = Base64.getDecoder().decode(Files.readString(keyFile).trim());
            }
            if (bytes.length != 32) throw new IllegalArgumentException("Provider encryption key must be 32 bytes");
            key = new SecretKeySpec(bytes, "AES");
        } catch (Exception error) {
            throw new IllegalStateException("Cannot load provider encryption key; restore the original key", error);
        }
    }

    String encrypt(String providerId, String value) {
        if (value.isEmpty()) return "";
        try {
            byte[] nonce = new byte[12];
            random.nextBytes(nonce);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, nonce));
            cipher.updateAAD(providerId.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            byte[] encrypted = cipher.doFinal(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(ByteBuffer.allocate(nonce.length + encrypted.length)
                    .put(nonce).put(encrypted).array());
        } catch (Exception error) {
            throw new IllegalStateException("Cannot encrypt provider credential");
        }
    }

    String decrypt(String providerId, String value) {
        if (value.isEmpty()) return "";
        try {
            ByteBuffer bytes = ByteBuffer.wrap(Base64.getDecoder().decode(value));
            byte[] nonce = new byte[12];
            bytes.get(nonce);
            byte[] encrypted = new byte[bytes.remaining()];
            bytes.get(encrypted);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, nonce));
            cipher.updateAAD(providerId.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return new String(cipher.doFinal(encrypted), java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception error) {
            throw new IllegalStateException("Cannot decrypt provider credential; restore the original encryption key");
        }
    }
}
