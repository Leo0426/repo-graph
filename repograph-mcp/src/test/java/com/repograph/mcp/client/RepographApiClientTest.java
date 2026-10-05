package com.repograph.mcp.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.http.HttpTimeoutException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Exercises HTTP deadlines and cancellation against a local server that withholds its response.
 *
 * @author leolu
 */
class RepographApiClientTest {

    private final CountDownLatch requestReceived = new CountDownLatch(1);
    private final CountDownLatch releaseResponse = new CountDownLatch(1);
    private ExecutorService serverExecutor;
    private HttpServer server;
    private RepographApiClient client;

    @BeforeEach
    void setUp() throws Exception {
        serverExecutor = Executors.newVirtualThreadPerTaskExecutor();
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.setExecutor(serverExecutor);
        server.createContext("/", exchange -> {
            requestReceived.countDown();
            try {
                releaseResponse.await();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } finally {
                exchange.close();
            }
        });
        server.start();
        client = new RepographApiClient(new ObjectMapper(), 1);
        client.setBaseUrl("http://localhost:" + server.getAddress().getPort());
    }

    @AfterEach
    void tearDown() {
        releaseResponse.countDown();
        if (server != null) server.stop(0);
        if (serverExecutor != null) serverExecutor.close();
    }

    @ParameterizedTest
    @EnumSource(Request.class)
    void configuredTimeoutBoundsEveryRequest(Request request) throws Exception {
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var result = executor.submit(() -> request.send(client));
            try {
                assertThat(requestReceived.await(5, TimeUnit.SECONDS)).isTrue();
                assertThatThrownBy(() -> result.get(4, TimeUnit.SECONDS))
                        .hasRootCauseInstanceOf(HttpTimeoutException.class);
            } finally {
                result.cancel(true);
            }
        }
    }

    @ParameterizedTest
    @EnumSource(Request.class)
    void cancelledRequestPreservesThreadInterrupt(Request request) throws Exception {
        var interrupted = new AtomicBoolean();
        var failure = new AtomicReference<Throwable>();
        Thread worker = Thread.ofVirtual().start(() -> {
            try {
                request.send(client);
            } catch (Throwable e) {
                failure.set(e);
                interrupted.set(Thread.currentThread().isInterrupted());
            }
        });
        try {
            assertThat(requestReceived.await(5, TimeUnit.SECONDS)).isTrue();
            worker.interrupt();
            worker.join(5000);
            assertThat(worker.isAlive()).isFalse();
            assertThat(failure.get()).isInstanceOf(RepographApiClient.RepographApiException.class)
                    .hasCauseInstanceOf(InterruptedException.class);
            assertThat(interrupted).isTrue();
        } finally {
            worker.interrupt();
            worker.join(5000);
        }
    }

    private enum Request {
        GET, POST, POST_JSON;

        Object send(RepographApiClient client) {
            return switch (this) {
                case GET -> client.get("/slow");
                case POST -> client.post("/slow");
                case POST_JSON -> client.postJson("/slow", "{}");
            };
        }
    }
}
