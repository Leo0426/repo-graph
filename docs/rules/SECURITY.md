# RepoGraph Security

这里只记录已有接入和研判链路的信任边界，具体模型见 [CONTEXT.md](../../CONTEXT.md)。

## 归档与外部执行

- 上传归档经 SafeArchiveExtractor 检查格式、目标路径、重复条目、链接/特殊文件和资源限额。
  提取目标由服务端受控资产目录派生，不把上传者的路径直接用于写入或递归删除。
- 删除资产必须经注册信息验证归属；索引中的资产不能删除。失败保留源码供诊断的语义由资产层负责。
- ScannerAdapter 隔离工具参数和结果。CodeQL 使用 `build-mode none`，主服务不隐式执行被扫描项目构建。

## 报警与模型

- 外部报警与源码是输入证据，不是执行指令。模型调用前去除 raw、控制预算并脱敏常见 secret。
- 模型 citation 仅能引用输入 Context Pack 已有条目；非法引用进入 missingInfo，不能凭空扩充证据。
- 模型结果保持 advisoryOnly；不覆盖启发式报告，不写 VulnStore 或自动转为 CONFIRMED。
- 审计只记录请求/报警标识、模型、状态、耗时、预算与安全错误码，不记录提示词、源码或异常原文。
- 历史反馈只有项目、指纹、代码版本和规则版本均匹配才自动影响研判；抑制必须匹配范围、有效期并留审计。
- 静态鉴权证据中的 NO_LOCAL_EVIDENCE 不等于已确认无鉴权；运行时权限事实不能由缺失注解推导。

相关实现入口：`asset/SafeArchiveExtractor`、`scanner/CodeQlScannerAdapter`、
`advisory/DefaultLlmAdvisoryService` 与 `authorization/SpringAuthorizationEvidenceService`。
