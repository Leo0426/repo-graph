package com.repograph.retrieval;

import com.repograph.core.model.CodeUnit;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 安全感知重排序器，对代码单元计算安全敏感度评分，供 GraphRAG 服务用于重排序。
 *
 * <p>评分逻辑基于静态启发式信号，不依赖外部 LLM：
 * <ul>
 *   <li>高危信号（每项 +0.3）：认证/授权方法名、安全注解、SQL 直接执行、命令执行、反序列化</li>
 *   <li>中危信号（每项 +0.2）：加密操作、输入校验、敏感字段名（password/secret/token 等）</li>
 *   <li>低危信号（每项 +0.1）：HTTP 入口注解（@CrossOrigin / @RequestBody）、框架入口点</li>
 * </ul>
 *
 * 所有信号累加后限制在 [0, 1]。
 *
 * @author leolu
 */
@Component
public class SecurityAwareReranker {

    private static final Set<String> HIGH_RISK_METHOD_KEYWORDS = Set.of(
            "authenticate", "authorize", "login", "logout",
            "verifytoken", "validatetoken", "checkpermission", "haspermission",
            "isauthorized", "isallowed", "checkaccess", "grantaccess",
            "executequery", "executebatch", "preparestatement",
            "getruntime", "processbuilder",
            "deserialize", "readobject", "fromjson"
    );

    private static final Set<String> MEDIUM_RISK_METHOD_KEYWORDS = Set.of(
            "encrypt", "decrypt", "cipher", "signcontent", "verifysignature",
            "validate", "sanitize", "escapeinput", "filterinput",
            "password", "secret", "credential", "apikey", "privatekey",
            "accesstoken", "refreshtoken", "jwtoken", "oauthtoken", "sessionid"
    );

    private static final Set<String> HIGH_RISK_ANNOTATIONS = Set.of(
            "@preauthorize", "@postauthorize", "@secured", "@rolesallowed",
            "@presecure", "@postsecure", "@withsecuritycontext"
    );

    private static final Set<String> LOW_RISK_ANNOTATIONS = Set.of(
            "@crossorigin", "@requestbody", "@requestparam", "@pathvariable"
    );

    /**
     * 单个代码单元的安全信号分析结果。
     *
     * @param score   归一化安全敏感度
     * @param signals 命中的静态信号
     */
    public record SecurityAnalysis(float score, List<String> signals) {
    }

    /**
     * 分析单个代码单元的安全敏感度。
     *
     * @param unit 待分析代码单元，不为 {@code null}
     * @return 安全分析结果，包含综合评分和触发信号列表
     */
    public SecurityAnalysis analyze(CodeUnit unit) {
        float score = 0f;
        List<String> signals = new ArrayList<>();

        String nameLower = (unit.simpleName() != null ? unit.simpleName() : "").toLowerCase(Locale.ROOT);
        String qnLower = (unit.qualifiedName() != null ? unit.qualifiedName() : "").toLowerCase(Locale.ROOT);
        List<String> annLower = unit.annotations().stream()
                .map(a -> a.toLowerCase(Locale.ROOT))
                .toList();
        String srcLower = (unit.rawSource() != null ? unit.rawSource() : "").toLowerCase(Locale.ROOT);

        // 入口点：额外的 HTTP 攻击面
        if ("true".equals(unit.metadata().get("is_entry_point"))) {
            score += 0.1f;
            signals.add("entry_point");
        }

        // 高危注解
        for (String ann : annLower) {
            for (String risk : HIGH_RISK_ANNOTATIONS) {
                if (ann.contains(risk)) {
                    score += 0.3f;
                    signals.add("security_annotation:" + risk.replace("@", ""));
                    break;
                }
            }
        }

        // 低危注解（HTTP 边界）
        for (String ann : annLower) {
            for (String risk : LOW_RISK_ANNOTATIONS) {
                if (ann.contains(risk)) {
                    score += 0.1f;
                    signals.add("http_annotation:" + risk.replace("@", ""));
                    break;
                }
            }
        }

        // 高危方法名
        for (String keyword : HIGH_RISK_METHOD_KEYWORDS) {
            if (nameLower.contains(keyword)) {
                score += 0.3f;
                signals.add("high_risk_name:" + keyword);
                break;
            }
        }

        // 中危方法名或全限定名
        for (String keyword : MEDIUM_RISK_METHOD_KEYWORDS) {
            if (nameLower.contains(keyword) || qnLower.contains("." + keyword)) {
                score += 0.2f;
                signals.add("medium_risk_name:" + keyword);
                break;
            }
        }

        // 源码级别模式：SQL 直接执行
        if (srcLower.contains("preparedstatement") || srcLower.contains(".executequery(")
                || srcLower.contains(".executeupdate(")) {
            if (signals.stream().noneMatch(s -> s.contains("sql") || s.contains("preparestatement"))) {
                score += 0.3f;
                signals.add("sql_operation");
            }
        }

        // 源码级别模式：弱密码学
        if (srcLower.contains("messagedigest") || srcLower.contains("cipher.getinstance(")
                || srcLower.contains("\"md5\"") || srcLower.contains("\"sha-1\"")) {
            if (signals.stream().noneMatch(s -> s.contains("crypto"))) {
                score += 0.2f;
                signals.add("crypto_operation");
            }
        }

        // 源码级别模式：命令注入汇聚点
        if (srcLower.contains("runtime.getruntime().exec(") || srcLower.contains("new processbuilder(")) {
            if (signals.stream().noneMatch(s -> s.contains("getruntime") || s.contains("processbuilder"))) {
                score += 0.3f;
                signals.add("command_execution");
            }
        }

        return new SecurityAnalysis(Math.min(1.0f, score), Collections.unmodifiableList(signals));
    }
}
