package com.repograph.core.finding;

/**
 * 规则效果评估契约：对已发布规则版本在标注反馈、抑制策略与研判快照事实上计算六类指标，
 * 并与上一份快照对比输出版本间回归。实现必须是纯函数，不访问数据库或外部系统。
 *
 * @author leolu
 */
public interface RuleEffectEvaluator {

    /**
     * 计算单条规则的效果评估报告。
     *
     * @param request 输入事实集合，不可为 {@code null}
     * @return 评估报告，含指标、回归增量与缺失说明
     */
    RuleEvaluationReport evaluate(RuleEvaluationRequest request);
}
