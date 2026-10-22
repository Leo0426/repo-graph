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
