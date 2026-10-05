# RepoGraph 本轮优化与验证记录

日期：2026-10-03（Asia/Shanghai）。远端基线：`123ce44`。
工作分支：`codex/reliability-performance-20261003`；验证时改动保留在工作区，未提交或推送。

## 代码同步与范围

已从 `411f893` 快进到 `origin/main` 的 `123ce44`，纳入 8 个远端提交。
拉取前的两个未跟踪文件 `.claude/settings.local.json`、`.scratch/agent-demo-semgrep.json`
均与远端版本逐字节一致；原副本保存在
`/Users/leolu/.codex/repo-graph-pre-pull-20261003-jnapmwxz/`，没有丢弃本地内容。

本轮优先处理正确性和稳定性，对性能给出需要测量的优化策略；没有宣称未测得的吞吐量或延迟提升。
保留现有领域模型、core 无第三方依赖、graph/vector 并列能力和人工确认漏洞的边界。

## 已落实的修改

| 位置 | 原问题 | 修复后的行为 |
|---|---|---|
| `DefaultIndexPipeline` | 用经过语言/排除过滤的扫描列表推断文件已删除 | 仅清理确认已不存在或已变成目录的路径；仍存在或存在性不明的文件保留 |
| `IncrementalIndexCache` 与两个索引入口 | Embedding 完成后重新计算 MD5，可能把期间修改的新版本标成已处理 | 解析前捕获指纹，完成后核对并提交原快照；变化/消失/读取失败时失效缓存、报告 partial 并保留重试资格 |
| `DefaultExternalScannerService` / `DefaultScanTaskService` | 扫描器内的多语言 PARTIAL 被汇总成 SUCCEEDED，无法重试 | 只有全部 SUCCEEDED 才完整成功；PARTIAL 保留，并只重试未完全成功的扫描器 |
| `DefaultScanTaskService` | RUNNING 已落库、执行线程尚未登记时，取消可能遗漏中断 | 登记后复查状态；取消中断与线程注销同步，按线程身份移除登记 |
| `RepographApiClient` | GET/POST 固定 30 秒、JSON POST 固定 60 秒，忽略配置 | 三种请求统一采用 `repograph.timeout-seconds` |
| `RepographApiClient` | InterruptedException 被通用异常包装时丢失中断标记 | 包装异常前恢复线程中断标记 |
| 字节码测试 | fixture 指向已移除模块，解析行为长期跳过 | 每个用例在临时目录编译独立 fixture，实际验证调用边、继承/实现分离、嵌套类等 |
| Qdrant 集成测试 | 将 REST 端口当 gRPC；共享固定集合；清理失败被吞掉 | 读取 YAML gRPC 配置，支持测试覆盖；每例独立 UUID 集合、复用并关闭客户端，清理失败明确报错 |
| Gradle | ASM/gRPC 的强制版本散落在构建脚本 | 移入 Version Catalog，实际版本保持 9.10.1 / 1.63.0，不做未经兼容验证的升级 |

相关领域行为已同步到 [CONTEXT](../../CONTEXT.md)，测试前提与接线同步到
[Validation](../VALIDATION.md)。

## 实际验证

最终执行 `./gradlew test build --continue`，退出码 0，`BUILD SUCCESSFUL`。
以下数字来自两个子项目的 JUnit XML，明确排除 skipped：

| 模块 | 发现用例 | 通过 | 失败/错误 | 跳过 |
|---|---:|---:|---:|---:|
| repograph-app | 875 | 861 | 0 | 14 |
| repograph-mcp | 29 | 29 | 0 | 0 |
| 合计 | 904 | 890 | 0 | 14 |

- 先在原生产实现上运行新增回归，15 个案例按预期失败：索引 4、扫描 5、MCP 6；修复后通过。
  交叉审查发现 file→directory 边界后，另加 1 个案例确认先失败再修复通过。
- 14 个跳过项为 `QdrantVectorStoreIT` 的 12 例和 `CodeRetrievalBenchmark` 的 2 例。
  本机 Docker 未运行、Qdrant gRPC 不可达，检索基准缺少可用服务/索引前提；它们不计入集成或检索质量达标。
- 字节码 fixture 的 9 例实际运行；本轮没有 C/Python native parser 测试跳过。
- 158 个 core 源文件仅使用 JDK 独立编译，退出码 0；没有增加领域层外部依赖。
- `./gradlew build -x test` 单独通过；最终完整命令再次完成 app/MCP 打包。
- 使用临时 `user.home` 启动真实 MCP jar，发送 initialize、initialized notification、tools/list。
  正常退出，收到 2 条合法 JSON-RPC 响应与 23 个工具定义；没有非 JSON stdout。
  这验证进程启动与协议输出，不等于所有工具在真实后端服务上完成端到端验证。
- 独立子代理交叉审查了索引、扫描、MCP、夹具和构建 diff；目录替换边界已补齐。
  `git diff --check` 通过，新增 Java 行未超过 120 字符。

首次构建因 Maven 下载 TLS 握手中断；重试下载后编译和测试均成功。现有 JDK/ByteBuddy、
`@MockBean` 弃用警告仍存在，不在本轮无依据升级依赖。
本轮没有真实用户试用、UI 交互验收、真实扫描器运行或吞吐量基准结果。

## 下一步优先级

详见带源码证据、官方资料、权衡和验收标准的
[优化策略与开发路线](optimization-roadmap-2026-10-03.md)。建议先并行推进：

1. 固定人工标注集，报告危险降级率、模型可用率、完整分母与 citation 有效性。
2. 同文件旧符号/旧边替换与跨存储删除重试。替换必须保留仍有效符号的外部入边，不能简单先删整个文件。
3. 外部工具契约，尤其 CodeQL Java none 的依赖查询执行边界、Kotlin 实际分析范围及 SARIF 导入完整性。

随后建立分阶段性能基线，优先验证关键词前 5,000 单元限制与图查询/Embedding 成本。
其他有源码证据、尚待独立回归验证的稳定性候选：FileWatcher 同项目索引串行化、扫描器派生进程回收。
这些是后续工作，不能因本轮测试通过而解释为已经解决。
