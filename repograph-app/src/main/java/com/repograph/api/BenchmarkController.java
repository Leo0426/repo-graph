package com.repograph.api;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Serves the latest benchmark evaluation results written by {@code CodeRetrievalBenchmark}.
 *
 * @author leolu
 * @since 0.1.0
 */
@RestController
@RequestMapping("/api/v1/benchmark")
public class BenchmarkController {

    private static final Path RESULTS_FILE =
            Path.of(System.getProperty("user.home"), ".repograph", "benchmark-latest.json");

    @GetMapping(value = "/results", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> results() throws IOException {
        if (!Files.exists(RESULTS_FILE)) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(Files.readString(RESULTS_FILE));
    }
}
