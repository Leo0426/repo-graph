# 企业管理与模型 Provider 改造

Status: complete

## 完整目标

- 内置 admin；本地安全初始化凭据，密码哈希；登录/退出/修改密码；注册默认待审核。
- admin 审核/拒绝/禁用用户；被禁用用户已有会话失效；审核及管理动作有审计记录。
- admin 创建/修改组织、管理成员；项目绑定个人或组织，支持调整归属。
- 后端强制访问隔离：项目列表、检索、图谱、源码、Wiki、任务、资产、漏洞、审核及导出。
  未绑定旧项目仅 admin 可见；普通用户不能通过缺省 projectId、资源 ID 或项目根路径越权。
- 完整登录/注册/待审核交互，以及账号、组织、项目归属、Provider 管理界面。
- 多个自定义 Provider：名称、协议、Base URL、API key、模型、超时/输出限制，连接测试与启停/选择。
- Ollama、OpenAI-compatible Chat Completions、Anthropic Messages；现有研判、Wiki、架构评审统一适配，
  保留公开流式结果、citation 校验、失败降级语义；Embedding 设置与生成模型用途明确区分。
- API key 不回传、不写日志；持久化加密，密钥使用配置或受限本地文件。
- MCP 支持认证，不以保护 Web 为由保留可绕过的匿名接口。
- 迁移兼容已有数据，更新 CONTEXT/工程说明，重启本地服务验证。

## 垂直切片与验证证据

1. SQLite 账号目录：注册→待审核→admin 审核→登录，重启持久化；公共服务+真实 SQLite 测试。
   捕获状态机、哈希与管理权限错误，不证明 HTTP 会话安全。
2. HTTP 登录/注册/会话与 CSRF：真实 Spring filter/MockMvc 或 HTTP，普通账号不能调用管理端点；
   捕获路由、会话失效与 CSRF，不证明各资源归属。
3. 组织/项目归属与资源授权：真实目录+项目访问策略，逐类 HTTP 资源跨用户测试；
   对外 Neo4j/Qdrant 可使用边界替身，不用它证明真实索引性能。
4. Provider 存储及统一模型传输：本地 HTTP fixture 验证三种协议、认证头、SSE、超时/错误和秘密不泄漏。
5. 管理 UI 与现有 UI 认证接入：隔离浏览器回归含普通用户/admin，键盘/窄屏/错误恢复。
6. 全量普通测试、域检查、真实本地启动冒烟；逐条核对上述完整目标，不以局部绿灯视为完成。

## 事实来源

- 改造前 `ProjectsController`、`SearchController` 等无认证；不信任前端隐藏按钮作为授权。
- 改造前 `LlmAdvisorySettingsStore` 单例设置固定 OLLAMA，三个模型适配独立调用，需要统一传输。
- Spring 会话持久化：https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html
- OpenAI Chat Completions：https://developers.openai.com/api/reference/cli/resources/chat/subresources/completions/methods/create
- Anthropic Messages：https://platform.claude.com/docs/en/api/messages/create

## 实现记录（2026-11-10）

- 账号目录、组织成员/停用、项目归属、审核审计、登录/注册/退出/改密与 CSRF 已实现。
- 普通用户业务 API 按项目归属放行；缺省范围拒绝，资源 ID 由持久记录反查项目；管理 API 仅 admin。
  已验证列表、摘要 ID、反馈身份、文件系统根路径以及任务/资产/审核导出等资源类别隔离。
- 账户/组织/归属/审计页面已接入；普通用户不请求管理数据。
- Provider 多配置、启停/切换/删除、API key 加密与编辑保留/清除、连接测试和管理页面已实现。
  SQLite 旧 Ollama 设置一次迁移为 legacy-ollama，旧设置 API 读取同一选择；非 Ollama 不允许旧表单覆盖。
- 统一 GenerationGateway 接入研判、Wiki、架构评审。真实本地 HTTP fixture 验证 OpenAI Chat Completions、
  Anthropic Messages 和 Ollama Chat；流式测试证明分片在服务端完成前送达；只输出文本，不输出 thinking。
  验证拒绝重定向、上游错误脱敏、响应上限、截断输出和流中断。
- MCP 使用环境变量账号密码，按 Web 相同的 session/CSRF 契约登录及会话过期后重新认证。
  已运行真实 MCP 进程访问本地 app 的 list_projects，stdout 仅 JSON-RPC。
- 最新本地应用已重启至 http://localhost:8080；真实浏览器 admin 登录、Provider 列表/编辑器已验证，无 JS 错误。
- 最终回归：app 普通测试 1130 项、MCP 30 项、UI 141 项通过，均无失败或跳过。
  日志：/tmp/repograph-enterprise-final-tests.log、/tmp/repograph-enterprise-final-ui.log；
  截图 /tmp/repograph-enterprise-final.png、/tmp/repograph-enterprise-final-mobile.png。
  这些结果不证明真实远程模型兼容性（没有配置外部凭据）或生产多实例可用性。

## 最终验收状态

- 已补充八类资源 ID 的正/反向 HTTP 验证，混合归属批量导出拒绝，组织成员移除后既有会话立即失去资源访问权。
- 已修复普通线程取消阻塞响应的问题；普通/虚拟调用线程取消与非流式/流式持续发送数据的总时限均有真实 HTTP 测试。
- 已补充价格持久化、未知价格预检拒绝、实际 token 费用估算和单次研判配置快照，覆盖序列化证据元数据。
- 已补充凭据替换、主密钥错误、端点非法端口、文件权限、配置回滚和前端保存/连接失败重试验证。
- Provider 状态与公共管理审计同事务提交；登录/注册单实例限流已接入真实安全链并验证。
- 最终普通测试/UI 回归、新版本 Web 与 MCP 运行验收均已通过，逐项证据和验证边界见 [ACCEPTANCE.md](ACCEPTANCE.md)。
