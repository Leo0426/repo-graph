package com.repograph.securityreview;

import com.repograph.core.securityreview.AuditSeverity;
import com.repograph.core.securityreview.ThreatKind;

/**
 * 威胁检测规则规格（classpath JSON 反序列化目标，非领域契约）。
 *
 * <p>规则对日志行做正则匹配：
 * <ul>
 *   <li>{@code minCount} 为 null 时逐命中行产出一条威胁记录；</li>
 *   <li>{@code minCount} 非空时按文件聚合计数，达到阈值才产出一条聚合记录（如暴力破解）；</li>
 *   <li>{@code whitelistChecked} 为 true 时提取目标地址并与外联白名单比对，命中白名单不记录。</li>
 * </ul>
 *
 * @param ruleId          规则唯一 ID
 * @param kind            威胁类型
 * @param severity        严重程度
 * @param pattern         日志行匹配正则
 * @param group           用作主提取组的编号（1-based，0 表示整行）
 * @param timePattern     事件时间提取正则（第 1 组为时间原文），可选
 * @param detailTemplate  威胁说明模板，{@code {1}}~{@code {n}} 替换为正则分组，{@code {count}} 替换为聚合计数
 * @param minCount        聚合阈值；null 表示逐行记录
 * @param whitelistChecked 是否对提取组做外联白名单比对
 * @author leolu
 */
record ThreatRuleSpec(
        String ruleId,
        ThreatKind kind,
        AuditSeverity severity,
        String pattern,
        int group,
        String timePattern,
        String detailTemplate,
        Integer minCount,
        boolean whitelistChecked) {
}
