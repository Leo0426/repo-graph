package com.repograph.api;

import com.repograph.core.finding.DetectionRule;
import com.repograph.core.finding.DetectionRuleDraft;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.RuleAuditEvent;
import com.repograph.core.finding.RuleMatcherKind;
import com.repograph.core.finding.RuleNotFoundException;
import com.repograph.core.finding.RuleRegistry;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;

/**
 * 检测规则候选、评审、发布、回滚、查询和审计 REST API。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/rules")
public class RuleController {

    private final RuleRegistry registry;

    /**
     * 创建规则控制器。
     *
     * @param registry 规则注册表
     */
    public RuleController(RuleRegistry registry) {
        this.registry = registry;
    }

    /**
     * 创建新的候选版本。
     *
     * @param request 规则元数据、回归样本和操作信息
     * @return 分配版本号后的候选
     */
    @PostMapping
    public DetectionRule createCandidate(@RequestBody CreateRuleRequest request) {
        return registry.createCandidate(request.toDraft(), request.actor(), request.reason(), now());
    }

    /**
     * 将候选版本提交人工评审。
     */
    @PostMapping("/{ruleId}/versions/{version}/review")
    public DetectionRule submitForReview(
            @PathVariable String ruleId,
            @PathVariable int version,
            @RequestBody RuleActionRequest request) {
        return registry.submitForReview(ruleId, version, request.actor(), request.reason(), now());
    }

    /**
     * 通过回归闸门并发布正在评审的版本。
     */
    @PostMapping("/{ruleId}/versions/{version}/publish")
    public DetectionRule publish(
            @PathVariable String ruleId,
            @PathVariable int version,
            @RequestBody RuleActionRequest request) {
        return registry.publish(ruleId, version, request.actor(), request.reason(), now());
    }

    /**
     * 驳回正在评审的版本。
     */
    @PostMapping("/{ruleId}/versions/{version}/reject")
    public DetectionRule reject(
            @PathVariable String ruleId,
            @PathVariable int version,
            @RequestBody RuleActionRequest request) {
        return registry.reject(ruleId, version, request.actor(), request.reason(), now());
    }

    /**
     * 回滚当前活动版本并恢复上一已发布版本。
     */
    @PostMapping("/{ruleId}/rollback")
    public DetectionRule rollback(
            @PathVariable String ruleId,
            @RequestBody RuleActionRequest request) {
        return registry.rollback(ruleId, request.actor(), request.reason(), now());
    }

    /**
     * 列出全部规则或指定规则的版本历史。
     */
    @GetMapping
    public List<DetectionRule> list(@RequestParam(required = false) String ruleId) {
        return registry.list(ruleId);
    }

    /**
     * 查询指定规则版本。
     */
    @GetMapping("/{ruleId}/versions/{version}")
    public DetectionRule get(@PathVariable String ruleId, @PathVariable int version) {
        return registry.find(ruleId, version)
                .orElseThrow(() -> new RuleNotFoundException(
                        "Rule not found: '" + ruleId + "' v" + version));
    }

    /**
     * 查询指定规则当前活动版本。
     */
    @GetMapping("/{ruleId}/active")
    public DetectionRule getActive(@PathVariable String ruleId) {
        return registry.findActive(ruleId)
                .orElseThrow(() -> new RuleNotFoundException(
                        "Active rule not found: '" + ruleId + "'"));
    }

    /**
     * 查询指定规则的完整生命周期审计。
     */
    @GetMapping("/{ruleId}/audit")
    public List<RuleAuditEvent> audit(@PathVariable String ruleId) {
        return registry.audit(ruleId);
    }

    private static String now() {
        return Instant.now().toString();
    }

    /**
     * 创建规则候选的 REST 请求。
     *
     * @param ruleId          稳定规则标识
     * @param source          规则来源
     * @param languages       适用语言
     * @param frameworks      适用框架
     * @param cwe             CWE 标识
     * @param severity        严重程度
     * @param title           标题
     * @param matcherKind     matcher 类型
     * @param pattern         匹配表达式
     * @param positiveSamples 阳性回归样本
     * @param negativeSamples 阴性回归样本
     * @param changeNotes     版本变更说明
     * @param actor           操作者
     * @param reason          创建理由
     */
    public record CreateRuleRequest(
            String ruleId,
            String source,
            List<String> languages,
            List<String> frameworks,
            String cwe,
            ExternalFindingSeverity severity,
            String title,
            RuleMatcherKind matcherKind,
            String pattern,
            List<String> positiveSamples,
            List<String> negativeSamples,
            String changeNotes,
            String actor,
            String reason) {

        private DetectionRuleDraft toDraft() {
            return new DetectionRuleDraft(ruleId, source, languages, frameworks, cwe, severity, title,
                    matcherKind, pattern, positiveSamples, negativeSamples, changeNotes);
        }
    }

    /**
     * 规则生命周期操作请求。
     *
     * @param actor  操作者
     * @param reason 操作理由
     */
    public record RuleActionRequest(String actor, String reason) {
    }
}
