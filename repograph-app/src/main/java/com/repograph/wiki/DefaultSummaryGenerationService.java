package com.repograph.wiki;

import com.repograph.core.wiki.SummaryCitation;
import com.repograph.core.wiki.SummaryDocument;
import com.repograph.core.wiki.SummaryGenerationService;
import com.repograph.core.wiki.SummaryLevel;
import com.repograph.core.wiki.SummarySection;
import com.repograph.metrics.ComplexityMetric;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 分层摘要生成的确定性实现（DeepMap 借鉴设计 S1 切片）。
 *
 * <p>输入只来自 {@link StructureFactCollector} 聚合的图查询事实；输出是对事实的
 * 组织与归纳，不含任何模型生成内容。项目级结构卡 + 每包子摘要，逐文档独立生成，
 * 单包事实异常跳过并整体标记 PARTIAL（不中断其他包）。
 *
 * <p>LLM 架构摘要（S2）将在 Phase 2 扩展本服务，遵守"模型输出不改启发式事实"边界。
 *
 * @author leolu
 * @since 0.7.0
 */
@Service
public class DefaultSummaryGenerationService implements SummaryGenerationService {

    private static final Logger log = LoggerFactory.getLogger(DefaultSummaryGenerationService.class);

    private final StructureFactCollector factCollector;
    private final SummaryStore store;

    public DefaultSummaryGenerationService(StructureFactCollector factCollector, SummaryStore store) {
        this.factCollector = factCollector;
        this.store = store;
    }

    @Override
    public List<SummaryDocument> generate(String projectId) {
        ProjectStructureFacts facts = factCollector.collect(projectId);
        if (facts.unitCount() == 0) {
            log.info("Summary generation skipped — project {} has no indexed units", projectId);
            return List.of();
        }

        List<SummaryDocument> result = new ArrayList<>();
        boolean partial = false;

        try {
            result.add(store.save(projectSummary(facts)));
        } catch (Exception e) {
            partial = true;
            log.warn("Project summary generation failed for {}: {}", projectId, e.getMessage());
        }

        for (PackageFacts pkg : facts.packages()) {
            try {
                result.add(store.save(packageSummary(facts, pkg)));
            } catch (Exception e) {
                partial = true;
                log.warn("Package summary generation failed for {} / {}: {}",
                        projectId, pkg.pkg(), e.getMessage());
            }
        }

        if (partial) {
            // 任一文档失败时，已成功文档保持可用；整体状态在响应中如实呈现
            log.warn("Summary generation completed partially for {}", projectId);
        }
        return List.copyOf(result);
    }

    // ── 项目级结构卡 ──────────────────────────────────────────────────────────

    private SummaryDocument projectSummary(ProjectStructureFacts facts) {
        List<SummarySection> sections = new ArrayList<>();
        Set<SummaryCitation> citations = new LinkedHashSet<>();

        sections.add(new SummarySection("项目概述", """
                - 代码单元总数：%d
                - 包数量：%d
                - 入口点单元：%d
                - 疑似死代码单元：%d（图拓扑启发式，反射调用可能误报）
                - 跨包调用边（按类聚合去重）：%d
                """.formatted(facts.unitCount(), facts.packages().size(),
                facts.entryPointCount(), facts.deadCodeCount(), facts.crossPackageEdgeCount())));

        StringBuilder modules = new StringBuilder(
                "| 包 | 单元数 | 入口点 | 被调用(入) | 调用出 |\n|---|---:|---:|---:|---:|\n");
        for (PackageFacts pkg : facts.packages()) {
            modules.append("| %s | %d | %d | %d | %d |\n".formatted(
                    pkg.pkg(), pkg.unitCount(), pkg.entryPointCount(),
                    pkg.inboundCalls(), pkg.outboundCalls()));
        }
        sections.add(new SummarySection("模块划分", modules.toString()));

        StringBuilder chains = new StringBuilder();
        facts.packages().stream()
                .filter(p -> p.inboundCalls() > 0)
                .limit(10)
                .forEach(p -> chains.append("- `%s`：被其他包调用 %d 次，关键符号 %s%n"
                        .formatted(p.pkg(), p.inboundCalls(), String.join(", ", p.keySymbols()))));
        if (chains.isEmpty()) {
            chains.append("- 未发现跨包调用边（可能为单包项目或调用均解析在同包内）\n");
        }
        sections.add(new SummarySection("入口与调用链", chains.toString()));

        StringBuilder hotspots = new StringBuilder();
        for (ComplexityMetric metric : facts.complexityTop().stream().limit(10).toList()) {
            hotspots.append("- `%s` — CC=%d（%s:%d）%n".formatted(
                    metric.qualifiedName(), metric.complexity(),
                    metric.filePath(), metric.startLine()));
            citations.add(new SummaryCitation(metric.qualifiedName(), metric.filePath(),
                    metric.startLine(), metric.startLine()));
        }
        if (hotspots.isEmpty()) {
            hotspots.append("- 无圈复杂度 > 1 的方法\n");
        }
        sections.add(new SummarySection("复杂度热点", hotspots.toString()));

        sections.add(new SummarySection("说明", """
                本文档由图查询事实确定性生成（无 LLM 参与），只描述图内可验证的结构事实。
                LLM 架构摘要未启用；本摘要不参与漏洞研判，也不修改任何启发式事实。
                """));

        int version = store.nextDocVersion(facts.projectId(), SummaryDocument.PROJECT_SCOPE);
        return new SummaryDocument(null, facts.projectId(), SummaryLevel.PROJECT,
                SummaryDocument.PROJECT_SCOPE, "项目结构摘要（v" + version + "）",
                sections, List.copyOf(citations), version,
                Instant.now().toString(), SummaryDocument.STATUS_COMPLETED);
    }

    // ── 包级子摘要 ────────────────────────────────────────────────────────────

    private SummaryDocument packageSummary(ProjectStructureFacts facts, PackageFacts pkg) {
        List<SummarySection> sections = new ArrayList<>();
        Set<SummaryCitation> citations = new LinkedHashSet<>();

        sections.add(new SummarySection("包职责（事实）", """
                - 代码单元数：%d
                - 入口点单元：%d
                - 被其他包调用：%d 次
                - 调用其他包：%d 次
                """.formatted(pkg.unitCount(), pkg.entryPointCount(),
                pkg.inboundCalls(), pkg.outboundCalls())));

        StringBuilder interfaceDesc = new StringBuilder();
        if (pkg.keySymbols().isEmpty()) {
            interfaceDesc.append("- 未识别出关键对外符号\n");
        } else {
            for (String symbol : pkg.keySymbols()) {
                interfaceDesc.append("- `%s`\n".formatted(symbol));
                SummaryCitation citation = citationFor(facts, symbol);
                if (citation != null) citations.add(citation);
            }
        }
        sections.add(new SummarySection("对外依赖面", interfaceDesc.toString()));

        StringBuilder risks = new StringBuilder();
        facts.complexityTop().stream()
                .filter(m -> pkg.pkg().equals(pkgNameOf(m.qualifiedName())))
                .limit(5)
                .forEach(m -> {
                    risks.append("- `%s` — CC=%d（%s:%d）%n".formatted(
                            m.qualifiedName(), m.complexity(), m.filePath(), m.startLine()));
                    citations.add(new SummaryCitation(m.qualifiedName(), m.filePath(),
                            m.startLine(), m.startLine()));
                });
        if (pkg.entryPointCount() > 0) {
            risks.append("- 包含 %d 个入口点单元（外部请求可达性更高）%n".formatted(pkg.entryPointCount()));
        }
        if (risks.isEmpty()) {
            risks.append("- 无显著风险信号\n");
        }
        sections.add(new SummarySection("风险信号", risks.toString()));

        int version = store.nextDocVersion(facts.projectId(), pkg.pkg());
        return new SummaryDocument(null, facts.projectId(), SummaryLevel.PACKAGE,
                pkg.pkg(), "包摘要：" + pkg.pkg() + "（v" + version + "）",
                sections, List.copyOf(citations), version,
                Instant.now().toString(), SummaryDocument.STATUS_COMPLETED);
    }

    private SummaryCitation citationFor(ProjectStructureFacts facts, String qualifiedName) {
        for (ComplexityMetric metric : facts.complexityTop()) {
            if (metric.qualifiedName().equals(qualifiedName)) {
                return new SummaryCitation(metric.qualifiedName(), metric.filePath(),
                        metric.startLine(), metric.startLine());
            }
        }
        return null;
    }

    /** 复杂度指标的包名；无包结构（裸函数）归入 {@link PackageFacts#ROOT_PACKAGE}。 */
    private static String pkgNameOf(String qualifiedName) {
        String pkg = com.repograph.metrics.PackageCycleDetector.extractPackage(qualifiedName);
        return pkg.isEmpty() ? PackageFacts.ROOT_PACKAGE : pkg;
    }
}
