# 任务依赖与状态解释

这是现有能力在界面的投影，不增加新的业务状态机。基础服务状态来自现有完整、有效的健康响应；连接未知不能推断无数据。

| 任务 | 事实来源与依赖 | 降级时保留的行为 |
| --- | --- | --- |
| 语义与代码相似检索 | 查询 Embedding 来自 Ollama；向量排名、过滤、分页来自 Qdrant | 已显示内容仍可阅读；依赖异常就地提示，可主动重试；不自动重建索引 |
| 接入与索引 | 管理员显式启动；解析、Neo4j、Embedding、Qdrant、SQLite 缓存沿原管道执行 | 部分完成保留实际结果与错误；查看页面不启动任务 |
| 图谱 | Neo4j 已有符号与关系 | 不依赖生成模型；查看源码另经 Qdrant 的符号/位置查询，不把图连通当作源码可读 |
| 已保存事实与文档 | 已保存 Wiki 来自 SQLite；质量静态分析消费已有图数据 | 阅读已有 Wiki 不需要 Embedding 或新生成；存在性与读取成败由对应读取接口验证，不能承诺必有文档 |
| 模型辅助 | 独立生成 Provider；新研判还需沿现有定位与证据链取得上下文 | 关闭或失败不覆盖启发式报告；配置只表示已保存/启用，不能代表生成成功 |
| 人工审核 | SQLite 中的 Run、审核队列和冻结 ReportSnapshot | 阅读已有运行和冻结报告无需新模型调用；新研判的证据组装仍受外部服务影响 |

## 配置与验证的区别

`GET /api/v1/capabilities/generation` 只读取选中的已保存 Provider，向已批准账号返回配置与启用事实、名称和模型。不返回地址、密钥或密钥配置状态，不执行连通测试，不调用生成网关。`connectionStatus=NOT_CHECKED` 与 `generationStatus=NOT_VERIFIED` 明确表示该读取未验证网络或推理。

基础健康中的 Ollama 明确命名为 Embedding Ollama，与生成 Provider 分开。健康卡给出受影响服务和检查入口；普通账号的模型恢复路径是联系管理员，不能访问管理配置接口。真实任务成功或失败仍以该任务的服务端结果为准，健康探测不代替任务响应，也不因探测失败永久禁用用户主动重试。

## 验证入口

- `capabilities.test.cjs`：Embedding 异常、生成关闭/未配置/启用未验证、配置读取失败与重试、普通账号/手机/无仓库、无隐式测试与任务。
- `ProjectAccessHttpTest.generationCapabilityIsReadableWithoutExposingAdministratorConnectionDetails`：真实认证和权限链、只读状态及不暴露连接详情。
- 原健康、Agent 和管理回归继续验证轮询新鲜度、降级、真实任务状态和管理员显式连接测试。
