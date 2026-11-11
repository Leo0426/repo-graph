# 首次启动时 ~/.repograph 目录不存在导致 SQLite 崩溃

Status: resolved

## 问题

index.db 路径为 `${user.home}/.repograph/index.db`。增量缓存会创建父目录，但其他 SQLite
存储并不依赖它的初始化顺序；全新机器上 LLM 设置等存储先初始化时，因目录缺失导致启动崩溃。

## 验收标准

- [x] 启动时(或 SQLite 存储初始化前)自动创建 ~/.repograph 及子目录
- [x] 新增测试:目录不存在时应用可正常启动并完成索引
- [x] docs/DEVELOPMENT.md 排障节同步更新

## 实现与验收（2026-10-22）

- `SqliteDatabasePath.prepare` 统一递归准备数据库父目录；16 个 SQLite 存储均在首次打开连接前调用，
  不依赖 Spring Bean 创建顺序，覆盖默认路径和自定义多级文件路径。保留已有数据库与原始路径配置。
- 目录创建失败时停止初始化，错误包含目标目录、权限/同名文件排查提示和原始文件系统异常。
- `SqliteStoreInitializationTest` 的 32 个参数化用例覆盖各存储独立初始化、保留已有数据及路径被
  普通文件阻塞；修复前缺目录的 16 例中有 15 例失败，只有增量缓存原本可以创建目录。
- `FirstRunStartupTest` 在全新临时 home 启动完整 Spring Web 应用，经 HTTP 提交 Java 项目索引、
  轮询到 `done`，再用新 Store 实例读取 SQLite 历史并验证第二次索引跳过未变文件。
  修复前启动在 `LlmAdvisorySettingsStore` 因 SQLite 父目录不存在而失败；修复后通过。
- `./gradlew test --tests '*Test' :repograph-app:bootJar :repograph-mcp:bootJar` 通过：app 1055 项测试，
  零失败、零跳过；两个模块打包成功。MCP 最初复用 up-to-date 结果，随后执行
  `./gradlew :repograph-mcp:test --rerun-tasks`，29 项测试实际运行通过，零失败、零跳过。
- 新启动回归中的 SQLite、解析器、HTTP 与索引管道使用真实实现；Neo4j、Qdrant、Embedding 使用
  测试替身。本次未运行外部服务 IT、检索基准或 UI 测试，不把这些检查视为通过。
- 独立只读代码审查未发现 Critical / Important / Minor 问题。排障和验证说明已同步更新。

## 评论

- 2026-10-15 全仓审计发现。
- 2026-10-20 修复完成。核对启动顺序：7 个 SQLite store（AgentRunStore、ScanTaskStore、ScannerRunStore、
  ReviewQueueStore、RuleRegistryStore、RuleSuppressionStore、IncrementalIndexCache）在**构造函数**中
  建表触库，其余 store 懒初始化；全仓 16 个 store 共享 `repograph.index.db-path`，仅
  `IncrementalIndexCache` 创建父目录。Spring 不保证这些单例的创建顺序，普通 `@PostConstruct`
  初始化组件无法保证先于它们运行，因此新增 `SqliteStorageInitializer`（`app/config`）以
  `BeanFactoryPostProcessor` + `EnvironmentAware` 形式在所有 Bean 实例化之前解析
  `repograph.index.db-path`（默认与各 store 的 `@Value` 一致）并 `Files.createDirectories`
  创建父目录链；`~/.repograph/assets`、`~/.repograph/scans` 由各自的导入/扫描流程在使用前创建，
  不在此重复处理。docs/DEVELOPMENT.md 排障节已同步。新增
  `SqliteStorageInitializerTest`（4 用例）：临时目录复现目录不存在场景（嵌套父目录链创建、
  配置值内嵌占位符解析、目录已存在与相对路径静默通过、目录创建后 AgentRunStore 构造即触库可正常完成）。
  验证：`./gradlew :repograph-app:test --tests '*SqliteStorageInitializerTest'
  --tests '*InterruptedTaskRecoveryTest'` 通过（4+1 用例，0 跳过 0 失败）；
  `./gradlew test --tests '*Test'`（app+mcp，含嵌入式 Neo4j）通过，1055 用例 0 跳过 0 失败 0 错误。
  未运行：`*IT`（Qdrant 集成，需真实服务）、benchmark（需真实 Qdrant/Ollama）、UI node --test 套件
  （本改动不涉及 Web 交互）。代码修复尚未 commit；GitHub 同步因 `gh` 未登录跳过。
