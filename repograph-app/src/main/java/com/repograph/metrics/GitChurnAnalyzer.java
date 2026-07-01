package com.repograph.metrics;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectInfo;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * Git 变更频率 × 圈复杂度热点分析器（Adam Tornhill 方法）。
 *
 * <p>算法分三步：
 * <ol>
 *   <li>在项目根目录执行 {@code git log --format= --name-only --max-count=1000}，
 *       统计最近 1000 次提交中每个文件被修改的次数（变更频率 / Churn）。</li>
 *   <li>从 {@link ComplexityAnalyzer} 获取方法级圈复杂度，按文件聚合为平均 CC。</li>
 *   <li>取两者交集（同时有 Git 记录和复杂度数据的文件），计算热点分并排序。</li>
 * </ol>
 *
 * <p>热点分 = {@code ln(churnCount + 1) × avgComplexity}。
 * 对数压缩使高频变更文件不会完全掩盖低频但极复杂的文件。
 *
 * <p>若项目不在 Git 仓库中，或 Git 命令超时（30 秒），返回空列表，不抛异常。
 *
 * @author leolu
 * @since 0.7.0
 */
@Service
public class GitChurnAnalyzer {

    private static final Logger log = LoggerFactory.getLogger(GitChurnAnalyzer.class);

    private static final int MAX_COMMITS = 1000;
    private static final int GIT_TIMEOUT_SECONDS = 30;

    private final GraphQueryService graphQueryService;
    private final ComplexityAnalyzer complexityAnalyzer;

    public GitChurnAnalyzer(GraphQueryService graphQueryService,
                            ComplexityAnalyzer complexityAnalyzer) {
        this.graphQueryService = graphQueryService;
        this.complexityAnalyzer = complexityAnalyzer;
    }

    /**
     * 返回指定项目热点分最高的前 {@code limit} 个源文件。
     *
     * @param projectId 项目唯一标识符
     * @param limit     最大返回数量
     * @return 按热点分降序排列的热点列表；若无 Git 历史或无复杂度数据则返回空列表
     */
    public List<HotspotMetric> topHotspots(String projectId, int limit) {
        String projectRoot = graphQueryService.listProjects().stream()
                .filter(p -> projectId.equals(p.projectId()))
                .map(ProjectInfo::projectRoot)
                .findFirst()
                .orElse(null);
        if (projectRoot == null || projectRoot.isBlank()) {
            log.debug("No projectRoot found for projectId={}", projectId);
            return List.of();
        }

        Map<String, Integer> churn = gitFileChurn(projectRoot);
        if (churn.isEmpty()) return List.of();

        // 按文件路径分组复杂度
        List<ComplexityMetric> allMetrics = complexityAnalyzer.topComplex(projectId, 10_000);
        Map<String, List<ComplexityMetric>> byFile = allMetrics.stream()
                .collect(Collectors.groupingBy(ComplexityMetric::filePath));

        List<HotspotMetric> hotspots = new ArrayList<>();
        for (Map.Entry<String, List<ComplexityMetric>> entry : byFile.entrySet()) {
            String filePath = entry.getKey();
            List<ComplexityMetric> methods = entry.getValue();

            // 规范化路径分隔符以跨平台匹配
            String normalizedPath = filePath.replace('\\', '/');
            // churn map 可能使用系统路径分隔符
            Integer fileChurn = churn.get(normalizedPath);
            if (fileChurn == null) {
                // 尝试反斜杠（Windows git 输出）
                fileChurn = churn.get(filePath.replace('/', '\\'));
            }
            if (fileChurn == null || fileChurn == 0) continue;

            double avgCC = methods.stream()
                    .mapToInt(ComplexityMetric::complexity)
                    .average()
                    .orElse(1.0);
            double score = Math.log(fileChurn + 1) * avgCC;

            hotspots.add(new HotspotMetric(
                    filePath,
                    fileChurn,
                    methods.size(),
                    Math.round(avgCC * 100.0) / 100.0,
                    Math.round(score * 100.0) / 100.0));
        }

        return hotspots.stream()
                .sorted(Comparator.comparingDouble(HotspotMetric::hotspotScore).reversed())
                .limit(limit)
                .toList();
    }

    /**
     * 在 {@code projectRoot} 目录中执行 git log，返回文件→变更次数映射。
     *
     * <p>package-private 以允许测试时通过子类覆盖，无需真实 Git 环境。
     */
    Map<String, Integer> gitFileChurn(String projectRoot) {
        try {
            ProcessBuilder pb = new ProcessBuilder(
                    "git", "log",
                    "--format=",           // 不输出提交头信息
                    "--name-only",         // 仅输出受影响的文件名
                    "--max-count=" + MAX_COMMITS);
            pb.directory(new File(projectRoot));
            pb.redirectErrorStream(true);
            Process process = pb.start();

            Map<String, Integer> counts = new HashMap<>();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    line = line.trim();
                    if (!line.isEmpty()) {
                        counts.merge(line, 1, Integer::sum);
                    }
                }
            }

            boolean finished = process.waitFor(GIT_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                log.warn("git log timed out after {} seconds in {}", GIT_TIMEOUT_SECONDS, projectRoot);
                return Map.of();
            }
            return counts;
        } catch (Exception e) {
            log.debug("git churn analysis unavailable for {}: {}", projectRoot, e.getMessage());
            return Map.of();
        }
    }
}
