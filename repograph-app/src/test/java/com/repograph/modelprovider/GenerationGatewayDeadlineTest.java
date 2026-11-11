package com.repograph.modelprovider;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.net.InetSocketAddress;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;

/** Verifies cancellation while an upstream response body is stalled. @author leolu */
class GenerationGatewayDeadlineTest {
    @TempDir Path temporary;

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void cancellationUnblocksAStalledBodyAndPreservesInterrupt(boolean virtual) throws Exception {
        var waiting = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var interrupted = new AtomicBoolean();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/chat", exchange -> {
            exchange.getRequestBody().readAllBytes();
            exchange.sendResponseHeaders(200, 0);
            exchange.getResponseBody().write(' ');
            exchange.getResponseBody().flush();
            waiting.countDown();
            try { release.await(5, TimeUnit.SECONDS); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            finally { exchange.close(); }
        });
        server.start();
        Thread worker = null;
        try {
            var store = new ModelProviderStore(temporary.resolve("deadline.db").toString(), "", true,
                    "http://127.0.0.1:" + server.getAddress().getPort(), "fixture");
            var gateway = new GenerationGateway(store, new com.fasterxml.jackson.databind.ObjectMapper());
            worker = (virtual ? Thread.ofVirtual() : Thread.ofPlatform()).start(() -> {
                try { gateway.complete("system", "user", Map.of(), null); }
                catch (com.repograph.core.advisory.LlmModelException expected) {
                    interrupted.set(Thread.currentThread().isInterrupted());
                }
            });
            assertThat(waiting.await(3, TimeUnit.SECONDS)).isTrue();
            worker.interrupt();
            worker.join(700);
            assertThat(worker.isAlive()).as("cancelled model request must stop promptly").isFalse();
            assertThat(interrupted).isTrue();
        } finally {
            release.countDown(); server.stop(0);
            if (worker != null) { worker.interrupt(); worker.join(3000); }
        }
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void configuredDeadlineBoundsContinuouslyArrivingResponseBytes(boolean streaming) throws Exception {
        var disconnected = new CountDownLatch(1);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/chat/completions", exchange -> {
            exchange.getRequestBody().readAllBytes();
            exchange.sendResponseHeaders(200, 0);
            try {
                for (int i = 0; i < 40; i++) {
                    exchange.getResponseBody().write((streaming ? ": keepalive\n\n" : " ").getBytes());
                    exchange.getResponseBody().flush();
                    Thread.sleep(100);
                }
            } catch (java.io.IOException expectedDisconnect) {
                disconnected.countDown();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            } finally { exchange.close(); }
        });
        server.start();
        try {
            var store = new ModelProviderStore(temporary.resolve("timeout.db").toString(), "", false,
                    "http://localhost:11434", "unused");
            var provider = store.save(null, new ModelProviderStore.ProviderInput("Deadline fixture", "OPENAI",
                    "http://127.0.0.1:" + server.getAddress().getPort(), "fixture", true, "", false, 1000, 128));
            store.select(provider.id());
            var gateway = new GenerationGateway(store, new com.fasterxml.jackson.databind.ObjectMapper());
            long started = System.nanoTime();
            org.assertj.core.api.Assertions.assertThatThrownBy(() -> gateway.complete("system", "user", Map.of(),
                    streaming ? delta -> { } : null))
                    .isInstanceOf(com.repograph.core.advisory.LlmModelException.class)
                    .hasMessageContaining("timeout");
            assertThat(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)).isLessThan(1800);
            assertThat(disconnected.await(2, TimeUnit.SECONDS)).as("upstream connection released after deadline").isTrue();
        } finally { server.stop(0); }
    }
}
