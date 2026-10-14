package com.repograph.api;

import com.repograph.core.securityreview.AuditSeverity;
import com.repograph.core.securityreview.ThreatDetectionRequest;
import com.repograph.core.securityreview.ThreatDetectionService;
import com.repograph.core.securityreview.ThreatKind;
import com.repograph.core.securityreview.ThreatRecord;
import com.repograph.core.securityreview.ThreatReport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link ThreatDetectionController} 单元测试，验证威胁检测端点的请求/响应契约。
 *
 * @author leolu
 * @since 0.9.0
 */
@WebMvcTest(ThreatDetectionController.class)
class ThreatDetectionControllerTest {

    @Autowired MockMvc mvc;

    @MockBean ThreatDetectionService threatDetectionService;

    @Test
    void detect_returnsReportJson() throws Exception {
        when(threatDetectionService.detect(any(ThreatDetectionRequest.class))).thenReturn(new ThreatReport(
                1, List.of(new ThreatRecord("outbound-iptables-dst", ThreatKind.VIOLATION_OUTBOUND,
                        AuditSeverity.HIGH, "Oct 13 10:00:01", "firewall.log", 1,
                        "DST=8.8.8.8", "违规外联：目标 8.8.8.8 不在允许列表")),
                Instant.parse("2026-10-14T00:00:00Z")));

        mvc.perform(post("/api/v1/threat-detection/reports")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "logs": [{"name": "firewall.log", "content": "DST=8.8.8.8\\n"}],
                                  "outboundWhitelist": ["10.0.0.0/8"]
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scannedLogs").value(1))
                .andExpect(jsonPath("$.records[0].ruleId").value("outbound-iptables-dst"))
                .andExpect(jsonPath("$.records[0].kind").value("VIOLATION_OUTBOUND"))
                .andExpect(jsonPath("$.records[0].time").value("Oct 13 10:00:01"))
                .andExpect(jsonPath("$.records[0].lineNumber").value(1))
                .andExpect(jsonPath("$.generatedAt").value("2026-10-14T00:00:00Z"));
    }

    @Test
    void detect_noRecords_returnsEmptyList() throws Exception {
        when(threatDetectionService.detect(any(ThreatDetectionRequest.class))).thenReturn(new ThreatReport(
                1, List.of(), Instant.parse("2026-10-14T00:00:00Z")));

        mvc.perform(post("/api/v1/threat-detection/reports")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"logs": [{"name": "clean.log", "content": "systemd started"}]}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.records").isEmpty());
    }
}
