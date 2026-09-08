package com.acme.showcase.security;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.File;
import java.io.ObjectInputStream;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Random;

/**
 * Synthetic signals for all nine built-in code vulnerability rules.
 * Never execute these methods.
 *
 * @author leolu
 */
public class SecurityShowcase {

    private final DemoLog log = new DemoLog();

    /**
     * Places eight independent scanner signals in one never-executed method to keep the fixture small.
     *
     * @param input untrusted demonstration input
     * @param stream untrusted serialized input
     * @throws Exception because the unsafe APIs expose checked exceptions
     */
    public void demonstrateAll(String input, ObjectInputStream stream) throws Exception {
        new ProcessBuilder("sh", "-c", input).start();
        stream.readObject();
        MessageDigest.getInstance("MD5").digest(input.getBytes());
        String password = "demo-only-secret";
        File download = Path.of("../uploads/" + input).toFile();
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        int sessionToken = new Random().nextInt();
        log.info("password={}", password);
    }

    /** Minimal logger-shaped helper; the fixture has no runtime behavior. */
    private static final class DemoLog {
        private void info(String format, Object value) {
            // Static-analysis fixture only.
        }
    }
}
