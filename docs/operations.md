# 服务检查和故障定位

| 入口 | 用途 |
| --- | --- |
| `GET /livez` | 检查进程是否能响应 |
| `GET /readyz` | 检查服务是否能读取主要事务数据库 |
| 管理后台的「服务诊断」 | 查看文件存储、全文索引、向量检索、模型状态和执行器心跳 |
| `GET /api/v1/admin/diagnostics` | 获取同一份诊断报告、队列状态和 HTTP 响应计数 |
| `GET /api/v1/admin/diagnostics/requests/{id}` | 通过 `X-Request-Id` 查询最近一次 HTTP 结果及其运行标识 |
| `GET /api/v1/admin/diagnostics/runs/{id}` | 查询仓库运行的队列状态、尝试次数和阶段进度 |
| `GET /api/v1/admin/metrics?hours=24` | 读取持久化的逐小时 HTTP 计数和延迟 |
| `GET /api/v1/agent-runs/{id}/execution/attempts` | 按仓库读权限查看任务的认领、开始和终态，以及成功结果摘要 |
| `GET /api/v1/admin/model-usage` | 按组织或仓库运行查阅实际模型调用、失败原因和已知用量 |
| `GET /api/v1/admin/entitlements/{organizationId}` | 查阅选配托管权益、模型和任务记账、已冲销记录 |

管理入口需要部署管理员授权。请求记录最多保留最近 500 条，进程重启后从空记录开始。诊断结果只返回操作状态和相关标识。模型状态取当前配置最近五分钟的实际调用结果，尚无样本时显示「尚无近期模型调用」。问答队列只展示汇总状态，模型台账隐藏问答的个人、仓库和轮次标识。上游没有返回的用量保留为空，进程退出导致结算未确认的发送记录超期后显示为未知。

HTTP 计数独立保留最多 30 天。返回 UTC 小时序列，区分普通完成、202 受理、客户端错误、服务端错误和连接中断，并记录耗时总和及最大值。后台每秒合并一次数据，正常关闭时提交剩余计数。数据随数据库备份恢复。接口返回缓冲未落盘的分钟数和因缓冲满而丢弃的计数。任务终态仍以对应的任务记录为准。

## 外部身份目录

团队部署在服务进程同时设置 `REPOGRAPH_EXTERNAL_ISSUER`、`REPOGRAPH_EXTERNAL_AUDIENCE` 和 `REPOGRAPH_EXTERNAL_PUBLIC_KEY_FILE`。签发方为 HTTPS 标识，公钥使用 Ed25519 PEM。部署管理员通过 `PUT /api/v1/admin/external-directory/{tenantKey}` 提交递增 `version`、Unix 毫秒的 `issuedAt` 和 `validUntil`、`accounts` 及 `organizations`。账户用稳定 `subject`、`displayName`、可选 `email` 和 `active`。组织用稳定 `id`、`name`、可选 `active` 和成员的 `subject` 列表。`GET` 返回有效状态、版本和用于授予资源权限的本地 ID。

可信身份网关先取当前浏览器的 `GET /api/v1/auth/csrf` 挑战，再签署带 `iss`、`aud`、`tenant`、`sub`、`iat`、`exp`、`jti` 和 `nonce` 的断言。时间声明使用 Unix 秒，断言最多有效五分钟。保护头设置 `alg=Ed25519` 和 `typ=repograph-session+jwt`。浏览器在应用同源请求 `POST /api/v1/auth/external-session`，保留挑战 Cookie 和 `X-CSRF-Token`，正文传 `{ "assertion": "…" }`。

同步故障可读同一租户的最后完整投影。状态变为 `STALE` 后，刷新版本并让外部用户重新登录。部署公钥及签发方配置由恢复环境提供，目录和审计随数据库备份。

## 托管权益

部署时设置 `REPOGRAPH_HOSTED_ENTITLEMENTS=1` 和 `REPOGRAPH_HOSTED_LICENSE_UNTIL`（ISO 8601 时间）。`REPOGRAPH_HOSTED_ENTITLEMENT_MAX_AGE_MS` 默认为 24 小时。组织仓库、关联同一组织的仓库问答及相应模型发送使用托管策略。个人仓库和个人空间继续使用本地权限与预算。问答同时引用多个组织的仓库时，提交返回 `HOSTED_MULTIPLE_BILLING_SCOPES`。

权益发布方经部署管理员在 `PUT /api/v1/admin/entitlements/{organizationId}` 提交完整数据。`issuedAt`、`validUntil` 及批次边界使用 Unix 毫秒。`version` 是递增整数。必填字段还有 `tasksEnabled`、`modelsEnabled`、`allowPurgedTaskVoid`、`modelBalance`（`AVAILABLE`、`INSUFFICIENT` 或 `UNKNOWN`）及 `trials`。每批包含稳定的 `id`、`startsAt`、`endsAt`、`tasks` 和 `modelCalls`。按 `[startsAt, endsAt)` 判定有效批次，优先用最早到期批次。续期调整批次用量上限时沿用原批次 ID 即可保留消耗量。

快照可选填与试用批次字段相同的 `metered` 对象，批次 ID 需与试用批次不同。试用额度不足时使用有效的按量批次。按量批次和试用批次在查询中分别显示为 `METERED` 与 `TRIAL`。模型余额检查独立执行。

调用 `POST /api/v1/admin/entitlements/{organizationId}/model-invocations/{invocationId}/evidence` 补录已发送调用的计量凭证。正文包含稳定的 `reference`，以及至少一个实际计量字段 `inputTokens`、`outputTokens` 或 `costUsd`。待调用结束或期限届满后提交。相同凭证和内容可重放。补录字段可在模型用量查询中核对，调用终态继续按原响应记录。

调用 `POST /api/v1/admin/entitlements/{organizationId}/tasks/{taskId}/void` 冲销可核查的任务记录。等待受管仓库的回收状态进入 `PURGED` 后提交。任务额度可恢复，模型调用和用量结算保留。托管快照与记账记录随数据库一起备份，部署许可配置由恢复环境提供。

## 服务降级

- `/readyz` 返回 503 时，先确认数据库卷挂载和运行用户的权限。恢复后用历史快照读取验证服务。数据库持续无法读取时，保留数据库及 WAL 文件供恢复。
- 受管文件不可用时，检查资产卷是否按原路径挂载且允许服务账号读写。恢复后从管理后台重查，并打开一条历史归档记录验证。若卷无法恢复，从独立副本核对原件与数据库引用。
- 向量检索不可用时，检查嵌入服务和配置模型。用历史快照的关键词检索确认影响范围。模型恢复后重试一次语义查询，继续失败时记录请求 ID 和快照 ID。
- 队列积压时，先检查执行器心跳、过期租约和最久待执行时间。利用运行 ID 查看失败阶段。心跳恢复后观察原任务是否继续，保留同一任务的执行记录以便复查。
- 服务诊断显示「指标持久化」不可用时，检查 SQLite 的写入锁和剩余磁盘空间。故障恢复后确认小时序列继续增长，缓冲分钟数回落。若持续丢弃计数，记录受影响的时间区间。

## 独立验证执行器

只有部署配置 `REPOGRAPH_VERIFIER_IMAGE` 并且预检成功时，服务才接受隔离验证。值必须是本机镜像的不可变引用，例如 `docker.io/library/node@sha256:<已审批的摘要>`。执行器使用本地 Unix Docker socket，从现有镜像启动，运行期间禁止拉取镜像或安装项目依赖。使用 `GET /api/v1/verifications/capability` 核对探测结果。

`POST /api/v1/verifications` 接收 `projectId`、`snapshotId`、`recipe: "node-test-v1"`、`files` 和可选 `timeoutMs`。提交携带 `Idempotency-Key`。输入限于发布快照中的 256 个文件及 8 MiB，容器使用 256 MiB 内存、单 CPU 配额、32 个进程和 16 MiB 可写临时目录。控制面在端点返回的 `pollVia` 提供报告。`/api/v1/agent-runs/{id}/execution` 提供管理状态，暂停、取消、改序和恢复须提供当前修订。

诊断显示等待对账时，确认本机 Docker 可连接并且应用暂存目录可读写。恢复后检查该任务的旧尝试是否已退出、是否生成新尝试与结果摘要。执行器禁用后仍可查询已发布报告。资格检查、结果生成、取消和重派已在实际 Docker Desktop Linux 容器中验证。

## 备份和恢复

先停止使用该数据库的服务，再用原部署的环境变量运行 `backup`。命令在复制期间持有 SQLite 独占锁，检测到仍在运行的实例会返回 `RECOVERY_DATABASE_IN_USE`。备份和恢复目的地都需要使用尚不存在的目录。请将备份放在项目索引范围之外。

```sh
npm run recovery -- backup /private/backups/repograph-2026-11-26
npm run recovery -- verify /private/backups/repograph-2026-11-26
npm run recovery -- restore /private/backups/repograph-2026-11-26 /private/repograph-rehearsal
```

备份包含 SQLite 数据、受管归档原件、Git 检出、生成产物与数据库加密密钥。数据库里的索引和历史 ID 会保留。恢复会校验文件 SHA-256、数据库完整性、归档引用和加密凭据，并把受管路径指向新目录。工作区中由用户维护的本地仓库和部署用访问令牌仍由原部署环境提供。

恢复命令输出新的数据库和资产目录。演练时用该输出配置 `REPOGRAPH_DB_PATH` 和 `REPOGRAPH_ASSETS_ROOT`，让旧实例保持离线，再启动恢复副本。保留与备份相同的加密环境变量，或取消这些变量以加载备份内的密钥文件。检查旧快照源码、已编辑 Wiki 的导出、模型用量和待运行任务。备份目录包含可解密模型与 Git 凭据的密钥，应当以与原数据库密钥相同的访问权限保管。

## 兼容升级和回退演练

在切换写入前保留旧版本制品及已验证的备份。从同一备份恢复两个独立目录，一个用于新版预演，一个保留给旧版回退。启动新版副本，先核对原仓库 ID、已有 Wiki 修订和导出，再重建旧索引并生成一份新版快照。旧索引缺少快照所需源码时，重建索引后再发布首个精确快照。

已用提交 `1104549` 在隔离环境执行上述演练。新版保留仓库和旧 Wiki 的身份，可生成并读取新快照。旧版从升级前备份恢复后的 Wiki 导出与升级前逐字节一致。该旧版的 API 对新版快照类型返回 404。需要继续读取新版写入时，保留独立的新版数据目录，并使用支持这些类型的版本启动。
