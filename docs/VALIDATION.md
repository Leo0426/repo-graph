# RepoGraph Validation

检查由根和子项目 `build.gradle.kts` 中的 Gradle Java/JUnit Platform 任务执行。
本文件描述检查能力和解释方式；某次执行结果见对应构建报告，不把文档存在视为通过。

## 命令与范围

| 场景 | 命令 | 证明范围 |
|------|------|----------|
| 编译与打包 | `./gradlew build -x test` | 不包含测试结果 |
| 普通单元测试 | `./gradlew test --tests '*Test'` | 当前以 Test 结尾的测试，含嵌入式 Neo4j；不选 IT/Benchmark |
| MCP 协议分发 | `./gradlew :repograph-mcp:test` | 分发与工具契约，不等同于进程启动 stdout 验证 |
| Qdrant 集成 | `./gradlew :repograph-app:test --tests '*IT'` | 真实服务、独立测试 collection；必须检查 skipped |
| 检索质量 | `./gradlew :repograph-app:test --tests '*.benchmark.*'` | 真实 Qdrant/Ollama 与已建索引语料，缺前提会跳过 |
| 所有默认测试 | `./gradlew test` | 可能包含依赖服务或 native library 的跳过项 |
| Web 交互 | `UI_BASE_URL=http://127.0.0.1:18550 node --test repograph-app/src/test/ui/*.test.cjs` | 真实模板/CSS/JS与模拟 API；需要独立启动预览、Playwright 和 Chrome |

Gradle `--tests` 是包含模式；排除集成测试时采用上表当前类命名模式，不使用 `!*IT` 充当否定表达式。
改名或新增非 Test 后缀测试时需复核普通单元测试的选取范围。

## 结果解释

- 区分配置/依赖解析失败、编译失败、测试失败与 skipped。`BUILD SUCCESSFUL` 本身不证明集成或基准实际运行。
- XML 报告位于各子项目 `build/test-results/test/`，HTML 位于 `build/reports/tests/test/`。
  Gradle Test 任务每次选择不同过滤器时会更新本任务报告；不要把旧过滤器的结果当作当前全量结果。
- C/Python Parser 测试在 native library 不可用时使用 assumption 跳过，报告时说明精确解析器是否实际验证。
- 检索基准接受 `benchmark.*` 系统属性，app 构建脚本转发到测试 JVM。运行前核对项目路径、模型、
  维度、collection；测试会写 `~/.repograph/benchmark-latest.json`。
- 检索基准通过阈值为语义 Hit@10 ≥ 65%、代码相似 Hit@10 ≥ 75%；跳过不能解释为达标。
- VectorStore 集成测试会删除测试 collection；并发执行时核对隔离，不连接承载业务数据的同名 collection。

## 按改动验证

Parser、图、VectorStore、SBOM、Vuln 的必测行为见 [Coding](rules/CODING.md)。
涉及多存储共享模型时覆盖各映射；涉及 MCP 日志或启动时另核对完整进程的 JSON-RPC stdout。
Web 交互变更需实际检查对应流程；后端 JUnit 通过不能证明轮询、SSE、字号或展开状态正确。
隔离预览与浏览器回归的完整命令见 [UI 测试说明](../repograph-app/src/test/ui/README.md)。
该套件不属于 Gradle 默认测试，包含搜索乱序/重试、历史导航、移动抽屉、模态焦点、健康状态恢复、
剪贴板失败、Agent 两档字号和展开状态、英文与减少动态效果偏好；API 均拦截为虚构数据。

项目级 CI/自动触发能力以仓库内真实配置为准；用户级 Harness 生命周期钩子的健康不代表 Gradle 检查已自动绑定。

QdrantVectorStoreIT 从 application.yml 读取 gRPC 地址，默认与 Compose 的 16334 端口一致。
可通过 `-Dtest.qdrant.host=... -Dtest.qdrant.port=...` 覆盖，Gradle 会转发到测试 JVM。
每个用例创建独立的 `code_units_test_<uuid>` 集合并清理，清理失败会使测试失败；不使用业务集合。
连接失败仍通过 assumption 跳过，必须核对 skipped，不能把没有真实服务解释为集成通过。

JavaBytecodeParserTest 使用当前 JDK 在 `@TempDir` 中编译独立 fixture，验证方法调用、
EXTENDS/IMPLEMENTS 分离、嵌套类和匿名类处理。缺少编译器或 fixture 会直接失败，不再因旧模块路径跳过。

索引一致性回归由 `DefaultIndexPipelineTest`、`DefaultIndexStoreTest`、`IncrementalIndexCacheTest`、
`CodeGraphTest`、`QdrantVectorStoreTest` 与监听/API/资产测试共同覆盖：文件变空和符号移除、稳定节点入边、
图事务回滚、清理失败后重建 SQLite 实例重试、同项目串行和可中断等待、监听停止/重新注册/关闭的旧任务失效。
这些测试包含真实 SQLite 与嵌入式 Neo4j，但 Qdrant 单测使用模拟客户端；真实保留 ID 清理与项目隔离
须看 `QdrantVectorStoreIT` 的实际执行结果。重建缓存实例模拟持久状态恢复，不等于真实进程崩溃注入。
