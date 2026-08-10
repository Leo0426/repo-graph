package com.repograph.core.architecture;

/**
 * 架构评审输入的可引用事实。
 *
 * @param citationId 稳定引用 ID
 * @param category   证据类别
 * @param location   文件、符号或模块位置
 * @param summary    指标事实摘要
 * @author leolu
 */
public record ArchitectureEvidence(
        String citationId,
        String category,
        String location,
        String summary) {
}
