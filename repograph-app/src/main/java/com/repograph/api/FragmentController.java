package com.repograph.api;

import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.util.Map;

/**
 * HTMX 片段端点——返回 Thymeleaf HTML 片段供客户端局部替换。
 * 当前提供健康状态片段，供面板以 {@code hx-trigger="load, every 5s"} 轮询。
 */
@Controller
@RequestMapping("/api/fragments")
public class FragmentController {

    private final HealthService healthService;

    public FragmentController(HealthService healthService) {
        this.healthService = healthService;
    }

    /** 返回健康卡片 HTML 片段（含 OOB header badge 更新）。 */
    @GetMapping("/health")
    public String healthFragment(Model model) {
        Map<String, String> status = healthService.check();
        String qdrant = status.getOrDefault("qdrant", "unknown");
        String ollama = status.getOrDefault("ollama", "unknown");
        String neo4j  = status.getOrDefault("neo4j",  "unknown");
        model.addAttribute("qdrant", qdrant);
        model.addAttribute("ollama", ollama);
        model.addAttribute("neo4j",  neo4j);
        model.addAttribute("qdrantCls", toCardClass(qdrant));
        model.addAttribute("ollamaCls", toCardClass(ollama));
        model.addAttribute("neo4jCls",  toCardClass(neo4j));
        model.addAttribute("qdrantDot", toDotClass(qdrant));
        model.addAttribute("ollamaDot", toDotClass(ollama));
        model.addAttribute("neo4jDot",  toDotClass(neo4j));
        return "fragments/health-cards :: health-cards";
    }

    private String toCardClass(String status) {
        if ("ok".equals(status)) return "h-ok";
        if (status != null && status.contains("error")) return "h-err";
        return "h-unknown";
    }

    private String toDotClass(String status) {
        if ("ok".equals(status)) return "ok";
        if (status != null && status.contains("error")) return "error";
        return "checking";
    }
}
