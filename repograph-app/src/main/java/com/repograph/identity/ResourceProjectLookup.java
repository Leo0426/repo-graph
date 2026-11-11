package com.repograph.identity;

import com.repograph.agent.AgentRunStore;
import com.repograph.asset.ImportedAssetStore;
import com.repograph.finding.ReviewQueueStore;
import com.repograph.finding.RuleSuppressionStore;
import com.repograph.scanner.ScanTaskStore;
import com.repograph.scanner.ScannerRunStore;
import com.repograph.vuln.VulnStore;
import com.repograph.wiki.SummaryStore;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

/** Resolves opaque resource IDs through their authoritative stores, never through caller-supplied project IDs. @author leolu */
@Component
public class ResourceProjectLookup {
    private final ObjectProvider<SummaryStore> summaries;
    private final ObjectProvider<VulnStore> vulnerabilities;
    private final ObjectProvider<AgentRunStore> agents;
    private final ObjectProvider<ImportedAssetStore> assets;
    private final ObjectProvider<ScanTaskStore> tasks;
    private final ObjectProvider<ScannerRunStore> scans;
    private final ObjectProvider<ReviewQueueStore> reviews;
    private final ObjectProvider<RuleSuppressionStore> suppressions;

    /** Creates lazy store bindings without forcing unrelated database initialization during a request. */
    public ResourceProjectLookup(ObjectProvider<SummaryStore> summaries, ObjectProvider<VulnStore> vulnerabilities,
                                 ObjectProvider<AgentRunStore> agents, ObjectProvider<ImportedAssetStore> assets,
                                 ObjectProvider<ScanTaskStore> tasks, ObjectProvider<ScannerRunStore> scans,
                                 ObjectProvider<ReviewQueueStore> reviews, ObjectProvider<RuleSuppressionStore> suppressions) {
        this.summaries = summaries;
        this.vulnerabilities = vulnerabilities;
        this.agents = agents;
        this.assets = assets;
        this.tasks = tasks;
        this.scans = scans;
        this.reviews = reviews;
        this.suppressions = suppressions;
    }

    /** Returns the persisted project owner, or null when a resource does not exist. */
    public String project(ProjectAccess.Resource resource, String id) {
        if (id == null || id.isBlank()) return null;
        return switch (resource) {
            case PROJECT -> id;
            case SUMMARY -> summaries.getObject().findById(id).map(value -> value.projectId()).orElse(null);
            case VULNERABILITY -> vulnerabilities.getObject().findById(id).map(value -> value.projectId()).orElse(null);
            case AGENT_RUN -> agents.getObject().get(id).map(value -> value.projectId()).orElse(null);
            case ASSET -> assets.getObject().findById(id).map(value -> value.projectId()).orElse(null);
            case SCAN_TASK -> tasks.getObject().find(id).map(value -> value.projectId()).orElse(null);
            case SCAN_RUN -> scans.getObject().findRun(id).map(value -> value.projectId()).orElse(null);
            case SNAPSHOT -> reviews.getObject().getSnapshot(id).map(value -> value.projectId()).orElse(null);
            case REVIEW_ENTRY -> reviews.getObject().findEntry(id).map(value -> value.projectId()).orElse(null);
            case SUPPRESSION -> suppressions.getObject().findById(id).map(value -> value.projectId()).orElse(null);
        };
    }
}
