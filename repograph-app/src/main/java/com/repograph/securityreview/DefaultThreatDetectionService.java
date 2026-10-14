package com.repograph.securityreview;

import com.repograph.core.securityreview.AuditSeverity;
import com.repograph.core.securityreview.ThreatDetectionRequest;
import com.repograph.core.securityreview.ThreatDetectionService;
import com.repograph.core.securityreview.ThreatKind;
import com.repograph.core.securityreview.ThreatRecord;
import com.repograph.core.securityreview.ThreatReport;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.MatchResult;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 威胁检测服务默认实现。
 *
 * <p>规则从 classpath {@code security-review/threat-rules/*.json} 加载；对每份日志逐行执行
 * 正则规则：逐行规则每命中一行产出一条记录，聚合规则（minCount）按文件计数达到阈值产出一条
 * 记录，外联规则先与白名单比对、命中白名单不记录。白名单外的正常行为不会被记录，保证正常日志零误报。
 *
 * @author leolu
 */
@Component
public class DefaultThreatDetectionService implements ThreatDetectionService {

    /** 威胁规则集 classpath 位置。 */
    static final String RULES_LOCATION = "classpath*:security-review/threat-rules/*.json";

    private final List<ThreatRuleSpec> rules;

    /**
     * 创建检测服务并加载 classpath 规则集。
     */
    public DefaultThreatDetectionService() {
        this.rules = new ClasspathRuleSetLoader<ThreatRuleSpec>(ThreatRuleSpec.class).load(RULES_LOCATION);
    }

    /**
     * 以显式规则集创建检测服务，供测试注入。
     *
     * @param rules 检测规则列表
     */
    DefaultThreatDetectionService(List<ThreatRuleSpec> rules) {
        this.rules = List.copyOf(rules);
    }

    @Override
    public ThreatReport detect(ThreatDetectionRequest request) {
        OutboundWhitelist whitelist = new OutboundWhitelist(request.outboundWhitelist());
        List<ThreatRecord> records = new ArrayList<>();
        for (ThreatDetectionRequest.ThreatDetectionLog log : request.logs()) {
            records.addAll(detectLog(log, whitelist));
        }
        records.sort(Comparator.comparing(ThreatRecord::logFile)
                .thenComparingInt(ThreatRecord::lineNumber));
        return new ThreatReport(request.logs().size(), records, Instant.now());
    }

    private List<ThreatRecord> detectLog(
            ThreatDetectionRequest.ThreatDetectionLog log, OutboundWhitelist whitelist) {
        List<ThreatRecord> records = new ArrayList<>();
        String[] lines = log.content() == null ? new String[0] : log.content().split("\r?\n");
        for (ThreatRuleSpec rule : rules) {
            Pattern pattern = Pattern.compile(rule.pattern());
            Pattern timePattern = rule.timePattern() == null ? null : Pattern.compile(rule.timePattern());
            if (rule.minCount() == null) {
                records.addAll(detectLineByLine(rule, pattern, timePattern, log, whitelist));
            } else {
                ThreatRecord aggregated = detectAggregated(rule, pattern, timePattern, log, whitelist);
                if (aggregated != null) {
                    records.add(aggregated);
                }
            }
        }
        return records;
    }

    private List<ThreatRecord> detectLineByLine(
            ThreatRuleSpec rule, Pattern pattern, Pattern timePattern,
            ThreatDetectionRequest.ThreatDetectionLog log, OutboundWhitelist whitelist) {
        List<ThreatRecord> records = new ArrayList<>();
        String[] lines = log.content().split("\r?\n");
        for (int i = 0; i < lines.length; i++) {
            Matcher matcher = pattern.matcher(lines[i]);
            while (matcher.find()) {
                if (rule.whitelistChecked()
                        && whitelist.contains(matcher.group(rule.group()))) {
                    continue;
                }
                records.add(record(rule, matcher, timePattern, log.name(), i + 1, lines[i], 0));
            }
        }
        return records;
    }

    private ThreatRecord detectAggregated(
            ThreatRuleSpec rule, Pattern pattern, Pattern timePattern,
            ThreatDetectionRequest.ThreatDetectionLog log, OutboundWhitelist whitelist) {
        int count = 0;
        String[] lines = log.content().split("\r?\n");
        MatchResult first = null;
        int firstLine = -1;
        for (int i = 0; i < lines.length; i++) {
            Matcher matcher = pattern.matcher(lines[i]);
            while (matcher.find()) {
                if (rule.whitelistChecked()
                        && whitelist.contains(matcher.group(rule.group()))) {
                    continue;
                }
                count++;
                if (first == null) {
                    first = matcher.toMatchResult();
                    firstLine = i + 1;
                }
            }
        }
        if (count < rule.minCount()) {
            return null;
        }
        return record(rule, first, timePattern, log.name(), firstLine, lines[firstLine - 1], count);
    }

    private ThreatRecord record(
            ThreatRuleSpec rule, MatchResult match, Pattern timePattern,
            String logFile, int lineNumber, String evidence, int count) {
        String detail = rule.detailTemplate() == null ? rule.ruleId() : rule.detailTemplate();
        if (count > 0) {
            detail = detail.replace("{count}", String.valueOf(count));
        }
        for (int g = 1; g <= match.groupCount(); g++) {
            String value = match.group(g) == null ? "" : match.group(g);
            detail = detail.replace("{" + g + "}", value);
        }
        String time = null;
        if (timePattern != null) {
            Matcher timeMatcher = timePattern.matcher(evidence);
            if (timeMatcher.find()) {
                time = timeMatcher.group(1);
            }
        }
        return new ThreatRecord(rule.ruleId(), rule.kind(), rule.severity(), time,
                logFile, lineNumber, evidence.strip(), detail);
    }
}
