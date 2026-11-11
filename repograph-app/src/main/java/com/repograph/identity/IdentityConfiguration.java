package com.repograph.identity;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.util.Base64;

/** Initializes the persistent account directory and first administrator without a shared default password. @author leolu */
@Configuration
public class IdentityConfiguration {
    private static final Logger log = LoggerFactory.getLogger(IdentityConfiguration.class);

    /**
     * Creates the shared account directory; bootstrap credentials only apply to an empty account store.
     * A generated credential is written to an owner-only file adjacent to the database, never to logs.
     */
    @Bean
    public EnterpriseDirectory enterpriseDirectory(
            @Value("${repograph.index.db-path:${user.home}/.repograph/index.db}") String dbPath,
            @Value("${repograph.security.bootstrap-admin-password:}") String configuredPassword) {
        EnterpriseDirectory directory = new EnterpriseDirectory(dbPath);
        try {
            directory.account("builtin-admin");
            return directory;
        } catch (IdentityException missing) {
            if (missing.status() != 404) throw missing;
        }
        String password = configuredPassword;
        if (password == null || password.isBlank()) {
            Path file = Path.of(dbPath).toAbsolutePath().getParent().resolve("bootstrap-admin-password");
            try {
                if (!Files.exists(file)) {
                    byte[] random = new byte[24];
                    new SecureRandom().nextBytes(random);
                    Files.createFile(file, PosixFilePermissions.asFileAttribute(
                            PosixFilePermissions.fromString("rw-------")));
                    Files.writeString(file, Base64.getUrlEncoder().withoutPadding().encodeToString(random),
                            StandardCharsets.UTF_8, StandardOpenOption.WRITE);
                }
                if (!Files.isRegularFile(file, java.nio.file.LinkOption.NOFOLLOW_LINKS)) {
                    throw new IllegalStateException("Bootstrap credential path must be a regular file");
                }
                Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
                password = Files.readString(file, StandardCharsets.UTF_8).strip();
                log.info("Initial admin credential is available in the owner-only file {}", file);
            } catch (IOException error) {
                throw new IllegalStateException("Cannot prepare the administrator bootstrap credential file", error);
            }
        }
        directory.bootstrapAdmin(password);
        return directory;
    }
}
