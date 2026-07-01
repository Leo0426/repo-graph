package com.repograph.api;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * 渲染主界面 Thymeleaf 模板。
 */
@Controller
public class ViewController {

    @GetMapping("/")
    public String index() {
        return "index";
    }
}
