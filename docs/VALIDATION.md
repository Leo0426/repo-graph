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

规则导出由 `RuleFormatterTest` 验证 YAML/JSON 快照、元数据一致、严重程度映射、字面转义和
确定性输出。真实 Semgrep 验证使用：

```bash
./gradlew :repograph-app:test --tests '*RuleFormatterSemgrepIT' \
  -Dtest.semgrep.command=/absolute/path/to/semgrep
```

该 IT 在临时目录生成规则和正负样本，验证目标引擎实际匹配结果；关闭遥测、版本检查且只使用本地
配置。未提供命令时显式跳过；配置的命令不存在、超时或解析失败均为失败，不能算通过。
两个固定样本不证明任意 Java 正则都与 PCRE2 等价，新增规则仍应在目标 Semgrep 版本验证回归样本。

首次启动回归由 `SqliteStoreInitializationTest` 和 `FirstRunStartupTest` 覆盖：16 个 SQLite 存储
分别从不存在的多级父目录初始化、保留已有数据，并对目录被普通文件占用给出明确错误；完整 Spring
Web 应用使用临时 `user.home` 启动，经 HTTP 提交 Java 项目索引、轮询到 `done`，核对 SQLite 历史
和再次索引的增量跳过。SQLite、解析器、索引管道与 HTTP 服务为真实实现；Neo4j、Qdrant 和
Embedding 使用测试替身，该回归不证明外部服务集成通过。

索引一致性回归由 `DefaultIndexPipelineTest`、`DefaultIndexStoreTest`、`IncrementalIndexCacheTest`、
`CodeGraphTest`、`QdrantVectorStoreTest` 与监听/API/资产测试共同覆盖：文件变空和符号移除、稳定节点入边、
图事务回滚、清理失败后重建 SQLite 实例重试、同项目串行和可中断等待、监听停止/重新注册/关闭的旧任务失效。
这些测试包含真实 SQLite 与嵌入式 Neo4j，但 Qdrant 单测使用模拟客户端；真实保留 ID 清理与项目隔离
须看 `QdrantVectorStoreIT` 的实际执行结果。重建缓存实例模拟持久状态恢复，不等于真实进程崩溃注入。

## 账号、项目隔离与模型 Provider

`EnterpriseDirectoryTest` 验证真实 SQLite 的审核状态、组织/个人归属、撤权与重启持久化；
`IdentityHttpTest` 验证真实安全链的登录、CSRF、禁用会话与限流；`ProjectAccessHttpTest` 覆盖
项目列表/查询、持久资源 ID、请求体、项目根路径和混合归属批量导出。外部图/向量边界使用替身。
`ModelProviderStoreTest` 覆盖加密、凭据编辑、旧配置迁移、选择持久化及事务审计；
`GenerationGatewayTest` 和 `GenerationGatewayDeadlineTest` 使用本地 HTTP 服务验证三个协议、
流式分片、认证头、错误脱敏、取消和整次时限，不等于真实厂商服务验收。三个模型适配器及研判服务测试
保留输出解析、citation/预算约束与降级验证。
`ModelCatalogTest` 使用本地 HTTP 覆盖草稿发现、四协议值的路径/认证、Anthropic 分页、已保存密钥的地址绑定、
失败脱敏、禁止重定向、响应上限及慢响应总时限；`ProjectAccessHttpTest` 验证发现端点管理员/CSRF 和草稿不落库。
研判及评测回归验证未知价格可调用、费用和包含未知项的总费用为 null；已有价格仍执行原成本预算。

`admin-workflow.test.cjs` 覆盖注册待审、管理审核、组织成员和项目归属、普通用户界面隔离、
Provider 保存/选择/停用/密钥不回显以及保存失败重试。它使用模拟 API，须结合 HTTP 安全链测试解读。
该浏览器回归还验证模型发现后的选择/手填、失败重试、空列表、连接变化丢弃迟到响应、语言及亮暗/窄屏表单，
并确认没有价格输入或价格拦截提示。
MCP 的 `RepographApiAuthenticationTest` 验证 session/CSRF 与过期重认证；真实可执行进程还需单独冒烟。

仓库工作流回归 `repository-workspace.test.cjs` 验证无 hash 首页、五域导航、仓库到检索/Wiki/缺陷的范围、
历史与刷新、空仓库/读取失败重试、普通用户接入提示以及手机/英文。原 shell/workspace 测试继续覆盖
统计深链和全局范围、键盘、乱序、删除、模态与各功能。Provider 模板回归在 `admin-workflow.test.cjs`，
覆盖所有模板不触发请求、不携带旧草稿秘密、企业网关保存及编辑密钥保护。
`GenerationGatewayTest` 对 OpenAI 原生和兼容两种参数契约分别验证实际 HTTP 请求及 SSE；
`ModelProviderStoreTest` 覆盖兼容协议的保存/重启/密钥生命周期。


视觉收敛回归包括 `design-system.test.cjs` 的亮/暗主题 × 桌面/手机 × 14 面板及登录注册，
和 `command-palette.test.cjs` 的命令、焦点恢复、权限入口、菜单与图标渲染。预览每个视觉面板使用
独立文档导航，等待其初始模拟数据完成；通过不等于真实后端连通或完整 WCAG 合规。

`search-scope.test.cjs` 验证显式授权范围、同页历史/刷新、撤权和迟到响应；`repository-tasks.test.cjs`
验证行内直接进入任务、长名称与列表位置；`capabilities.test.cjs` 验证任务依赖、生成配置分离和只读边界。
`agent-reading.test.cjs` 覆盖全部 Run 状态、两档字号、按仓库保留准备草稿、运行/漏洞乱序、轮询焦点，
以及冻结报告读取、人工认领/确认/驳回/退回、失败理由保留、权限变化、非唯一关联、模态焦点和亮暗布局。
这些浏览器检查仍使用模拟 API；真实安全链/SQLite/审核冻结由 `ProjectAccessHttpTest`、
`ReviewQueueStoreTest` 和相应控制器测试验证，向量授权集合的实际过滤由 `QdrantVectorStoreIT` 验证。
