package com.repograph.app.config;

import com.repograph.agent.AgentRunStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.env.MockEnvironment;

import java.nio.file.Path;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

class SqliteStorageInitializerTest {
    @TempDir
    Path directory;

    private SqliteStorageInitializer initializer(MockEnvironment environment) {
        SqliteStorageInitializer initializer = new SqliteStorageInitializer();
        initializer.setEnvironment(environment);
        return initializer;
    }

    @Test
    void createsMissingNestedParentDirectoryBeforeStorageBeansRun() {
        Path dbFile = directory.resolve("nested/a/b/index.db");
        MockEnvironment environment = new MockEnvironment();
        environment.setProperty("repograph.index.db-path", dbFile.toString());

        initializer(environment).postProcessBeanFactory(null);

        assertThat(dbFile.getParent()).exists();
    }

    @Test
    void resolvesPlaceholderInsideConfiguredPath() {
        MockEnvironment environment = new MockEnvironment();
        environment.setProperty("repograph.index.db-path", "${repograph.test.home}/index.db");
        environment.setProperty("repograph.test.home", directory.resolve(".repograph").toString());

        initializer(environment).postProcessBeanFactory(null);

        assertThat(directory.resolve(".repograph")).exists();
    }

    @Test
    void existingDirectoryAndRelativePathPassSilently() {
        MockEnvironment environment = new MockEnvironment();
        environment.setProperty("repograph.index.db-path", directory.resolve("index.db").toString());

        assertThatCode(() -> initializer(environment).postProcessBeanFactory(null))
                .doesNotThrowAnyException();

        MockEnvironment relative = new MockEnvironment();
        relative.setProperty("repograph.index.db-path", "index.db");
        assertThatCode(() -> initializer(relative).postProcessBeanFactory(null))
                .doesNotThrowAnyException();
    }

    @Test
    void storageBeansCanInitialiseAfterDirectoryCreated() {
        Path dbFile = directory.resolve("first-run/index.db");
        assertThat(dbFile.getParent()).doesNotExist();
        MockEnvironment environment = new MockEnvironment();
        environment.setProperty("repograph.index.db-path", dbFile.toString());
        initializer(environment).postProcessBeanFactory(null);

        AgentRunStore store = new AgentRunStore(dbFile.toString());

        assertThat(store.recoverInterrupted("2026-10-20T00:00:00Z")).isZero();
    }
}
