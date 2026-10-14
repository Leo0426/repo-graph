package com.repograph.core.securityreview;

import java.time.Instant;
import java.util.List;

/**
 * 威胁检测报告。
 *
 * @param scannedLogs 检测的日志文件数
 * @param records     威胁记录列表
 * @param generatedAt 报告生成时间
 * @author leolu
 */
public record ThreatReport(int scannedLogs, List<ThreatRecord> records, Instant generatedAt) {

    /**
     * 紧凑构造器：null 集合归一为空列表。
     */
    public ThreatReport {
        records = records == null ? List.of() : List.copyOf(records);
    }
}
