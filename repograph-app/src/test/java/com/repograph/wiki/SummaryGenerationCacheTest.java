package com.repograph.wiki;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link SummaryGenerationCache} 单元测试：真实 SQLite（临时目录），
 * 验证键命中、事实指纹失效与覆盖语义。
 *
 * @author leolu
 * @since 0.7.0
 */
class SummaryGenerationCacheTest {

    @TempDir
    Path tempDir;

    private SummaryGenerationCache cache;

    @BeforeEach
    void setUp() {
        cache = new SummaryGenerationCache(tempDir.resolve("test.db").toString(),
                new ObjectMapper());
    }

    @Test
    void find_missThenHit() {
        assertThat(cache.find("p1", "__project__", "LLM_ARCH:项目概述", "hash1"))
                .isEqualTo(Optional.empty());

        cache.save("p1", "__project__", "LLM_ARCH:项目概述", "hash1", "{\"body\":\"x\"}");

        assertThat(cache.find("p1", "__project__", "LLM_ARCH:项目概述", "hash1"))
                .isEqualTo(Optional.of("{\"body\":\"x\"}"));
    }

    @Test
    void find_differentFactsHash_misses() {
        cache.save("p1", "__project__", "LLM_ARCH:项目概述", "hash1", "old");

        assertThat(cache.find("p1", "__project__", "LLM_ARCH:项目概述", "hash2"))
                .isEqualTo(Optional.empty());
    }

    @Test
    void save_overwritesSameKey() {
        cache.save("p1", "__project__", "LLM_ARCH:模块划分", "hash1", "v1");
        cache.save("p1", "__project__", "LLM_ARCH:模块划分", "hash1", "v2");

        assertThat(cache.find("p1", "__project__", "LLM_ARCH:模块划分", "hash1"))
                .isEqualTo(Optional.of("v2"));
    }

    @Test
    void keys_areIsolatedByScopeAndProject() {
        cache.save("p1", "com.a", "LLM_ARCH:项目概述", "hash1", "a");
        cache.save("p2", "com.a", "LLM_ARCH:项目概述", "hash1", "b");

        assertThat(cache.find("p1", "com.a", "LLM_ARCH:项目概述", "hash1"))
                .isEqualTo(Optional.of("a"));
        assertThat(cache.find("p2", "com.a", "LLM_ARCH:项目概述", "hash1"))
                .isEqualTo(Optional.of("b"));
    }
}
