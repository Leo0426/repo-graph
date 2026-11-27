# HTTP、MCP 和 CLI

工作台、stdio MCP 与 CLI 共用 HTTP 服务的身份、范围和版本校验。登录后可从 `GET /api/v1/capabilities` 查看协议版本、范围、操作及数量上限。旧服务没有声明所需能力时，MCP 和 CLI 会在提交新范围前返回 `SERVICE_CAPABILITY_UNAVAILABLE`。

MCP 从 `node dist/mcp.js` 启动。CLI 通过 `npm run cli -- <操作名> [JSON]` 调用，通过 `npm run cli -- --help` 查看操作。两种客户端都读取 `REPOGRAPH_BASE_URL`。凭据使用 `REPOGRAPH_ACCESS_TOKEN`，或同时设置 `REPOGRAPH_USERNAME` 和 `REPOGRAPH_PASSWORD`。

部署启用 `REPOGRAPH_DEVICE_AUTH=1` 后，可运行 `npm run cli -- authorize_device "Work laptop"`。在 CLI 给出的设备授权页登录并确认短码。CLI 将凭据按服务地址保存在 `~/.config/repograph/devices`，可用 `REPOGRAPH_DEVICE_CREDENTIAL_DIR` 覆盖存放目录。环境中显式提供的凭据优先。撤销入口在工作台的「账户 → 设备授权」。

部署启用 `REPOGRAPH_REMOTE_MCP=1` 后，Streamable HTTP 客户端连接同一服务的 `/mcp`，发送 `Authorization: Bearer ...`。通过客户端的工具清单查看该传输提供的只读操作。服务监听在环回接口，跨设备连接使用现有的受信隧道。

```sh
npm run cli -- capabilities
npm run cli -- projects
npm run cli -- list_knowledge_snapshots '{"projectId":"0123456789ab"}'
npm run cli -- search_knowledge '{"query":"inventory","scopes":[{"kind":"repository","projectId":"0123456789ab"}]}'
```

历史读取使用发布快照 ID。需要固定 Wiki 正文时，同时给出页面 ID 和修订 ID。持久任务提交返回运行 ID，随后可用 `inspect_run` 读取终态。重试同一提交时复用幂等键。MCP 新工具同时提供文本 JSON 和包含 HTTP 状态的结构化结果，CLI 的 HTTP 错误写入标准错误并附带请求 ID。

通过 `POST /api/v1/index/project` 提交本地整仓索引时，可以附带 `Idempotency-Key`。返回的 `agentRunId` 可用于查看运行和执行尝试。默认索引状态接口继续接受原来的仓库目录。服务重启后恢复提交时固定的源码。

`search_knowledge` 支持 `repository`、`wiki`、`document` 和 `space` 四种范围。结果包含实际版本、覆盖情况和可在工作台打开的链接。链接每次都重新授权。

编辑者可调用 `compare_change_snapshots`，传入 `projectId`、`targetSnapshotId` 和 `key`。传入 `baseSnapshotId` 可指定同仓已发布快照，省略时使用最近的评审基线，传入 `null` 时评审完整目标。REST 接口从 `Idempotency-Key` 接收同一个键。结果保留比较范围及所用快照 ID。

`compare_change_scope` 接收 `targets`、`background` 和 `key`。背景条目使用 `projectId`、`snapshotId` 及可选 `{path, line}` 引用列表。使用 `inspect_change_scope` 重开组合报告。每个独立目标报告可用 `read_change_finding_history` 查看原发现的处置修订，写入使用 `decide_change_finding`，携带当前 `revision` 和 `key`。

`compare_working_copy` 接收 `projectId`、同仓的 `baseSnapshotId`、选定的相对 `paths` 和 `key`。读取冻结的本地覆盖层用 `read_change_overlay_source`。`submit_change_review` 使用 `projectId`、`reviewId` 和 `key` 运行持久的模型评审。已有的运行执行状态和尝试接口可查看恢复与停止结果。

`submit_sast_triage` 接收 `projectId`、`fingerprints` 和 `key`，对已导入的发现提交持久分诊。`submit_archive_scan` 接收 `assetId`、可选 `scanners`、`timeoutSeconds` 和 `key`。用返回的 `taskId` 调用 `inspect_archive_scan` 读取尝试记录，再以对应的执行修订调用 `control_archive_scan`。

`propose_change_patch` 使用评审 ID、仓库 ID、幂等键和 `{ path, baseDigest, content }` 文件列表。`inspect_change_patch` 查看脱敏预览和处置。编辑者可从 `GET /api/v1/change-patches/{patchId}/artifact` 下载原始补丁，并使用 `decide_change_patch` 明确采纳或弃用。采纳结果仍可作为独立补丁下载。

`propose_review_rule` 用 `projectId`、`key`、规则草稿 `rule` 和证据列表 `evidence` 建立候选。证据包含 `reviewId`、`findingId` 和人工处置 `revision`。`inspect_review_rule_candidate` 读取记录，审查和发布仍使用现有规则流程。

发现接口声明 `isolatedVerification` 时，编辑者可用 `submit_isolated_verification` 提交发布快照、`node-test-v1` 及确切测试路径。提供 `patchId` 时，容器使用匹配目标快照上的候选文件。`inspect_isolated_verification` 使用运行 ID 查看任务、尝试和验收报告。关闭执行器后仍可读取现有报告。

`prepare_wiki_export` 接收 `projectId`、`snapshotId`、`pageId`、`revisionId` 和 `format`。可选 `section` 从 0 开始。服务声明 `wikiDocxArtifacts` 时，格式可以选择 `docx`。结果提供实际的修订、摘要和下载路径。

`read_ask_context` 使用 `sessionId` 读取私有会话的近期消息与已核对引用。工作台对没有新匹配的追问显示沿用的引用。对于空间 PDF，引用及轮次的显式上下文可包含版本内页码。

`create_ask_session` 可使用 `review: { projectId, reviewId, findingId? }` 建立仅使用某份冻结报告的会话。`findingId` 可将上下文缩小到某项结构化发现。此类会话的引用返回原报告和发现位置。

`create_ask_session` 可接收 `{ name, pdfBase64 }` 格式的私有 PDF 附件。读取精确附件版本返回逐页文字。PDF 附件的会话提交和显式页码上下文由 `askPdfAttachments` 声明。

`spaceCsvDocuments` 声明 CSV 修订能力。`edit_space_csv` 接收 `spaceId`、`documentId`、`baseVersionId`、`key` 及含 `row`、`column` 和 `value` 的 `edits`。读取和搜索的行列从 1 开始。Ask 可用 `cell` 随显式文档上下文引用单元格。

编辑者可调用 `generate_space_document`。新建目标用 `target.name` 和可选的 `target.parentId`。编辑目标用 `target.itemId` 和 `target.baseVersionId`。两类操作均提供 `spaceId`、`instruction` 和 `key`，成功结果包含实际写入的版本 ID。

`spaceAdministration` 声明空间配置、成员、目录、仓库关联和回收站操作。先用 `inspect_project_space` 取得空间当前修订号，再提交空间配置或成员变更。`restore_space_repository` 恢复原关联范围，`list_detached_space_repositories` 列出当前身份可恢复的关联。CLI 与 MCP 使用和工作台相同的权限与版本校验。

`list_trashed_projects` 列出当前身份可管理的回收站记录。使用 `inspect_project_lifecycle` 取得当前修订，再通过 `change_project_lifecycle` 提交 `projectId`、`revision`、`action` 和 `key`。同一次提交重放时复用 `key`。托管文件清理返回 `PURGING`，可以继续查询到 `PURGED`。

## 协作事件

启用 `REPOGRAPH_COLLABORATION=1` 后，可在发现接口查看 `collaborationIngress`。部署管理员向 `POST /api/v1/admin/collaboration/connections` 提交 `name`、`externalActor`、普通 `accountId` 及目标清单 `projects`、`askSessions`。响应中的 `credential` 只在创建时返回。管理员可在同一路径列出连接，并通过 `POST /api/v1/admin/collaboration/connections/{id}/revoke` 撤销连接。

连接使用 `Authorization: Bearer <credential>` 向 `POST /api/v1/collaboration/connections/{id}/events` 提交 `eventId`、`externalActor` 和 `action`。可用动作 `{ "type": "wiki.generate", "projectId": "…", "mode": "incremental" }` 或 `{ "type": "ask.turn", "sessionId": "…", "turn": { "question": "…" } }`。按原事件 ID 重放同一个输入。仅当回执为 `RETRYABLE` 或发送时连接中断时，重新投递原事件。每个事件最多提交三次，已受理事件可重复查询。

用 `GET /api/v1/collaboration/connections/{id}/events/{eventId}` 查询投递和任务终态。收到 `ACCEPTED` 时，`runId` 可与工作台中对应的任务或 Ask 轮次核对。

## 安装独立 CLI 和 stdio MCP

在有依赖的源码工作区，发布方用目标平台构建归档和签名清单。发布私钥为 Ed25519 PEM。每次发布用一个新的制品目录。

```sh
npm run client:release -- build ./client-release https://releases.example.org /private/signing-key.pem
```

安装方需要 Node.js 24 或更高版本及 `tar`。从可信渠道取得安装脚本和发布公钥，再使用已下载的制品目录。升级时对同一安装目录执行相同命令，传入新制品目录。

```sh
node scripts/client-release.mjs install ~/.local/repograph ./client-release https://releases.example.org ./publisher-public.pem
node ~/.local/repograph/cli.mjs --version
node ~/.local/repograph/cli.mjs capabilities
node ~/.local/repograph/mcp.mjs
```

安装器校验清单签名、预期来源、系统、架构、版本及 SHA-256，并检查两个客户端可启动。旧版本目录仍可直接运行。客户端凭据仍按前文使用环境变量或设备授权。
