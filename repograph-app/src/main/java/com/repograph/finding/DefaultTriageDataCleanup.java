package com.repograph.finding;

import com.repograph.core.finding.TriageDataCleanup;
import org.springframework.stereotype.Service;

/**
 * SQLite 研判反馈和规则抑制的项目级清理协调器。
 *
 * @author leolu
 */
@Service
public class DefaultTriageDataCleanup implements TriageDataCleanup {

    private final TriageFeedbackStore feedbackStore;
    private final RuleSuppressionStore suppressionStore;

    /**
     * 创建研判数据清理协调器。
     *
     * @param feedbackStore    历史反馈存储
     * @param suppressionStore 规则抑制存储
     */
    public DefaultTriageDataCleanup(
            TriageFeedbackStore feedbackStore,
            RuleSuppressionStore suppressionStore) {
        this.feedbackStore = feedbackStore;
        this.suppressionStore = suppressionStore;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void removeProject(String projectId) {
        feedbackStore.removeProject(projectId);
        suppressionStore.removeProject(projectId);
    }
}
