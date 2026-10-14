package com.repograph.api;

import com.repograph.core.securityreview.ThreatDetectionRequest;
import com.repograph.core.securityreview.ThreatDetectionService;
import com.repograph.core.securityreview.ThreatReport;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 威胁检测 REST 入口。
 *
 * <p>接收调用方提供的日志内容与外联白名单，返回结构化威胁检测报告；报告按需生成，不持久化。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/threat-detection")
public class ThreatDetectionController {

    private final ThreatDetectionService threatDetectionService;

    /**
     * 创建威胁检测控制器。
     *
     * @param threatDetectionService 威胁检测接口
     */
    public ThreatDetectionController(ThreatDetectionService threatDetectionService) {
        this.threatDetectionService = threatDetectionService;
    }

    /**
     * 执行威胁检测。
     *
     * @param request 检测请求（日志内容 + 外联白名单）
     * @return 威胁检测报告
     */
    @PostMapping("/reports")
    public ThreatReport detect(@RequestBody ThreatDetectionRequest request) {
        return threatDetectionService.detect(request);
    }
}
