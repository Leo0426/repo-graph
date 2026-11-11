# 模型接入依据

核对日期：2026-11-10。仅用于文本生成通道配置，不把厂商名称当作独立协议或实际连接成功证明。

| 模板 | 传输方式 / 前缀 | 一手依据 |
| --- | --- | --- |
| OpenAI | Chat Completions，`https://api.openai.com/v1`，`max_completion_tokens` | [API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) |
| Anthropic | Messages，`https://api.anthropic.com/v1` | [Messages API](https://platform.claude.com/docs/en/api/messages/create) |
| Gemini | OpenAI compatibility，`https://generativelanguage.googleapis.com/v1beta/openai` | [Google 官方兼容指南](https://ai.google.dev/gemini-api/docs/openai)，[Google 官方论坛参数答复](https://discuss.ai.google.dev/t/gemini-3-6-flash-openai-compatible-token-limits-response-fields-and-auth-keys/183372) |
| DeepSeek | Chat Completions，`https://api.deepseek.com`，`max_tokens` | [首次调用](https://api-docs.deepseek.com/)，[参数契约](https://api-docs.deepseek.com/api/create-chat-completion/) |
| 通义 / 百炼 | OpenAI compatibility，默认北京 `https://dashscope.aliyuncs.com/compatible-mode/v1` | [兼容指南](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)：旧域名仍可使用，建议按业务空间/地域调整 |
| 硅基流动 | Chat Completions，`https://api.siliconflow.cn/v1`，`max_tokens` | [官方 API](https://docs.siliconflow.cn/docs/api/chat-completions-post) |
| Ollama | native Chat，`http://localhost:11434`（可编辑） | 本项目既有 native Chat 实现及本地 HTTP fixture；[官方 API](https://docs.ollama.com/api/chat) |
| 企业网关 | 空地址，自定义协议及模型 | 不预设网关供应商或认证成功；选其支持的 OPENAI / OPENAI_COMPATIBLE / ANTHROPIC / OLLAMA |

模型 ID 不写死为“最新推荐”，价格不从文档猜测。接入模板只填草稿，所有字段可编辑，保存/测试/启用是独立动作。
兼容通道发 `max_tokens`，原生 OpenAI 通道发 `max_completion_tokens`；不同时发送两者，也不遇错自动重放付费请求。
请求仍受输出上限、大小限制、总时限、秘密脱敏及业务结果校验约束。真实厂商调用未执行（无外部凭据）。
