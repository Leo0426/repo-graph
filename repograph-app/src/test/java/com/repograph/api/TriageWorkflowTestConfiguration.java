package com.repograph.api;

import com.repograph.core.finding.TriageWorkflow;
import com.repograph.finding.*;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import java.time.Clock;
import java.util.List;

@TestConfiguration
class TriageWorkflowTestConfiguration {
    @Bean
    TriageWorkflow workflow(List<ExternalFindingImporter> importers, FindingContextService contexts,
                            TriageReportService reports, TriageFeedbackStore feedback,
                            RuleSuppressionStore suppressions) {
        return new DefaultTriageWorkflow(importers, contexts, reports, feedback, suppressions, Clock.systemUTC());
    }
}
