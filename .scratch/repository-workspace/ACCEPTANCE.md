# 仓库工作流验收

日期：2026-11-10。PRD.md 的 8 项范围已实现；保留已有领域能力与权限，不把界面聚合当作新的分析算法。

| 规范项 | 实现证据 | 验证 |
| --- | --- | --- |
| 1. 五域导航、仓库首页、旧路由 | fragments/nav.html、workspace.html；repograph-store.js 的工作域映射与默认 tools | repository-workspace：五主入口、域内跳转、刷新和历史；workspace：旧 stats 深链/快捷键/移动抽屉 |
| 2. 仓库起点及上下文 | tools.html 仓库首页；repograph-tools.js 选择仓库/下一步；setGlobalProject 继续协调各页面 | 选择第二仓库后检索/Wiki/缺陷保持该 ID；无项目禁用分析动作；503 重试恢复；普通用户无仓库提示联系管理员，隐藏索引 |
| 3. 理解与缺陷聚合 | 代码理解域含 search/symbol/graph/wiki；缺陷域含 vulns/agent/metrics/sbom | 原搜索、图、符号、Wiki、漏洞、Agent、质量及 SBOM 浏览器套件全部通过；后端权限测试全量通过 |
| 4. 能力验证 | validation 域 health/benchmark；仓库首页说明索引、服务、质量证据区别 | 现有 health/benchmark 回归：失败撤下绿灯、404 无测评、快照来源/时间/阈值、迟到响应；不自动启动测评 |
| 5. 管理与更多服务模板 | 平台管理保留账户/组织/归属/审计，Provider 新增 8 类服务草稿模板 | admin-workflow 对全部模板检查地址/协议、无请求、草稿秘密清除、企业网关可保存，既有管理回归通过 |
| 6. 协议与持久兼容 | ModelProvider.Protocol.OPENAI_COMPATIBLE；GenerationGateway 独立 token 参数，兼容 SSE；Store 原有加密与迁移 | 两类 OpenAI 请求断言；四配置协议流式验证；兼容协议保存重启/密钥生命周期；中止、资源不足与工具调用终态不接受部分文本 |
| 7. 语言/键盘/手机/失败恢复 | 新导航及可访问名称中英文；repository-workspace.css；旧控件保留 | 146 项完整 UI 回归通过，新增无障碍属性后 repository-workspace 4 项再通过；1440px/390px 截图检查；深链同步全局项目范围 |
| 8. 文档、回归与本地运行 | PRD、MODEL-SOURCES、CONTEXT、Development、Interaction Design、Design System、Validation | 最终后端、前端、打包与真实本地登录/管理页冒烟均通过，详情如下 |

## 实际结果

- `./gradlew test --tests '*Test'`：BUILD SUCCESSFUL。app 1136、MCP 30，共 1166 项；XML failures/errors/skipped 均 0。MCP 未改动，最终任务 UP-TO-DATE，沿用其有效报告，不声称每次重新执行。
- `UI_BASE_URL=http://127.0.0.1:18550 node --test repograph-app/src/test/ui/*.test.cjs`：146 项通过，无失败/跳过。最后仅添加导航的英文 aria-label，再运行 `repository-workspace.test.cjs` 4 项通过。
- 先失败后修复的协议测试：兼容 token 参数最初 2 项中 1 失败；部分输出终态最初 4 项中 3 失败；实现修正后随最终完整普通测试通过。
- `./gradlew :repograph-app:bootJar -x test`：通过；打包不计为测试。
- 新 app PID 69971，启动日志显示 8080 已监听。真实浏览器 admin 登录后默认仓库工作台、五个主入口和 Gemini 兼容模板均验证成功，pageerror 为空。未保存测试模型配置，未发出付费调用。
- `git diff --check`：通过。未提交/暂存本轮文件，保留工作区原有改动。

日志：`/tmp/repograph-repository-final-tests.log`、`/tmp/repograph-repository-final-ui.log`、`/tmp/repograph-repository-a11y-ui.log`、`/tmp/repograph-local.log`。
截图：`/tmp/repograph-repository-desktop-final.png`、`/tmp/repograph-repository-mobile-final.png` 为虚构 fixture 渲染；`/tmp/repograph-repository-live.png`、`/tmp/repograph-provider-templates-live.png` 为真实本地 app。

## 验证边界

- 没有外部模型凭据；服务模板及协议由一手文档、本地真实 HTTP fixture 和前端流程验证，真实厂商可用性由管理员配置后显式连接测试确认。Gemini 为 OpenAI 兼容文本接口，不声称支持其全部原生多模态能力。
- 模型 ID 和价格不写死；服务模板可编辑、非供应商兼容认证清单。生成模型与检索 Embedding 仍独立配置，后者未在本轮改造。
- 浏览器回归使用模拟 API；真实本地冒烟验证页面加载和配置草稿，不声称已经对用户仓库完成扫描或获得检索基准成绩。服务不可用、缺少索引或离线快照时界面如实呈现。
- 普通测试不包含 IT/Benchmark；未重新运行真实外部向量/Embedding 质量基准，也未变更其算法。SDD/DDD 以规范、领域边界、测试和验收记录实践，不额外添加无业务价值的“方法论模块”。
