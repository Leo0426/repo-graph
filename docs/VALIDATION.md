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

项目级 CI/自动触发能力以仓库内真实配置为准；用户级 Harness 生命周期钩子的健康不代表 Gradle 检查已自动绑定。

QdrantVectorStoreIT 当前将 localhost:16333 用作 gRPC，而默认 Compose 的 gRPC 端口为 16334；连接失败会通过 assumption 跳过。运行前核对测试接线与 skipped，并保持独立测试 collection。

JavaBytecodeParserTest 当前仍从已移除的 repograph-parser/build/classes/java/main 查找 ParserDispatcher.class，缺少该 fixture 时相关用例通过 assumption 跳过。验证字节码能力前核对 fixture 路径和 skipped，不能以 app 编译成功代替覆盖。
