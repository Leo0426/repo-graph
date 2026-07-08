package com.repograph.taint.e2e;

import com.repograph.taint.cli.TaintFlowDto;
import com.repograph.taint.cli.TaintScanRunner;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 端到端集成测试:通过可复用管道 {@link TaintScanRunner}(即独立进程 CLI 内部使用的同一条管道)
 * 在编译后的 fixture 字节码上运行完整 WALA + IFDS 分析,断言检出 source -> sink 命令注入污点流。
 * <p>
 * 需要带 jmods 的 JDK(本模块 toolchain=21);断言在 test task 中被关闭(镜像生产)。
 */
// 引擎有进程级共享可变状态(DomainElement.ZERO 被就地合并 Info),生产每次扫描独立进程无碍;
// 测试同 JVM 连跑多次分析会污染 ZERO,故强制正向用例先跑(此时 ZERO 干净)。
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class TaintAnalysisEndToEndTest {

    private static final String SAS_JSON = """
        {
          "Sources": [
            {"DeclaringClass":"Ljava/lang/System","ReturnType":"Ljava/lang/String","MethodName":"getenv","ArgTypes":"Ljava/lang/String","BelongTo":"CWE_78","BugLevel":"high"}
          ],
          "Sinks": [
            {"DeclaringClass":"Ljava/lang/Runtime","ReturnType":"Ljava/lang/Process","MethodName":"exec","ArgTypes":"Ljava/lang/String","BelongTo":"CWE_78","AnySource2SpecialArg":[{"Index":1}]}
          ]
        }
        """;

    /** 入口方法过滤:只把 fixture 的 entry() 作为分析入口,聚焦目标、避免 test 输出目录里其它类干扰。 */
    private static final java.util.Set<String> ENTRY = java.util.Set.of("entry");

    /** fixture 编译输出目录(整个 test classes 目录),作为 WALA 分析 classpath。 */
    private static String fixtureClasspath() throws Exception {
        return Paths.get(
            com.repograph.taint.e2e.fixtures.CommandInjectionSample.class
                .getProtectionDomain().getCodeSource().getLocation().toURI()).toString();
    }

    @Test
    @Order(1)
    void detectsCommandInjectionFlow() throws Exception {
        List<TaintFlowDto> flows = TaintScanRunner.run(fixtureClasspath(), null, SAS_JSON, "CWE_78", ENTRY);

        assertFalse(flows.isEmpty(),
            "fixture 的 entry() 中 Runtime.exec(System.getenv()) 构成命令注入,应被检出");
        assertTrue(flows.stream().allMatch(f -> "CWE_78".equals(f.ruleName())),
            "所有流都应标记为 CWE_78 规则");
        // getTo() 报告 sink 命中点的所属方法(污点到达位置),即 fixture 的 entry()。
        assertTrue(flows.stream().anyMatch(f -> f.sinkClass().contains("CommandInjectionSample")),
            "污点流应命中 fixture CommandInjectionSample 内的 sink 调用点");
    }

    @Test
    @Order(2)
    void noFlow_forEmptyConfig() throws Exception {
        // 空的 source/sink 配置 → 不应报出任何污点流(负向对照)
        List<TaintFlowDto> flows = TaintScanRunner.run(
            fixtureClasspath(), null, "{\"Sources\":[],\"Sinks\":[]}", "CWE_78", ENTRY);
        assertTrue(flows.isEmpty(), "无 source/sink 定义时不应有污点流");
    }
}
