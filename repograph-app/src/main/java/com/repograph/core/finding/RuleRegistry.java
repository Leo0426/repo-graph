package com.repograph.core.finding;

import java.util.List;
import java.util.Optional;

/**
 * 检测规则版本存储、生命周期和发布回归闸门的领域接口。
 *
 * @author leolu
 */
public interface RuleRegistry {

    /**
     * 创建下一个候选版本。
     *
     * @param draft      规则候选
     * @param actor      操作者
     * @param reason     创建理由
     * @param occurredAt 发生时间
     * @return 已注册的候选版本
     */
    DetectionRule createCandidate(DetectionRuleDraft draft, String actor, String reason, String occurredAt);

    /**
     * 将候选版本提交人工评审。
     *
     * @return 迁移后的版本
     */
    DetectionRule submitForReview(String ruleId, int version, String actor, String reason, String occurredAt);

    /**
     * 在回归集通过后发布规则版本。
     *
     * @return 已发布版本
     */
    DetectionRule publish(String ruleId, int version, String actor, String reason, String occurredAt);

    /**
     * 驳回正在评审的规则版本。
     *
     * @return 已驳回版本
     */
    DetectionRule reject(String ruleId, int version, String actor, String reason, String occurredAt);

    /**
     * 回滚当前活动版本并恢复上一已发布版本。
     *
     * @return 恢复生效的版本
     */
    DetectionRule rollback(String ruleId, String actor, String reason, String occurredAt);

    /**
     * 查询指定版本。
     */
    Optional<DetectionRule> find(String ruleId, int version);

    /**
     * 查询当前活动版本。
     */
    Optional<DetectionRule> findActive(String ruleId);

    /**
     * 按规则标识列出版本；空标识表示全部规则。
     */
    List<DetectionRule> list(String ruleId);

    /**
     * 查询规则的生命周期审计事件。
     */
    List<RuleAuditEvent> audit(String ruleId);
}
