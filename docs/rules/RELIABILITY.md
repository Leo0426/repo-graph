# RepoGraph Reliability

维护失败路径时保留下列既有语义；领域状态的完整定义见 [CONTEXT.md](../../CONTEXT.md)。

## 解析和索引

- JavaParser 解析失败：WARN 并跳过文件，不中断全项目索引。
- Tree-sitter native library 加载失败：ERROR 并跳过该语言；单文件异常降级启发式解析并记录日志。
- 调用目标无法解析：`resolved=false`，不把未解析 CALLS 边写入图。单条图边失败 WARN 并跳过该边。
- 索引返回 202 后继续观察终态；部分解析、Embedding 或写入失败应保留错误并显示 partial。
  只有无错误完成才是 done；致命失败为 error。成功文件才提交增量指纹，失败文件保留重试资格。
  解析成功但没有符号与解析失败必须区分，不能让合法空文件一直重试。
- CodeUnit 字段同时影响 Qdrant、SQLite 和 Neo4j；改字段前核对全部映射，不随意增删。

## 研判和审核

- VulnFinding 创建时为 SUSPECTED；模型建议不能自动确认漏洞。
- LLM 不可用、关闭、超时或响应无效时保留启发式报告；不把辅助降级包装为完整模型结论。
- AgentStep 先持久化 RUNNING，再以相同 step ID 更新终态；部分失败保留已产证据。
- ReviewQueueStore 通过事务内条件 UPDATE 进行迁移，仅真实迁移写审核事件；认领仅从 PENDING 发起。
- 快照生成后冻结，Markdown/JSON/PDF 由同源报告派生，保持报警与 citation 一致。
- MCP stdout 是 JSON-RPC 传输通道；banner、日志及异常输出不得污染协议。

## 已知分析局限（记录，不修复）

- 缺少完整 classpath 或外部源码时，部分调用目标无法解析。
- Lombok/annotation processor 生成代码、反射和动态代理无法可靠静态追踪。
- C 不做预处理器宏展开，也不按 build config 选择条件编译；函数指针调用不能精确解析。
- TaintVulnScanner 为 flow-insensitive 保守近似，Callee 按简单名匹配，多重载全部展开。
- ComplexityAnalyzer 按 rawSource 统计，Complexity/Coupling 都是启发式估算，注释关键字可能误计；
  复杂度不能作为严格门禁。

验证上述行为时按 [Validation](../VALIDATION.md) 选择测试；信任与数据暴露边界见 [Security](SECURITY.md)。

## 后台任务

索引和 Agent 执行器有界且受 Spring 管理；执行器拒绝必须记录失败并释放已取得的扫描配额。
启动恢复只适用于单 app 进程拥有的运行数据库：终止遗留自动执行、保留完成证据和人工审核状态，
不自动重放外部副作用。具体状态映射与显式重试入口见 CONTEXT.md 的“索引完成与后台任务恢复”。
