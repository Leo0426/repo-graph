# RepoGraph Harness 深度检查

本次范围是 Agent 工程协作入口、反馈、约束、漂移与可观察性，不评价产品安全能力的优劣。
保留本轮开始时已有 UI/MCP 工作区改动；测试针对实际工作区，不能解释为纯 HEAD 的结果。

## 已落地内容

- 将 AGENTS.md 改为任务路由；原编码、测试、错误处理和已知局限分别归入职责文档。
- 领域模型、metadata 和既有架构决策仍由 CONTEXT.md 持有；Architecture 提供改动地图，Glossary 索引已有定义。
- `.harnesskit/audit/artifact-manifest.json` 登记 10 个根级产物，schema 为 6。
  所有职责均适用于全仓，无需为两个 Gradle 子项目各复制一套。
- 修正 CONTRIBUTING.md 的 Gradle 测试过滤器，去除 domain.md 中已过时的 JGraphT 决策示例。

## 归属判断

| Owner | 生成依据 |
|-------|----------|
| agents / architecture / glossary | bootstrap 固定入口；已有项目规则、真实两模块构建和 CONTEXT.md 术语 |
| validation | 根 Gradle/JUnit 任务、IT/benchmark 前提、报告与跳过语义 |
| development | 两个进程入口、容器服务、配置覆盖与用户目录运行数据 |
| coding | 原 AGENTS.md 的 Java、注入、Javadoc、版本与测试规则 |
| reliability | 原降级约束、协议纯净性、索引 partial 和审核事务 |
| security | 不可信归档、外部 CLI、模型证据白名单与人工确认边界 |
| design-system | 已有全局 CSS 变量、共享按钮、Agent 字号角色与 reduced-motion |
| interaction-design | 已有轮询保留状态、SSE 错误、辅助建议和人工审核交互 |

没有引入新的产品决策、领域术语或权限规则。工程文档沿用已有政策及代码/测试证据。

## 实际验证

| 检查 | 结果及限度 |
|------|------------|
| 原 `./gradlew test --tests '!*IT'` | 失败：MCP test 任务 No tests found；否定写法不是排除语法 |
| 修正后 `./gradlew test --tests '*Test'` | BUILD SUCCESSFUL；app 831 个用例含 5 skipped，MCP 22 个无 skipped；总计 848 passed、5 skipped |
| core 与 graph 导入抽查脚本 | 扫描 156 个 core Java 文件，无第三方/实现包 import；graph 无 vector import；只是本次静态检查，未安装自动门禁 |
| 文档与 manifest | 10 个实际文件、相对链接、根 AGENTS 四个必需 section 校验通过；CLI artifacts-status 为 present |
| 隔离 worktree | 从 HEAD 创建临时 detached worktree，仅复制本轮文档；三条任务路由和 health/log 源码入口可读；检查后删除 |
| 隔离运行态 | 未启动服务、浏览器或重新构建；user.home 数据路径仍需显式隔离，不能宣称干净工作树运行通过 |
| Harness 生命周期 | doctor 显示 SessionStart/PreToolUse/PostToolUse 配置匹配；未通过 commit 触发 Refresher，不能宣称维护闭环已实测 |

## 有证据的改进候选

以下是待实现建议，不作为已经采纳的新约束。

1. **恢复字节码测试的真实覆盖。** JavaBytecodeParserTest.setup 仍指向已移除的 repograph-parser，
   5 个用例以缺失 class 的 assumption 跳过。当前 app 已编译成功；这是构建迁移后的测试入口漂移，
   不是本轮 native library 不可用。改为当前 app 产物或独立 fixture，并在应已编译的场景缺失产物时失败。
2. **修复 Qdrant 集成检查接线。** QdrantVectorStoreIT 固定使用 16333 gRPC，而 docker-compose.yml
   映射 16333→REST、16334→gRPC；不可达会 assumption 跳过。集中配置测试连接并区分可选本地跳过和必须执行的集成任务。
3. **把已有硬约束接入可执行检查。** core/实现包、graph/vector 的禁依赖目前本次检查通过，但根构建没有对应边界检查。
   根 build.gradle.kts 的 ASM/gRPC force 仍有裸版本，与 Version Catalog 规则冲突。先集中版本，再加入可重复的结构检查。
4. **缩短并明确自动反馈。** 当前仓库未发现已跟踪 CI 配置或项目检查 hook；本地 Git hooks 无非 sample 文件，
   core.hooksPath 未设置。用户级 Harness hook 不等于项目 Gradle 检查。建立按变更范围运行、超时有界的反馈入口，
   明确单元测试、IT、benchmark 三类结果，并在提交/CI 的真实入口绑定。
5. **验证文档维护退出旧来源。** manifest 和按任务路由已就绪，但 CONTEXT.md、README、CONTRIBUTING、quickstart
   仍有可漂移的环境说明；例如 quickstart/CONTRIBUTING 的 Embedding 模型不同于当前 application.yml。
   后续在真实提交中验证 Refresher，并用配置作为环境值来源，修复原文或改为指针，不能只追加新说明。
6. **补齐运行边界观察。** McpStdioServerTest 直接调用 dispatch，未覆盖 Spring 启动 banner/logging 的进程 stdout；
   加入启动进程到 JSON-RPC 响应的检查。隔离 worktree 中还需独立配置 SQLite/资产路径与测试 collection，
   才能验证 UI、health、日志、SSE 和人工审核的运行闭环。

## 三条入口路径复核

- 新领域接口：AGENTS → Architecture → core 契约；实现与存储适配落到对应能力包。
- 归档或 LLM 修改：AGENTS → Security → SafeArchiveExtractor / DefaultLlmAdvisoryService → 对应行为测试。
- MCP/测试失败：AGENTS → Validation / Reliability → 子项目任务、XML skipped、stdio 日志配置。

这些路径在临时隔离 worktree 中可达；本次没有提交、推送、部署或新增项目自动执行 hook。
