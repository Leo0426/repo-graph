package com.repograph.core.util;

import com.repograph.core.model.CodeUnitKind;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * {@link com.repograph.core.model.CodeUnit} ID 生成工具类。
 *
 * <p>ID 由 {@code SHA256(projectId + filePath + kind + qualifiedName)} 计算，**包含 projectId
 * 以避免跨项目冲突**：两个项目即使有完全相同的相对路径和符号，也会得到不同的 ID，
 * 防止 Neo4j {@code MERGE} 和 Qdrant {@code upsert} 互相覆盖。
 *
 * <p>所有解析器必须通过此类生成 ID，禁止各模块自行实现，以保证跨模块一致性。
 *
 * @author leolu
 * @since 0.1.0
 */
public final class CodeUnitIdUtil {

    private CodeUnitIdUtil() {}

    /**
     * 根据 projectId、filePath、kind 和 qualifiedName 计算 CodeUnit 的唯一 ID。
     *
     * <p>算法：对 {@code projectId + filePath + kind.name() + qualifiedName} 的 UTF-8
     * 字节计算 SHA-256，返回完整 64 位十六进制字符串。
     *
     * @param projectId     项目唯一标识符，{@code null} 时按空字符串处理（兼容遗留单元测试）
     * @param filePath      代码单元所在文件的相对路径（{@code /} 分隔），不为 {@code null}
     * @param kind          代码单元类型，不为 {@code null}
     * @param qualifiedName 全限定名，不为 {@code null}
     * @return 64 位小写十六进制 SHA-256 字符串
     */
    public static String computeId(String projectId, String filePath, CodeUnitKind kind, String qualifiedName) {
        String input = (projectId == null ? "" : projectId)
                + filePath + kind.name() + qualifiedName;
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 algorithm not available", e);
        }
    }
}
