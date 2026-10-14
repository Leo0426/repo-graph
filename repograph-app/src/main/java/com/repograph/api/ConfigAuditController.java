package com.repograph.api;

import com.repograph.core.securityreview.ConfigAuditReport;
import com.repograph.core.securityreview.ConfigAuditRequest;
import com.repograph.core.securityreview.ConfigAuditService;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 配置核查 REST 入口。
 *
 * <p>接收调用方提供的配置文件内容并返回结构化核查报告；报告按需生成，不持久化。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/config-audit")
public class ConfigAuditController {

    private final ConfigAuditService configAuditService;

    /**
     * 创建配置核查控制器。
     *
     * @param configAuditService 配置核查接口
     */
    public ConfigAuditController(ConfigAuditService configAuditService) {
        this.configAuditService = configAuditService;
    }

    /**
     * 执行配置核查。
     *
     * @param request 核查请求（文件内容 + 维度过滤）
     * @return 核查报告
     */
    @PostMapping("/reports")
    public ConfigAuditReport audit(@RequestBody ConfigAuditRequest request) {
        return configAuditService.audit(request);
    }
}
