package com.repograph.graph;

import org.neo4j.driver.AuthTokens;
import org.neo4j.driver.Driver;
import org.neo4j.driver.GraphDatabase;
import org.neo4j.driver.Session;
import org.neo4j.harness.Neo4j;
import org.neo4j.harness.Neo4jBuilders;

/**
 * 复用同一个 in-process Neo4j 实例和 Driver 的测试 fixture。
 *
 * <p>每个测试类在 {@code @BeforeAll} 调用 {@link #start()}、{@code @AfterAll} 调用
 * {@link #stop()}；每个测试方法在 {@code @BeforeEach} 调用 {@link #wipe()} 清空数据。
 * 启动 in-process Neo4j 约需 2-3 秒，因此尽量类级共享而不是每个测试方法重建。
 *
 * @author leolu
 * @since 0.2.0
 */
final class Neo4jTestFixture {

    private Neo4j embeddedServer;
    private Driver driver;

    Driver driver() {
        return driver;
    }

    void start() {
        // withDisabledServer() skips the HTTP/REST endpoint entirely; only Bolt is exposed,
        // sidestepping Jetty 11/12 version conflicts between Neo4j Harness and Spring Boot BOM.
        embeddedServer = Neo4jBuilders.newInProcessBuilder()
                .withDisabledServer()
                .build();
        driver = GraphDatabase.driver(embeddedServer.boltURI(), AuthTokens.none());
        driver.verifyConnectivity();
    }

    void wipe() {
        try (Session session = driver.session()) {
            session.run("MATCH (n) DETACH DELETE n").consume();
        }
    }

    void stop() {
        if (driver != null) driver.close();
        if (embeddedServer != null) embeddedServer.close();
    }
}
