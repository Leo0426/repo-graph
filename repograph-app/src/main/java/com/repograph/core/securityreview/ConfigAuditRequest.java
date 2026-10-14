package com.repograph.core.securityreview;

import java.util.List;

/**
 * 配置核查请求。
 *
 * @param files      待核查配置文件集合（名称 + 原文内容）
 * @param dimensions 参与核查的维度；为空或 null 时核查全部已加载规则覆盖的维度
 * @author leolu
 */
public record ConfigAuditRequest(List<ConfigAuditFile> files, List<AuditDimension> dimensions) {

    /**
     * 紧凑构造器：null 集合归一为空列表，避免调用方处理空指针。
     */
    public ConfigAuditRequest {
        files = files == null ? List.of() : List.copyOf(files);
        dimensions = dimensions == null ? List.of() : List.copyOf(dimensions);
    }

    /**
     * 待核查配置文件。
     *
     * @param name    文件名（如 {@code sshd_config}），用于报告定位
     * @param content 文件原文
     */
    public record ConfigAuditFile(String name, String content) {
    }
}
