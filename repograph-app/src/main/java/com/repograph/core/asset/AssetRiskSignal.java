package com.repograph.core.asset;

import java.util.List;

/**
 * 资产画像中的聚合风险信号。
 *
 * @param type     信号类型
 * @param severity 建议风险等级
 * @param count    命中数量
 * @param evidence 不包含秘密值的证据位置
 * @param reason   风险说明
 * @author leolu
 */
public record AssetRiskSignal(
        String type,
        String severity,
        long count,
        List<String> evidence,
        String reason
) {
    /**
     * 创建不可变风险信号。
     */
    public AssetRiskSignal {
        evidence = evidence == null ? List.of() : List.copyOf(evidence);
    }
}
