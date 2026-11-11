package com.repograph.app.config;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.context.EnvironmentAware;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * 在任何 SQLite 存储 Bean 实例化之前确保数据库父目录存在。
 *
 * <p>多个 SQLite store（如 {@code AgentRunStore}、{@code ScanTaskStore}）在构造函数中
 * 建表并直接打开 {@code repograph.index.db-path}；Spring 不保证这些单例之间的创建顺序，
 * 因此目录创建以 {@link BeanFactoryPostProcessor} 形式在所有 Bean 实例化之前执行，
 * 避免全新机器首次启动时因 {@code ~/.repograph} 不存在而无友好错误地崩溃。
 *
 * <p>托管资产目录与外部扫描器工作目录由各自的导入/扫描流程在使用前创建，不在此重复处理。
 *
 * @author leolu
 */
@Component
public class SqliteStorageInitializer implements BeanFactoryPostProcessor, EnvironmentAware {

    private static final Logger log = LoggerFactory.getLogger(SqliteStorageInitializer.class);

    /**
     * 数据库路径占位符，默认值与各 SQLite store 注入的 {@code @Value} 一致。
     */
    private static final String DB_PATH_PLACEHOLDER =
            "${repograph.index.db-path:${user.home}/.repograph/index.db}";

    private Environment environment;

    /**
     * 接收运行环境，用于解析数据库路径占位符。
     * @param environment 当前运行环境
     */
    @Override
    public void setEnvironment(Environment environment) {
        this.environment = environment;
    }

    /**
     * 在所有单例 Bean 实例化之前创建 SQLite 数据库父目录，目录已存在时静默通过。
     */
    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) {
        String dbPath = environment.resolvePlaceholders(DB_PATH_PLACEHOLDER);
        Path parent = Path.of(dbPath).getParent();
        if (parent == null) return;
        try {
            Files.createDirectories(parent);
            log.info("SQLite storage directory ready at '{}'", parent);
        } catch (IOException e) {
            throw new UncheckedIOException("无法创建 SQLite 数据库父目录: " + parent, e);
        }
    }
}
