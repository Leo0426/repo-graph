package com.repograph.benchmark;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

final class BenchmarkJsonWriter {

    private static final ObjectMapper MAPPER = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT);
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final Path OUTPUT_FILE =
            Path.of(System.getProperty("user.home"), ".repograph", "benchmark-latest.json");

    private BenchmarkJsonWriter() {}

    static void write(String projectLabel, int k,
                      List<BenchmarkResult> semanticResults, double semanticThreshold,
                      List<BenchmarkResult> codeResults, double codeThreshold) {
        try {
            Files.createDirectories(OUTPUT_FILE.getParent());
            ObjectNode root = MAPPER.createObjectNode();
            root.put("generatedAt", LocalDateTime.now().format(FMT));
            root.put("projectLabel", projectLabel);
            root.set("semantic", section("SEMANTIC SEARCH", k, semanticResults, semanticThreshold));
            root.set("code", section("CODE SEARCH", k, codeResults, codeThreshold));
            MAPPER.writeValue(OUTPUT_FILE.toFile(), root);
            System.out.println("[benchmark] results written to " + OUTPUT_FILE);
        } catch (IOException e) {
            System.err.println("[benchmark] failed to write results JSON: " + e.getMessage());
        }
    }

    private static ObjectNode section(String title, int k,
                                      List<BenchmarkResult> results, double threshold) {
        ObjectNode sec = MAPPER.createObjectNode();
        sec.put("title", title);
        sec.put("total", results.size());
        sec.put("threshold", threshold);
        sec.put("hit1Rate",  hitRate(results, 1));
        sec.put("hit3Rate",  hitRate(results, 3));
        sec.put("hit5Rate",  hitRate(results, 5));
        sec.put("hit10Rate", hitRate(results, k));
        sec.put("mrr10", mrr(results));
        sec.put("passed", hitRate(results, k) >= threshold);

        ArrayNode cases = sec.putArray("cases");
        for (BenchmarkResult r : results) {
            ObjectNode c = cases.addObject();
            c.put("id",          r.benchCase().id());
            c.put("description", r.benchCase().description());
            c.put("rank",        r.rank());
            c.put("topScore",    r.topScore());
            c.put("hitScore",    r.hitScore());
            c.put("hit1",        r.hitAt(1));
            c.put("hit3",        r.hitAt(3));
            c.put("hit5",        r.hitAt(5));
            c.put("hit10",       r.hitAt(k));
            c.put("topResult",   r.retrieved().isEmpty() ? "" : r.retrieved().get(0));
        }
        return sec;
    }

    private static double hitRate(List<BenchmarkResult> results, int k) {
        if (results.isEmpty()) return 0;
        return (double) results.stream().filter(r -> r.hitAt(k)).count() / results.size();
    }

    private static double mrr(List<BenchmarkResult> results) {
        return results.stream().mapToDouble(BenchmarkResult::reciprocalRank).average().orElse(0);
    }
}
