package com.repograph.taint.cli;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONWriter;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * 精确污点分析引擎的独立进程入口(方案 A)。
 * <p>
 * 由 repograph-app 以子进程方式调用(app 跑 JDK 25 无 jmods,引擎须跑带 jmods 的 JDK 21)。
 * 读取编译后 classpath + source/sink 配置,输出结构化 JSON 到 stdout 或 {@code --out} 指定文件。
 *
 * <pre>
 * 用法:
 *   java -cp &lt;engine-libs&gt; com.repograph.taint.cli.TaintScanCli \
 *        --classpath &lt;classesDirOrJar&gt; \
 *        --config    &lt;sourcesAndSinks.json&gt; \
 *        [--exclusions &lt;wala-exclusions.txt&gt;] \
 *        [--rule CWE_78] \
 *        [--entry-methods entry,handle] \  # 逗号分隔;省略则用全部 public 方法作入口
 *        [--out result.json]
 * 输出 schema:{"ruleName":..,"flowCount":N,"flows":[TaintFlowDto..]}
 * </pre>
 */
public final class TaintScanCli {

    public static void main(String[] args) {
        try {
            Map<String, String> opt = parseArgs(args);
            String classpath = require(opt, "classpath");
            String configPath = require(opt, "config");
            String rule = opt.getOrDefault("rule", "CWE_78");
            File exclusions = opt.containsKey("exclusions") ? new File(opt.get("exclusions")) : null;
            java.util.Set<String> entryMethods = opt.containsKey("entry-methods")
                ? new java.util.HashSet<>(java.util.Arrays.asList(opt.get("entry-methods").split(",")))
                : null;

            String sasJson = Files.readString(Path.of(configPath), StandardCharsets.UTF_8);

            List<TaintFlowDto> flows = TaintScanRunner.run(classpath, exclusions, sasJson, rule, entryMethods);

            String json = JSON.toJSONString(
                Map.of("ruleName", rule, "flowCount", flows.size(), "flows", flows),
                JSONWriter.Feature.PrettyFormat);

            if (opt.containsKey("out")) {
                Files.writeString(Path.of(opt.get("out")), json, StandardCharsets.UTF_8);
            } else {
                System.out.println(json);
            }
        } catch (Exception e) {
            // stderr 承载失败原因;非零退出码供 app 侧判断
            System.err.println("PRECISE_TAINT_ERROR: " + e.getClass().getName() + ": " + e.getMessage());
            System.exit(2);
        }
    }

    private static Map<String, String> parseArgs(String[] args) {
        java.util.HashMap<String, String> m = new java.util.HashMap<>();
        for (int i = 0; i < args.length; i++) {
            if (args[i].startsWith("--")) {
                String key = args[i].substring(2);
                String val = (i + 1 < args.length && !args[i + 1].startsWith("--")) ? args[++i] : "true";
                m.put(key, val);
            }
        }
        return m;
    }

    private static String require(Map<String, String> opt, String key) {
        String v = opt.get(key);
        if (v == null) {
            throw new IllegalArgumentException("missing required --" + key);
        }
        return v;
    }

    private TaintScanCli() {}
}
