# RepoGraph Development

## 环境与启动

当前构建 toolchain 是 JDK 25，版本以根 `build.gradle.kts` 为准。用仓库 `./gradlew`，
Gradle 版本以 `gradle/wrapper/gradle-wrapper.properties` 为准；首次执行可能下载分发包和 Maven 依赖。

```bash
docker compose up -d
./gradlew :repograph-app:bootJar :repograph-mcp:bootJar -x test
java --enable-native-access=ALL-UNNAMED -jar repograph-app/build/libs/repograph-app-0.5.0.jar
```

`-x test` 仅用于构建，验证入口见 [Validation](VALIDATION.md)。版本变更后按 `build/libs/` 中实际产物启动。
app 提供 Web/REST，MCP 另行作为 stdio 进程启动，使用 `repograph-mcp-0.5.0-exec.jar`。

## 配置与依赖

- app 配置源：`repograph-app/src/main/resources/application.yml`；MCP 使用自己子项目中的同名配置。
- Qdrant REST 映射到 16333，gRPC 映射到 16334；Java SDK 使用 gRPC。
- Neo4j 的 7474 是浏览器 HTTP，7687 是 Bolt。服务定义与端口以 `docker-compose.yml` 为准。
- Embedding 的模型、向量维度及 collection 必须一起核对 app 配置与已有索引；换模型不要继续向不匹配的 collection 写入。
- 研判、Wiki、架构评审使用“账户与企业管理 → 模型 Provider”保存的生成模型配置；Agent 页面展示当前选择。
  YAML 仅用于首次 Ollama 默认值，旧 SQLite 设置一次迁移；Embedding 仍由独立服务配置管理。
- `quickstart.sh` 会启动容器、轮询服务并构建，不直接启动 Java 服务；具体模型应以 app 配置为准。

## 停止与排障

前台 Java 服务用 Ctrl-C 停止；容器用 `docker compose stop` 停止，查看依赖日志用
`docker compose logs --tail=100 qdrant neo4j`。
MCP 日志在 `~/.repograph/mcp.log`，不会出现在 stdout。
`~/.repograph/` 包含 SQLite、导入源码和运行数据，不是可随意清空的构建缓存；构建输出在子项目 `build/`。
首次启动时 SQLite 数据库父目录（默认 `~/.repograph`，来自 `repograph.index.db-path`）由启动初始化器
`SqliteStorageInitializer` 在任何 SQLite 存储 Bean 实例化之前自动创建；目录创建失败（如权限不足）会在
启动早期报错并阻止应用启动。托管资产目录（`repograph.assets.root-dir`）与外部扫描器工作目录
（`repograph.scanners.work-dir`）由各自的导入/扫描流程在使用前创建，不依赖该初始化器。

首次启动无需手动创建 `~/.repograph/`。每个 SQLite 存储在打开数据库前都会递归创建
`repograph.index.db-path` 的父目录；自定义的多级目录也适用，已有数据库不会被覆盖。
若启动报 `Cannot create SQLite database directory`，按错误中的路径检查运行用户的目录写入权限，
以及路径中是否有同名普通文件。修正权限或配置到可写目录后重启，不要通过删除运行数据库排障。

检索故障先核对 REST/gRPC、Embedding 模型/维度/collection 和实际 projectId。
索引及 Agent 运行需检查终态、错误、missingInfo/omittedReasons，不能只看请求已接受。

projectId 由规范化绝对项目根路径计算，同一仓库在不同 worktree 或导入目录中可能有不同 projectId；运行数据默认使用 user.home，Git worktree 本身不隔离 SQLite、资产目录或外部 collection。

## 账号与 Provider 本地配置

首次启动创建内置 `admin`。可通过 `REPOGRAPH_ADMIN_PASSWORD` 提供初始密码（至少 12 字符）；
未提供时随机生成并保存到数据库同目录的 `bootstrap-admin-password`（权限 600）。已有账号不会被启动变量重置。
新用户在 `/login` 注册后处于待审核状态，admin 在管理页面批准后才可登录。普通用户只可访问绑定给自己或
其有效组织的项目；存量未分配项目仅 admin 可见。停用账户立即撤销已有会话。

Provider 的 Base URL 是 API 前缀：OpenAI/Anthropic 通常包含 `/v1`，服务分别追加 `/chat/completions`、
`/messages`；Ollama 使用服务根地址并追加 `/api/chat`。协议与显示名称独立，可为企业代理自定义名称和地址。
保存不调用模型；连接测试会发送一条最多 128 输出 tokens 的测试消息，可能产生费用。
生成开关与选中状态独立，停用当前 Provider 会暂停后续生成。改动不会取消已发出的请求。

API key 使用 AES-256-GCM 加密存入 SQLite，不回显。编辑留空保留；清除必须显式勾选；更换地址或协议时
须重新填写或清除已有密钥。主密钥来自 `REPOGRAPH_PROVIDER_ENCRYPTION_KEY`（32 字节密钥的 Base64）或
数据库旁的 `provider-encryption-key`（自动生成、权限 600）。备份数据库时须另外安全备份主密钥；不能只复制
数据库，也不能在已有密文时删除或替换主密钥。缺失/错误密钥使启动失败，恢复原密钥后重启。

MCP 启动环境需设置 `REPOGRAPH_USERNAME` 和 `REPOGRAPH_PASSWORD`，使用已批准账号。客户端自动登录、维护
会话并携带 CSRF；权限与该账号在 Web 中相同。密码不要放在命令行参数或提交到仓库；MCP 日志仍写文件，
stdout 仅 JSON-RPC。未配置凭据访问受保护接口会提示认证，不保留匿名旁路。

当前部署为单 app 实例，SQLite 与本地 session 为事实源；生产接入应使用 HTTPS，并按反向代理部署设置
`server.servlet.session.cookie.secure=true`。上述本地启动不提供跨实例 session 共享。


登录和注册按服务端识别的对端地址分别限流，默认每 60 秒最多 30 次登录、5 次注册，超限返回 JSON 429
和 `Retry-After`。配置项为 `repograph.security.login-attempts-per-window`、`registrations-per-window`、
`auth-window-seconds`；不直接信任客户端 `X-Forwarded-For`。反向代理后应按可信代理配置及实际用户规模
调整限流；当前限流状态在单实例内存中，重启后重置。

Provider 表单不再提供输入/输出单价。未知价格允许直接研判，结果 `usage.estimatedCostUsd` 为 null；
评测中任一可用建议费用未知时，`totalEstimatedCostUsd` 也为 null，不把未知费用算作免费。
历史单价及 API 的可选价格字段继续兼容；编辑名称、密钥等且模型连接不变时保留原价，变更模型或连接时清空旧价。
已有价格的成本预检以完整序列化请求字节数加提示词余量作为保守输入估算，
并使用 Provider 的完整输出 token 上限；结果费用按上游报告的 token 数和本次捕获的单价估算，不是账单。
单次研判的预检、调用、重试及审计使用同一配置快照；编辑配置仅影响后续操作。
Wiki、架构评审和显式连接测试不走研判的美元预算预检，但仍受 Provider 输出上限及整次请求总时限约束。

Provider 创建、更新、切换、删除与账号/组织/归属共用管理审计日志；状态变更和审计在同一 SQLite 事务内提交，
审计不包含 API key、配置正文或提示词。模型请求在可中断虚拟线程执行，超时/取消会释放阻塞的上游读取；
单次时限覆盖连接、响应体读取和流式输出，不因上游持续发送少量数据而无限延长。

## 仓库工作台与更多模型接入

登录默认进入仓库列表。管理员通过“仓库工作台 → 接入与索引”接入本地仓库，并在“平台管理 → 项目归属”
分配；普通用户只看到已分配仓库。选择仓库后进入代码理解或缺陷发现，能力验证页独立展示服务与离线测评证据。

“平台管理 → 模型 Provider → 新增”可应用国内、国际、本地或自定义网关模板。模板不保存/不请求远程服务，
切换模板清空未保存的旧密钥和模型。填写 API 前缀和密钥后可点击“获取模型列表”，再从列表选择或手动填写 ID。
模型发现通过管理员/CSRF 保护的 `POST /api/v1/admin/model-providers/models` 读取草稿；无需名称或预先保存。
OpenAI/兼容协议读取 `/models`，Anthropic 使用其认证头并跟随游标分页，Ollama 读取 `/api/tags`。
编辑已保存配置且密钥留空时，只有相同地址和协议可复用已保存密钥；草稿新密钥仅用于此次请求，不会写入数据库。
请求不跟随重定向，整个获取过程最多 30 秒、20 页、2 MiB、5000 个模型，不自动调用生成或查询厂商报价。
服务不支持模型列表、权限不足或网络失败时可重试或手填；发现成功不表示选定模型已通过生成测试。
OpenAI 原生 Chat Completions 选 `OPENAI`（输出参数 `max_completion_tokens`）；DeepSeek、百炼、硅基流动、
Gemini 的兼容端点选 `OPENAI_COMPATIBLE`（`max_tokens`）。企业网关按自身支持情况选择；不自动猜测/重试
另一协议以免重复计费。Gemini 模板使用 Google 的 OpenAI 兼容文本接口，不是原生多模态接口。
百炼默认北京兼容地址，可修改为业务空间域名；API key 的地域须匹配地址。Ollama 地址由 app 服务端访问。
模板事实来源与核对日期见 `.scratch/repository-workspace/MODEL-SOURCES.md`；真实账号/网络/模型能力需连接测试验证。
