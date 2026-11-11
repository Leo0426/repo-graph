# Provider 模型发现与价格表单简化验收

日期：2026-11-11。交付为本地代码和验收记录；未提交、未推送。

## 行为

- 管理员可使用未保存草稿的 API 前缀、协议和 API key 获取模型列表，再显式选择；也可继续手填模型 ID。
- 编辑已有配置时密钥留空可复用已保存密钥，仅限原地址和协议；新密钥不会因获取列表而持久化。
- 支持 OpenAI、OpenAI Compatible、Anthropic 和 Ollama。只读取模型列表，不执行生成、不保存或切换 Provider。
- 加载、失败重试、空列表和语言切换均有对应状态。连接或密钥变化、应用模板、关闭表单会取消旧请求并废弃迟到响应。
- 移除输入/输出单价表单及列表价格提示。用户已确认取消未知价格的研判拦截；未知费用返回 null，不记为免费。
- 历史单价保留兼容且继续执行成本预算。名称、密钥等编辑不清除原价；更换模型、地址或协议不沿用旧价。
- 输入裁剪、citation 校验、输出上限、超时和重试限制保留。评测中任一已完成建议费用未知时，总费用也为 null。

## 验证

| 检查 | 结果与边界 |
| --- | --- |
| `:repograph-app:test` | 1179 项中 1175 通过、0 失败、4 跳过。跳过为 Semgrep 实机 2 项和检索基准 2 项，缺少对应配置。 |
| `:repograph-mcp:test` | 30 项通过报告从 Gradle 缓存复用，本轮未重新执行 MCP 测试。 |
| 浏览器 admin-workflow、design-system、capabilities | 33 通过、0 失败、0 跳过；真实模板/脚本配合模拟 API。包含亮暗主题和桌面/手机模型选择器。 |
| 模型发现协议与异常 | 本地真实 HTTP 验证认证头、分页、密钥绑定、重定向拒绝、失败脱敏、慢响应整次时限、响应大小上限。 |
| 完整安全链 | 发现端点只允许管理员且要求 CSRF；使用临时 SQLite，草稿不落库。 |
| 打包 | bootJar 成功，73 个静态/模板资源与当前源文件逐字节一致。 |
| 运行版本 | 8080 已更新并完成真实登录、发现、选择和前后配置一致性检查；上游为本地 HTTP 模型列表 fixture，没有调用厂商或执行生成。 |

新 JAR SHA-256：`58bfe49cb7a2600496a93d9313c2b600ed21f00c1c841312a72290774cb15ef1`。

本地访问：http://localhost:8080/#admin 。测试和运行记录在
[results](/Users/heyonepiece/Projects/personal_projects/repo-graph/repograph-app/build/provider-models/results)；截图在 [screens](/Users/heyonepiece/Projects/personal_projects/repo-graph/repograph-app/build/provider-models/screens)。
已清理重启时残留的旧进程；当前运行 PID 为 75680。隔离 UI 预览验收后停止，实际 app 保持运行。

## 协议参考

模型发现按已有配置的 API 前缀追加相应路径，不猜测供应商，也不自动调用生成接口：
[OpenAI Models](https://developers.openai.com/api/reference/resources/models/methods/list)、
[Claude Models](https://platform.claude.com/docs/en/api/models/list)、
[Ollama Tags](https://docs.ollama.com/api/tags)。核对日期为 2026-11-11。

## 变更边界

新增独立 `ModelCatalog` 隐藏模型列表传输、分页、响应上限和错误脱敏；配置存储负责草稿校验及密钥解析，
控制器仅暴露管理员发现入口。现有生成通道未因发现功能改写。
价格相关改动局限于 Provider 管理、研判未知价格的前置判断及费用的未知值传播。

仓库本轮开始前已有大量未提交改动。原有两份暂存文件及暂存内容未改动；未把全部工作区归入本轮变更，
未改写前轮八份 PR 草稿。没有使用真实 TokenHub API key 验证厂商网络、账号权限或具体模型的生成兼容性。
