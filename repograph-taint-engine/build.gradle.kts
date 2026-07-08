plugins {
    id("java-library")
    id("application")
}

// 独立进程分发(方案 A):repograph-app 以子进程调用 TaintScanCli。
// `./gradlew :repograph-taint-engine:installDist` 生成 build/install/repograph-taint-engine/
// (bin/ 启动脚本 + lib/ 全部依赖 jar),app 侧用带 jmods 的 JDK 21 运行其 lib/*。
application {
    mainClass.set("com.repograph.taint.cli.TaintScanCli")
    applicationName = "repograph-taint-engine"
}

// IFDS 污点引擎(WALA-based)。
//
// 依赖被打过访问修饰符补丁的 WALA fork:
//   - com.ibm.wala.dataflow.IFDS.TabulationSolver 的 processNormal / propToReturnSite
//     由 private 改为 public,supergraph / flowFunctionMap 等成员改为 public,
//     pathEdges 结构由 Map<T,LocalPathEdges> 改为 Map<P,Map<T,LocalPathEdges>>。
//   - 官方 Maven Central 版本无法编译本引擎,故 vendor 补丁 jar 至 libs/。
// 补丁 jar 来源:WALA checkout 分支 cb205619d(1.6.10-SNAPSHOT)。
repositories {
    flatDir { dirs("libs") }
}

dependencies {
    api(files("libs/com.ibm.wala.core-1.6.10-SNAPSHOT.jar"))
    api(files("libs/com.ibm.wala.util-1.6.10-SNAPSHOT.jar"))
    api(files("libs/com.ibm.wala.shrike-1.6.10-SNAPSHOT.jar"))

    // WALA 传递依赖(flatDir 不带 POM,需手动声明)
    implementation("com.google.guava:guava:32.0.0-jre")
    implementation("com.google.code.gson:gson:2.10.1")
    implementation("commons-io:commons-io:2.15.1")

    // 引擎自身:source/sink 配置解析、AST 辅助
    implementation("com.alibaba.fastjson2:fastjson2:2.0.44")
    implementation("org.dom4j:dom4j:2.1.4")
    implementation("org.javassist:javassist:3.30.2-GA")

    // 报告/输出层(copied 自 clouditera-report,后续将映射到 repo-graph VulnFinding/TaintPath)
    implementation("com.fasterxml.jackson.core:jackson-databind:2.14.2")
    implementation("com.fasterxml.jackson.dataformat:jackson-dataformat-yaml:2.14.2")
    // 规则反射注册
    implementation("org.reflections:reflections:0.10.2")

    implementation("org.slf4j:slf4j-api")

    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testRuntimeOnly("org.slf4j:slf4j-simple:2.0.9")
}

// WALA 需要带 jmods 的 JDK 建 JRE primordial 模型(本机 JDK 25 无 jmods,会报
// NoSuchFileException: .../jmods)。引擎源自 Java 17 工程,用带 jmods 的 JDK 21(LTS)
// 编译并运行测试;产物字节码 21 仍被 JDK 25 的 repograph-app 加载。
// 注意:引擎运行时同样需要带 jmods 的 JDK —— 见 CONTEXT.md ADR。
java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

// 引擎源自 Java 17 工程,WALA API 触发大量 lint 警告;放宽 -Werror 语义,
// 保留告警但不失败(根 build.gradle.kts 注入了 -Xlint:all)。
tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.add("-Xlint:none")
}

// 引擎与 WALA 大量使用 assert 作为开发期不变量检查,生产运行(Engine)不带 -ea。
// Gradle 测试 JVM 默认开启断言,会触发这些非生产路径的 AssertionError;关闭断言以
// 镜像引擎真实运行模式。
tasks.withType<Test>().configureEach {
    enableAssertions = false
    // 引擎有进程级共享可变状态(如 DomainElement.ZERO 被 TaintDomain.add 就地合并 Info),
    // 生产每次扫描为独立进程故无碍;测试同 JVM 连续跑多次分析会相互污染,产生顺序依赖的
    // flaky。每个测试类新起 JVM,镜像生产的进程隔离。
    setForkEvery(1)
}
