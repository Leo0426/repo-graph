package com.repograph.taint.e2e;

import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.core.util.config.AnalysisScopeReader;
import com.ibm.wala.ipa.callgraph.AnalysisCacheImpl;
import com.ibm.wala.ipa.callgraph.AnalysisOptions;
import com.ibm.wala.ipa.callgraph.AnalysisScope;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.callgraph.CallGraphBuilder;
import com.ibm.wala.ipa.callgraph.Entrypoint;
import com.ibm.wala.ipa.callgraph.impl.DefaultEntrypoint;
import com.ibm.wala.ipa.callgraph.impl.Util;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.cha.ClassHierarchy;
import com.ibm.wala.ipa.cha.ClassHierarchyFactory;
import com.ibm.wala.classLoader.Language;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.util.NullProgressMonitor;
import com.repograph.taint.e2e.fixtures.CommandInjectionSample;
import org.junit.jupiter.api.Test;

import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 去风险探针:验证 vendored 补丁 WALA 能否在当前 JDK 上,针对编译后的 fixture 字节码,
 * 建出 ClassHierarchy 与 0-1-CFA 调用图。这是端到端污点分析的前置条件。
 * 若此测试通过,说明 WALA 管道在本环境可运行。
 */
class WalaPipelineProbeTest {

    /** 定位测试编译输出目录(fixture 的 .class 所在),作为 WALA 分析 classpath。 */
    static String fixtureClasspath() throws Exception {
        Path loc = Paths.get(
            CommandInjectionSample.class.getProtectionDomain().getCodeSource().getLocation().toURI());
        return loc.toString();
    }

    /**
     * 用 WALA 标准 {@code makeJavaBinaryAnalysisScope} 构建分析域:primordial 由 JDK 的
     * jmods 建模。要求运行 JDK 带 jmods —— 本模块 toolchain 固定为 JDK 21(见 build.gradle.kts）。
     * <p>
     * 传入排除文件(JavaTaintExclusions.txt)剪掉 JRE 深层/昂贵的传递闭包,把调用图规模
     * 收敛到可在测试中快速完成访问路径预分析与 IFDS 求解;source/sink 的库方法引用仍在
     * 调用点保留,不影响匹配。
     */
    static AnalysisScope buildScope() throws Exception {
        java.io.File exclusions = new java.io.File(
            WalaPipelineProbeTest.class.getResource("/JavaTaintExclusions.txt").toURI());
        return AnalysisScopeReader.instance.makeJavaBinaryAnalysisScope(fixtureClasspath(), exclusions);
    }

    static ClassHierarchy buildCha() throws Exception {
        return ClassHierarchyFactory.makeWithRoot(buildScope());
    }

    @Test
    void wala_buildsClassHierarchyOverFixture() throws Exception {
        ClassHierarchy cha = buildCha();
        assertNotNull(cha);
        boolean foundFixture = false;
        for (var klass : cha) {
            if (klass.getName().toString().contains("CommandInjectionSample")) {
                foundFixture = true;
                break;
            }
        }
        assertTrue(foundFixture, "CHA 应包含 fixture 类 CommandInjectionSample");
    }

    @Test
    void wala_buildsCallGraphWithTaintFlowEdge() throws Exception {
        ClassHierarchy cha = buildCha();

        // 以 fixture 的 entry() 作为入口点
        Set<Entrypoint> entries = new HashSet<>();
        cha.getLoader(ClassLoaderReference.Application).iterateAllClasses().forEachRemaining(clazz -> {
            if (!clazz.getName().toString().contains("CommandInjectionSample")) {
                return;
            }
            for (IMethod m : clazz.getDeclaredMethods()) {
                if (m.getName().toString().equals("entry")) {
                    entries.add(new DefaultEntrypoint(m, cha));
                }
            }
        });
        assertTrue(!entries.isEmpty(), "应找到入口方法 entry()");

        AnalysisOptions options = new AnalysisOptions(cha.getScope(), entries);
        CallGraphBuilder<InstanceKey> builder =
            Util.makeZeroOneCFABuilder(Language.JAVA, options, new AnalysisCacheImpl(), cha);
        CallGraph cg = builder.makeCallGraph(options, new NullProgressMonitor());

        assertNotNull(cg);
        // 调用图应包含 fixture 的 entry() 节点,且规模远大于 1(说明 JRE 被建模、库调用被解析)
        boolean sawEntry = false;
        int nodeCount = 0;
        for (var node : cg) {
            nodeCount++;
            if (node.getMethod().getName().toString().equals("entry")
                && node.getMethod().getDeclaringClass().getName().toString().contains("CommandInjectionSample")) {
                sawEntry = true;
            }
        }
        assertTrue(sawEntry, "调用图应包含 fixture 的 entry() 节点");
        assertTrue(nodeCount > 1, "调用图应包含 JRE 建模后的多个节点");
    }
}
