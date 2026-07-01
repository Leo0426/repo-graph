package com.repograph.core.util;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * 项目 ID 生成工具类，确保全局统一的 projectId 生成规则。
 *
 * <p>所有模块必须通过此类生成 projectId，禁止各模块自行实现，以保证 Qdrant Payload、
 * 图 JSON 和 SQLite 缓存中的 projectId 字段一致。
 *
 * @author leolu
 * @since 0.1.0
 */
public final class ProjectIdUtil {

    private ProjectIdUtil() {}

    /**
     * 根据项目根目录的绝对路径生成唯一的项目 ID。
     *
     * <p>算法：对规范化绝对路径的 UTF-8 字节计算 SHA-256，取十六进制结果的前 12 位。
     * 示例：{@code /home/leolu/projects/myapp} → {@code "a3f2c1e8b094"}
     *
     * @param projectRoot 项目根目录路径，不为 {@code null}
     * @return 12 位小写十六进制字符串，全局唯一标识该项目路径
     */
    public static String generateProjectId(Path projectRoot) {
        String absolutePath = projectRoot.toAbsolutePath().normalize().toString();
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(absolutePath.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash).substring(0, 12);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 是 Java 标准必须支持的算法，此分支不可达
            throw new IllegalStateException("SHA-256 algorithm not available", e);
        }
    }
}
