package com.repograph.api;

import com.repograph.core.securityreview.AuditDimension;
import com.repograph.core.securityreview.AuditSeverity;
import com.repograph.core.securityreview.ConfigAuditReport;
import com.repograph.core.securityreview.ConfigAuditRequest;
import com.repograph.core.securityreview.ConfigAuditService;
import com.repograph.core.securityreview.ConfigViolation;
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
 * {@link ConfigAuditController} 单元测试，验证核查端点的请求/响应契约。
 *
 * @author leolu
 * @since 0.9.0
 */
@WebMvcTest(ConfigAuditController.class)
class ConfigAuditControllerTest {

    @Autowired MockMvc mvc;

    @MockBean ConfigAuditService configAuditService;

    @Test
    void audit_returnsReportJson() throws Exception {
        when(configAuditService.audit(any(ConfigAuditRequest.class))).thenReturn(new ConfigAuditReport(
                List.of(AuditDimension.SECURITY_POLICY), 5, 1,
                List.of(new ConfigViolation("policy-permit-root-login", AuditDimension.SECURITY_POLICY,
                        AuditSeverity.HIGH, "sshd_config", 2, "PermitRootLogin yes",
                        "安全策略—远程登录管理", "设置为 no")),
                Instant.parse("2026-10-14T00:00:00Z")));

        mvc.perform(post("/api/v1/config-audit/reports")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "files": [{"name": "sshd_config", "content": "PermitRootLogin yes\\n"}],
                                  "dimensions": ["SECURITY_POLICY"]
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.dimensionsAudited[0]").value("SECURITY_POLICY"))
                .andExpect(jsonPath("$.checkedRules").value(5))
                .andExpect(jsonPath("$.scannedFiles").value(1))
                .andExpect(jsonPath("$.violations[0].ruleId").value("policy-permit-root-login"))
                .andExpect(jsonPath("$.violations[0].lineNumber").value(2))
                .andExpect(jsonPath("$.violations[0].severity").value("HIGH"))
                .andExpect(jsonPath("$.generatedAt").value("2026-10-14T00:00:00Z"));
    }

    @Test
    void audit_emptyViolations_returnsEmptyList() throws Exception {
        when(configAuditService.audit(any(ConfigAuditRequest.class))).thenReturn(new ConfigAuditReport(
                List.of(), 0, 1, List.of(), Instant.parse("2026-10-14T00:00:00Z")));

        mvc.perform(post("/api/v1/config-audit/reports")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"files": [{"name": "empty.conf", "content": ""}]}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.violations").isEmpty())
                .andExpect(jsonPath("$.dimensionsAudited").isEmpty());
    }
}
