# 企业管理与模型 Provider 验收

日期：2026-11-10。结论：PLAN.md 中本轮完整范围已实现并通过以下验证。
本轮为单实例本地应用，不把通过单元/协议测试解释为生产多实例或真实厂商调用认证。

## 逐项核对

路径以 `repograph-app/src/main/java/com/repograph/` 为实现根，测试以对应 test/java 为根。

| 原始需求及计划约束 | 当前实现证据 | 验证证据 |
| --- | --- | --- |
| 内置 admin、安全初始化及密码存储 | identity/IdentityConfiguration、EnterpriseDirectory：首次生成或环境变量初始化，BCrypt，已有账号不重置 | EnterpriseDirectoryTest 重启、角色及状态；真实新版 admin 登录成功 |
| 自注册、待审核、admin 批准/拒绝/停用 | api/AuthController、AccountAdminController；目录状态机；login.html | IdentityHttpTest 注册到审核登录及越权拒绝；admin-workflow 注册待审/审核浏览器流程 |
| 登录/退出/改密、会话失效、CSRF | IdentitySecurityConfiguration、SessionValidationFilter、AuthController；repograph-session.js | IdentityHttpTest 真实 Spring 安全链；EnterpriseDirectoryTest 改密/停用版本撤销；登录限流测试 |
| admin 管组织和成员 | AccountAdminController；EnterpriseDirectory 组织创建/修改/停用、成员增删 | EnterpriseDirectoryTest 组织停用、成员撤权；浏览器组织创建及成员管理 |
| 项目绑定个人/组织并可调整 | ProjectOwner 与目录持久化归属；管理页面项目归属选择 | EnterpriseDirectoryTest 两类归属及变更；浏览器组织归属保存；ProjectAccessHttpTest 转移/撤权 |
| 后端权限隔离，旧项目仅 admin | ProjectAccessConfiguration 默认未声明接口仅 admin；ProjectListVisibility；ProjectBodyAccess；ResourceProjectLookup | ProjectAccessHttpTest 列表、缺省范围、摘要、反馈、根路径、八类资源 ID 正反向、混合批量导出；资源归属取真实 SQLite 记录 |
| 查询/源码/图谱范围传到存储 | Search/Graph/GraphRag/ContextPack/Symbol/Metrics/ArchitectureReview/GraphExport 控制器传递授权 projectId；QdrantVectorStore project_id 过滤；GraphRag 扩展携带 projectId | 源码逐层核对，相关图/检索/向量测试随普通全量通过；不以替身证明外部索引性能 |
| 管理模块与普通用户界面 | admin.html、repograph-admin.js；账号、组织、归属、审计页；普通用户仅账户信息及有权项目 | admin-workflow 管理流程、普通用户无管理请求/入口；141 项完整 UI 回归 |
| 自定义多个 Provider | ModelProviderStore/Controller；名称、协议、URL、key、模型、启停/选择/删除、超时/token 限制、连接测试 | ModelProviderStoreTest 持久化、编辑与迁移；ProjectAccessHttpTest admin 权限/CSRF；浏览器保存选择停用、失败保留草稿重试 |
| OpenAI、Anthropic、Ollama 协议 | GenerationGateway：Chat Completions、Messages、native Chat，分别设置请求体和认证头 | GenerationGatewayTest 本地 HTTP 真实网络 fixture 验证三协议、usage、逐步流式输出、不输出 thinking、截断与错误；DeadlineTest 取消/总时限 |
| 研判、Wiki、架构评审接入 | 三个既有模型适配器统一调用 GenerationGateway；Embedding 独立配置 | 三个适配器及 DefaultLlmAdvisoryService 测试；citation/解析/失败降级测试随全量通过；价格未知拒绝及配置快照测试 |
| 密钥不回显、加密与安全更新 | ProviderSecretCipher AES-GCM、受限主密钥文件；安全 DTO；更换地址需显式处理凭据 | ModelProviderStoreTest 密文、重启、错误/缺失主密钥、文件权限、替换及清除；HTTP/UI 不回传；Gateway 错误脱敏 |
| 管理审计与迁移 | ManagementAuditJournal 与状态同事务；旧 Ollama 配置一次迁移；原图/向量 ID 不变 | Directory/ProviderStore 真实 SQLite 测试及 HTTP actor 验证；新版读取 legacy-ollama 成功 |
| MCP 不保留匿名旁路 | RepographApiClient 自动登录、cookie/CSRF、401 重认证 | 30 项 MCP 测试通过；真实 exec jar initialize 和认证 list_projects 成功，stdout 全部可解析 JSON-RPC、无凭据 |
| 文档及本地运行 | CONTEXT、Architecture、Development、Glossary、Design System、Interaction Design、Validation 更新 | 最新 app bootJar 启动成功；8080 登录 HTTP 200、admin 登录首页成功；Provider 编辑页桌面/390px 手机验证 |

## 最终执行结果

- `./gradlew test --tests '*Test'`：BUILD SUCCESSFUL。当前 XML 为 app 134 个 suite、1130 tests，MCP 3 个 suite、30 tests；均 failures=0、errors=0、skipped=0。
- `UI_BASE_URL=http://127.0.0.1:18550 node --test repograph-app/src/test/ui/*.test.cjs`：141 通过，0 失败/取消/跳过。
- `./gradlew :repograph-app:bootJar -x test` 与 `./gradlew :repograph-mcp:bootJar -x test`：通过；不将打包计为测试。
- 新版 app 在 http://localhost:8080 运行。真实浏览器管理页与 Provider 编辑器无 pageerror，390px 无横向溢出，截图人工查看表单可读。
- 最新 MCP 可执行 jar 使用环境变量凭据访问新版 app；initialize + list_projects 两个响应均成功。
- `git diff --check` 通过。未提交或暂存本轮改动，保留原有用户工作区修改。

日志：`/tmp/repograph-enterprise-final-tests.log`、`/tmp/repograph-enterprise-final-ui.log`、`/tmp/repograph-local.log`。
截图：`/tmp/repograph-enterprise-final.png`、`/tmp/repograph-enterprise-final-mobile.png`。
这些 /tmp 文件是本地本次运行证据，不是长期保存或 CI 的保证。

## 验证边界

- 未配置真实 OpenAI/Anthropic 凭据；协议和失败行为由本地 HTTP fixture 验证，真实厂商连接须由管理员配置后使用连接测试确认。
- Neo4j 容器 healthy；Qdrant `/healthz` 返回成功，Compose 探针仍标 unhealthy。未把这次启动冒烟当作真实向量集成或检索质量基准。
- 单 app、SQLite、本地 session 与内存限流；本轮未交付跨实例 session、SSO 或高可用部署。
- 普通测试命令不选 IT/Benchmark；未运行项不计入上述通过数。UI 回归拦截 API，真实 HTTP 权限由后端测试和运行冒烟补充。
