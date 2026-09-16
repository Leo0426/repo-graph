# RepoGraph Interaction Design

高影响流程以 [CONTEXT.md](../CONTEXT.md) 的 Agent 工作台、架构评审及审核队列定义为准。

- 启动研判前需要项目；漏洞中心模式要求选中漏洞，外部报警模式要求有效的 Semgrep / SARIF JSON。
  运行中的按钮状态与服务端 Run 状态配合，避免重复提交。
- 列表轮询和步骤更新保持滚动位置与已展开的证据/审计详情；状态更新使用稳定 Run/Step ID。
- 步骤展示能力、状态、结果引用、证据和缺失信息；模型建议保持辅助标识，人工审核仍基于原启发式报告。
- A/02 的 SSE 增量是模型公开结构化输出；默认折叠，用户展开后可查看。完成时局部替换结果，
  `stream-error` 保留服务端错误详情，不被通用连接错误覆盖。
- LLM 关闭和能力降级需要明确显示，不能表现为成功生成了模型结论；审核入口区分等待审核和已经完成。

前端入口在 `static/js/repograph-agent.js`、`repograph-app.js` 与对应 Thymeleaf 面板。
修改后实际检查启动、运行、降级、完成和错误路径；视觉角色见 [Design System](DESIGN_SYSTEM.md)。
