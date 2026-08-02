# repograph-taint-engine

> **⚠️ 试验性模块，暂时引入。
> 以最小改动原样落地，用于验证「WALA IFDS 字节码级精确污点」这条扫描路径的可行性。
> 接口、包结构与接入方式后续都可能调整，甚至整体替换；请勿在其内部 API 上建立依赖——
> 与 repograph-app 的唯一契约是 `TaintScanCli` 的命令行参数与 JSON 输出。

## 定位

RepoGraph 漏洞管理的第四条扫描路径：基于 [WALA](https://github.com/wala/WALA) 的 IFDS
field-sensitive 跨过程污点分析，在**编译后的字节码**上运行，精度高于 repograph-app 内置的
源码级启发式污点扫描（`TaintVulnScanner`），但要求目标可编译。两者各管一档，互不替换。

## 为什么是"试验性"

- **生产闭包最小化**：以唯一生产入口 `TaintScanCli` 做编译后依赖可达性分析，只保留 133 个主源码类。
  旧 NPD、规则反射注册、report/summary 等 73 个入口不可达类及 7 个未被 JUnit 执行的手工测试壳已移除；
  语义核心（`sourcesink/`、`extutil/`、`support/` 等）不重写，避免静默行为偏离。
- **vendored 补丁 WALA**：依赖打过访问修饰符补丁的 WALA fork（`libs/` 内 flatDir，
  core/util/shrike 1.6.10-SNAPSHOT，来源 WALA checkout 分支 cb205619d）。引擎覆写了
  `TabulationSolver` 的 `processNormal` / `propToReturnSite`（官方为 private/final），
  官方 Maven Central 版本无法编译本引擎。
- **JDK 隔离**：引擎须运行在带 `jmods` 的 JDK（固定 JDK 21），与 repograph-app 的
  JDK 25（FFM/tree-sitter）冲突，因此以**独立进程**接入（方案 A），不作为 app 的编译期依赖。

## 与 repograph-app 的接入方式（方案 A：独立进程）

```
repograph-app (JDK 25)
    └─ 子进程: 带 jmods 的 JDK 21 + installDist 产物 lib/*
         └─ com.repograph.taint.cli.TaintScanCli  →  stdout/文件 JSON
              app 解析 JSON → VulnFinding(ruleId=PRECISE_<rule>) 写入 VulnStore
```

app 侧入口：`POST /api/v1/vulns/scan/taint/precise`，配置见 `repograph.taint.precise.*`
（默认 disabled）。

## 构建与测试

```bash
./gradlew :repograph-taint-engine:test         # 32 个 JUnit，含端到端集成测试
./gradlew :repograph-taint-engine:installDist  # 产出 build/install/repograph-taint-engine/{bin,lib}
```

端到端测试（`e2e.TaintAnalysisEndToEndTest`）在编译后的 fixture 上跑完整 WALA+IFDS 管道，
验证检出 `System.getenv → Runtime.exec` 命令注入污点流。

## 独立运行 CLI

```bash
<jdk21>/bin/java -cp 'build/install/repograph-taint-engine/lib/*' \
  com.repograph.taint.cli.TaintScanCli \
  --classpath <classesDirOrJar> \
  --config    <sourcesAndSinks.json> \
  [--exclusions <wala-exclusions.txt>] \
  [--rule CWE_78] \
  [--entry-methods entry,handle] \
  [--out result.json]
```

输出 schema：`{"ruleName":..,"flowCount":N,"flows":[TaintFlowDto..]}`；
失败时 stderr 输出 `PRECISE_TAINT_ERROR: ...` 并以退出码 2 结束。

## 运行约束（踩坑记录）

1. **必须带 jmods 的 JDK**：WALA 从 `$JAVA_HOME/jmods` 建 JRE primordial 模型，
   JDK 25 无 jmods（`NoSuchFileException`），JDK 17/21 可用。
2. **需要 WALA 排除文件**：不剪 JRE 时访问路径预分析在全 java.base 超图上会卡死；
   打包默认的 `JavaTaintExclusions.txt` 剪掉 GUI/security/concurrent/stream 等昂贵闭包后，
   端到端分析 <1s。
3. **source/sink 须为库方法**：source/sink 定义硬编码 Primordial 类加载器，
   通常只有 JRE 库方法（如 `System.getenv` / `Runtime.exec`）能匹配调用点。
4. **sink 参数索引含 `this`**：实例方法 Index 0 = receiver，第一个实参是 Index 1。
5. **断言需关闭**：引擎与 WALA 用 `assert` 做开发期检查，生产不带 `-ea`；
   测试已设 `enableAssertions = false` 镜像生产。
6. **共享可变状态**：`DomainElement.ZERO` 会被就地污染，同一 JVM 连跑多次分析不安全——
   生产每次扫描独立进程，测试 `forkEvery = 1`。

更多背景与架构决策见根目录 [CONTEXT.md](../CONTEXT.md)。
