# RepoGraph 优化策略与下一步开发方向

调研日期：2026-10-03（Asia/Shanghai）。代码基线：`123ce44`。优先顺序：正确性、稳定性、性能。

后续实现进度：同文件图/向量替换、持久清理重试和项目变更串行化已进入本地实现，当前行为、验证与
剩余边界见 [索引一致性记录](index-consistency-validation.md)。下文保留调研基线事实，不能把当时的缺口
直接视为当前代码状态。

本文是研究建议，不修改既有领域约束，不代表下面的计划已实现或指标已达标。研究阶段读取源码、测试、
`.scratch/` 与既有路线图，并核验官方资料。同期已落实的代码修改、Gradle 与 MCP 进程验证结果见
[本轮优化与验证记录](optimization-validation-2026-10-03.md)；未取得真实扫描器、性能基准或用户试用结果。

## 决策建议

下一阶段围绕一个交付目标推进：**对现有扫描报警给出可信、可重现、可人工确认的研判结果，
并证明它减少了审核时间。** 优先补齐评估分母、失败恢复和工具契约，再依据测量结果优化性能。
平台已有较完整的功能链路，继续增加扫描语言、动态验证或通用聊天入口，暂时难以回答产品是否有效。
这沿用 [CONTEXT 的产品主线](../../CONTEXT.md)，不是另立定位。

| 顺位 | 优先级 | 建议交付 | 完成后能回答的问题 |
|---|---|---|---|
| 1 | P0 | 固定标注集、失败覆盖率与版本对比报告 | 改动有没有降低危险误判，提升了多少有效覆盖？ |
| 2 | P0 | 跨存储删除/更新的一致性与故障重试闭环 | 失败、重启后，旧证据会不会继续参与研判？ |
| 3 | P0 | 外部工具能力、导入完整性和执行边界契约 | 工具是否真的分析了宣称的语言，报警是否被完整解释？ |
| 4 | P1 | 分阶段性能预算与受质量约束的优化 | 时间和内存花在哪里，优化有没有牺牲召回？ |
| 5 | P1 | 安全团队试用；通过后接入一个 CI 使用场景 | 用户是否更快作出正确决定，下一笔投入应放在哪里？ |

1、2、3 可并行准备；2、3 的阻断性错误先修。4 的埋点和基线可同步进行，但性能实现应由剖析决定。
5 的试用材料可以先准备，真实参与者招募与外部沟通仍由用户安排。

### 与本轮实现范围的关系

下表对应本轮已落实的修复方向；实际验证范围、通过及跳过数量以
[验证记录](optimization-validation-2026-10-03.md) 为准。它们不代表后续路线已完成。

| 本轮选定方向 | 要保住的行为 | 与下一阶段的衔接 |
|---|---|---|
| 索引扫描过滤误删与指纹时间窗口 | 被语言/排除规则过滤的文件不等于已删除；缓存指纹必须对应实际已处理内容 | 支撑第 2 条一致性计划，但不等于完整解决同文件旧符号替换 |
| 扫描 PARTIAL 状态与取消竞态 | 部分结果保留，部分失败明确；取消与启动/完成竞争时保持一致终态 | 支撑第 3 条工具事实契约与第 4 条有界并发 |
| MCP HTTP 超时与线程中断 | 下游迟滞能有界返回；中断状态不被吞掉 | 支撑完整进程/故障场景验证，不等于已完成 stdout 启动验证 |
| 测试夹具与依赖版本目录 | 迁移后的夹具真实被执行，版本有单一来源 | 提升第 1 条验证可信度，不把历史跳过项计入通过 |

调研时，同文件旧符号替换、入边保留与跨存储删除重试列为高优先后续工作；后续实现进度见文首链接。

## 已有事实与证据强度

以下为基线源码或仓库文档事实；文档中“已完成”只代表历史记录，未在本研究中重新验收。

| 事实 | 可核查来源 | 对本轮规划的含义 |
|---|---|---|
| 真实 Gradle 子项目只有 app 与 MCP；core/graph/vector 是 app 内包边界 | [settings](../../settings.gradle.kts)、[Architecture](../ARCHITECTURE.md) | 在现有边界内深化能力，避免为重构而拆模块 |
| 研判共享 `TriageWorkflow`；报告、模型意见、审核事实有独立归属 | [CONTEXT](../../CONTEXT.md)、[DefaultTriageWorkflow](../../repograph-app/src/main/java/com/repograph/finding/DefaultTriageWorkflow.java) | 评估应围绕同一流程比较，不能为不同入口复制一套判定 |
| PRD 标记 resolved；验证方法论 ready-for-agent；试用协议记录真实用户价值尚未验证 | [PRD](../../.scratch/codesec-triage-agent/PRD.md)、[验证方法论](../../.scratch/codesec-triage-agent/VALIDATION-METHODOLOGY.md)、[试用协议](../../.scratch/codesec-triage-agent/TRIAL-PROTOCOL.md) | 功能验收与商业假设验证必须分开；未领取新工单 |
| T11-1 规则注册/回归发布闸门已记录完成，T11-2 效果评估尚列待做 | [T11 拆分](t11-rule-intelligence-breakdown.md) | 建议把 T11-2 提前于 T11-3 格式导出，先证明效果 |
| 现有模型评估计算启发式准确率，以及模型成功子集的准确率、平均延迟和总成本 | [LlmAdvisoryEvaluator](../../repograph-app/src/main/java/com/repograph/advisory/LlmAdvisoryEvaluator.java) | 未同时报告模型失败/关闭/超时分母，不能只用成功子集准确率判断上线收益 |
| 检索基准有 Hit@K/MRR 与 65%/75% Hit@10 门槛；缺服务/语料会 assumption 跳过 | [CodeRetrievalBenchmark](../../repograph-app/src/test/java/com/repograph/benchmark/CodeRetrievalBenchmark.java)、[Validation](../VALIDATION.md) | 基准跳过不是质量达标；也不是研判准确率或生产延迟测量 |
| 启动恢复会终止遗留自动任务、保留证据和人工审核状态，不自动续跑 | [InterruptedTaskRecovery](../../repograph-app/src/main/java/com/repograph/app/config/InterruptedTaskRecovery.java)、[CONTEXT](../../CONTEXT.md) | 单进程恢复基线已存在；下一步应补存储副作用一致性，避免重复实现恢复框架 |
| 删除流程先删图，向量删除失败只 WARN，随后仍尝试删缓存 | [DefaultIndexStore](../../repograph-app/src/main/java/com/repograph/app/pipeline/DefaultIndexStore.java)、[DefaultIndexPipeline](../../repograph-app/src/main/java/com/repograph/app/pipeline/DefaultIndexPipeline.java) | 从控制流推断：文件已删除且图/缓存均清除时，后续增量扫描可能再也发现不了残留向量；需故障注入确认与修复 |
| 关键词检索取最多 5,000 个候选，在应用中遍历源码、评分、排序 | [SimpleKeywordSearchService](../../repograph-app/src/main/java/com/repograph/retrieval/SimpleKeywordSearchService.java) | 候选上限同时影响延迟和覆盖；未测量前不能声称它已是主要瓶颈 |
| CodeQL 适配器将 Java/Kotlin 都映射到 java-kotlin，统一传 build-mode none | [CodeQlScannerAdapter](../../repograph-app/src/main/java/com/repograph/scanner/CodeQlScannerAdapter.java) | 必须核对宣称支持的语言与工具实际分析范围 |

历史验证材料中，WebGoat 47 条筛选报警有 35 条输出 `TRUE_RISK`，这是**结论分布**。
缺少每条独立金标、完整抽样分母和混淆矩阵时，不能把 74% 解释成准确率、召回率或已证明的产品收益。
试用协议开头“证明研判逻辑正确”的措辞也应按这个证据限度理解。
旧文档中的测试数量、工具数量、运行参数和缺口清单可能已经漂移，实际验收应按
[Validation](../VALIDATION.md) 与当次 XML 报告执行。

## 1. P0：先建立可重现的可信评估

**建议范围。** 先交付机器可读结果与简短对比报告，再做 T11-2 看板。为每条样本冻结仓库 commit、
报警原文摘要/哈希、扫描器/规则版本、人工标签及理由、预期 citation；LLM 额外记录模型版本、
提示模板版本、设置、耗时和成本。标注与评测通过稳定样本 ID 关联，避免把运行状态变成新的领域事实源。

建议从至少 3 个独立仓库、60 条已裁决报警起步，包含至少 30 条真实风险和 30 条误报/防护反例，
覆盖当前目标 Java/Python 及常见 CWE。争议样本保留为“待裁决”，单独计数，不强行制作金标。
这个规模是第一轮工程验收建议，不足以证明生产泛化。按仓库拆分开发集与保留集，固定版本后再比较；
避免在同一批已用于修复的样本上不断调参并称其为独立验证。

**度量口径。** RepoGraph 接收已有报警，以下指标首先衡量“条件于已导入报警的研判质量”，
不能据此宣称扫描器发现整个仓库漏洞的召回率。

| 指标 | 明确分母与解释 |
|---|---|
| 危险降级率 | 金标真实风险中被判 `LIKELY_FALSE_POSITIVE` 的数量 / 所有金标真实风险；`NEEDS_REVIEW` 单列 |
| 风险结论精确率 | 判为 `TRUE_RISK` 且金标为真的数量 / 有金标的 `TRUE_RISK` 数量 |
| 有效决策覆盖率 | 有金标且给出非 `NEEDS_REVIEW` 结论的数量 / 全部有金标输入；与质量一起比较 |
| 模型可用率 | 模型成功给出合法建议的数量 / 所有被请求复核的样本；关闭、超时、失败分别列出 |
| 无上下文率 | 无有效定位/citation 的输入数量 / 全部有效输入；不把它们从总样本中消失 |
| citation 有效率 | 指向指定代码版本、正确文件与合法行号的引用数 / 所有输出引用数；不能只查 ID 在白名单中 |
| 运行代价 | 全部尝试的延迟分布、总耗时、token/成本；成功子集统计另列，不能忽略失败开销 |

分母为零时输出“不适用”，不要默认为 0% 或 100%。历史审核确认率与固定金标精确率分开展示，
因为用户更可能优先审核高风险报警，历史反馈存在选择偏差。

**外部依据。** OWASP Benchmark 为版本化用例提供预期真假标签，并区分 TP/FN/TN/FP；官方同时说明
其用例通常比真实应用简单。因此可用它补正负例与方法校验，仍需独立真实仓库样本。
[OWASP Benchmark](https://owasp.org/projects/benchmark?tab=scoring)（访问：2026-10-03）。

**验收建议。** 固定输入能重放得到逐条差异；任何新增“真实风险→可能误报”转移都阻断默认发布；
每次结果同时列总输入、有效输入、跳过/失败/待裁决数；保留集指标不下降，质量提升可追到具体样本。
模型的有效覆盖与危险降级率未优于或至少不劣于启发式基线前，保持辅助意见与人工最终判断的边界。
这只是固定样本上的回归门，不是“生产零漏报”保证。

**权衡。** 标注比增加规则慢，但能让后续每次优化被客观比较。先复用现有评估器和审核事实，
不要先建设新的分析数据库或复杂仪表盘。

## 2. P0：让跨存储失败保持可观察、可重试

**建议范围。** 延续“图→向量→成功后缓存”的现有写入顺序与单 app 所有权。第一片只补文件/项目
删除失败的可靠传播和重试资格；第二片根据故障矩阵决定是否引入 SQLite 操作台账，保存待完成删除、
各存储执行结果和重试次数。以 `(projectId, filePath, operationId)` 等内部标识实现幂等，
不为此随意增加 `CodeUnit` 字段。

运行恢复与数据修复是两件事：把运行标为 FAILED 解决“状态悬挂”，不能证明 Neo4j/Qdrant/缓存
已经一致。即使暂时采用失败即返回并保留重试资格，也要明确图可能已删、旧向量仍在，
不能把请求失败等同于回滚成功。资产源码的物理删除应晚于索引清理成功或可靠登记待清理工作。

同文件更新应另设垂直切片：方法改名、删除、签名变化或文件变空后，旧符号和向量不能继续召回；
仍存在的符号来自其他文件的有效入边应保留或可靠重建。单纯“先删整个文件再写新符号”会扩大
失败窗口并丢失入边，不能作为没有验证的快捷方案。先明确替换边界与删除重试，再决定暂存/代际机制。

**验收建议。** 使用独立项目与测试 collection，覆盖图成功/向量失败、向量成功/缓存失败、
进程在每个存储操作后中断、重复请求与重启重试；清理完成后，图查询、精确定位、向量召回均无旧单元。
同样操作重复两次结果一致，其他项目内容不变；有未完成清理时返回明确状态，不报告完整成功。
更新/删除竞争与重命名也进入验收，防止旧删除任务清掉新版本。

**权衡。** 顺序补偿和待处理台账比跨数据库事务简单，但需要可查询的积压与终态；生成代际切换
只有在量测证明部分更新可见性影响用户时再做。多实例租约、分布式队列、自动重放 Agent 输入不在此片范围。
依据：[现有一致性边界](../ARCHITECTURE.md)、[恢复策略](../../CONTEXT.md)、
[可靠性规则](../rules/RELIABILITY.md)。

## 3. P0：把外部工具与导入结果作为明确契约

**已核验的外部事实。** GitHub 官方资料列 Java 支持 none/autobuild/manual，Kotlin 仅支持
autobuild/manual；Java 的 none 模式仍可能调用 Gradle/Maven 查询依赖，且依赖猜测、生成代码会影响精度。
因此 `--build-mode=none` 本身不能证明“不执行任何仓库构建工具代码”。
[CodeQL build options](https://docs.github.com/en/code-security/reference/code-scanning/codeql/build-options-for-compiled-languages)
（访问：2026-10-03）。

**推断与待验证项。** 当前 Kotlin 能力声明与官方支持表不一致；应区分“扫描器命令运行成功”与
“目标语言实际被分析”。对于不可信归档，依赖查询可能触发仓库控制的配置逻辑，这是需要验证的
执行边界风险；本研究未运行真实 CodeQL，也未证明当前机器版本发生过该行为。
按 [Security](../rules/SECURITY.md) 保持既有禁止隐式构建的约束，用受控样本验证真实 CLI 的子进程、
文件写入和网络行为，选择已验证的依赖解析限制或隔离执行，不能用修改文档降低约束来消除冲突。

**控制方法核验结果。** 本次未找到官方文档保证“禁止 Java none 模式调用 Maven/Gradle”的具体开关，
本机也未安装可从 PATH 调用的 CodeQL，不能给出已验证的禁用参数。官方要求按部署版本运行
`codeql resolve extractor --language=java --format=betterjson` 查看 `extractor_options`，
再使用其实际声明的 `--extractor-option`；未知选项会报错。
[CodeQL extractor options](https://docs.github.com/en/code-security/reference/code-scanning/codeql/codeql-cli/extractor-options)
（访问：2026-10-03）。在找到并实测这样的控制之前，建议不可信 Java 归档只在独立受限 runner/容器
运行 CodeQL，或由 RepoGraph 导入外部生成的 SARIF；不要将关闭依赖缓存或名称相似的 buildless 参数
当成执行隔离。该建议是对现有安全约束的保守落实，不声称所有 CodeQL 版本都不存在相关内部选项。

**导入建议。** SARIF 输入需要区分“成功导入 N 条”与“整次扫描有效且完整”。当前
[SarifFindingImporter](../../repograph-app/src/main/java/com/repograph/finding/SarifFindingImporter.java)
直接读取位置 URI，未解析 `originalUriBaseIds`；
[ExternalFinding.fingerprint](../../repograph-app/src/main/java/com/repograph/core/finding/ExternalFinding.java)
由工具、规则、路径和起始行组成，代码前插一行就会改变身份。
增加批次诊断契约，明确输入数、保留数、无位置项、非法项、截断项、工具执行失败和未分析范围；
先保持旧指纹可用，再设计版本化别名/迁移，不直接改哈希令历史反馈失联。

SARIF 2.1.0 提供 `originalUriBaseIds`、`fingerprints`、`partialFingerprints` 和执行状态字段，
但这些字段是可选或需要消费者解释，不能当成一定存在的真值。
[OASIS SARIF 2.1.0 + Errata 01](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)
（访问：2026-10-03）。Semgrep 官方字段表区分 CE 与平台字段：错误/扫描路径可存在于 CE 输出，
而平台 fingerprint 等信息不保证在 CE 中可用；导入器应保留兼容降级路径。
[Semgrep JSON/SARIF fields](https://docs.semgrep.dev/semgrep-appsec-platform/json-and-sarif)
（访问：2026-10-03）。

**验收建议。** 纯 Kotlin、Java/Kotlin 混合仓库能明确显示已分析/未分析语言；扫描器故障不伪装成零报警；
多 run SARIF、不同 JSON 字段顺序、URI base、编码路径、缺可选位置、超限截断有 fixture；
对不能定位的合法输入给出诊断而非编造行号。旧指纹反馈仍可读，代码版本/规则版本不匹配仍不得自动套用。
不把多个独立 thread flow 的步骤拼接成一条已证明的 source→guard→sink 路径。

**权衡。** 完整实现 SARIF 规范成本高，先支持真实扫描器输出中出现的结构，并对其余结构明确报诊断。
当前官方已提供 C/C++ 的 none 模式，说明旧路线中的“必须构建”是会变化的外部事实；
这不构成本轮扩展语言的理由，能力仍须按部署的 CLI 版本验证。

## 4. P1：建立性能预算，再选择热点优化

**建议范围。** 先把一次任务分为排队、扫描文件、解析、图写入、Embedding、向量写入、上下文检索、
模型调用、快照持久化，记录耗时、数量、重试和峰值内存。指标标签使用阶段/能力/结果，
避免把任意文件路径、源码或报警内容作为监控标签。索引完整重建与增量重建分别记录。
依据：[索引管道](../../repograph-app/src/main/java/com/repograph/app/pipeline/DefaultIndexPipeline.java)、
[Embedding 执行](../../repograph-app/src/main/java/com/repograph/app/pipeline/EmbeddingUpsertRunner.java)。

| 场景 | 建议测量与初始预算；均非当前测得结果 |
|---|---|
| 固定语料、已完成索引、关闭 LLM 的单报警研判 | 预热后至少 100 次，记录 p50/p95/失败率；将既有“<30 秒”目标明确为 p95 <30 秒 |
| 冷索引与增量索引 | 固定硬件、模型/维度、语料 commit；记录文件/单元数、秒数、峰值堆、Embedding 请求数 |
| 无修改再次索引 | Embedding 调用数为 0；显式记录扫描/哈希成本，不把“0 变更”理解为“0 开销” |
| 关键词/GraphRAG | 使用 1千、1万、5万 CodeUnit 量级，报告召回与 p95；单独放置候选上限以外的目标 |
| 扫描器与模型同时运行 | 测并发 1/2/4 下排队、超时、线程/子进程数、内存；过载可拒绝或排队且终态可查 |

建议先设回归预算：固定环境下 p95 与峰值内存较基线增长超过 10% 时进入复核，
再按多次运行波动调整阈值。LLM 三分钟超时与启发式报告 30 秒预算分开，不能靠超时默认值定义性能达标。
统计方法与机器配置随结果保存；不为稳定分位数而把失败请求静默丢弃。

**候选优化。** 若关键词候选扫描被证实是热点，比较当前算法、精确符号索引与 SQLite FTS/BM25
适配器的质量/延迟/内存，不先扩大 5,000 上限；若图扩展为热点，优先批量查询与有界展开；
若 Embedding 为热点，比较签名/源码内容缓存、批次和并发配置。任何缓存必须包含模型、维度、
输入构造版本及内容指纹，模型变化时明确失效。若扫描器争用 CPU，先限制单进程线程预算，
不能只靠全局“最多几个扫描任务”限制总资源。

**验收建议。** 选中一个已测热点后，先约定收益门槛（例如该阶段 p95 降低 ≥20%），
同时要求固定回归集无新增危险降级、检索 Hit@K/MRR 不下降、取消/故障测试不退化。
未达到收益门槛就不引入额外持久缓存或复杂索引。上述收益值是建议目标，不是性能承诺。

## 5. P1：以安全研判试用决定产品扩展

**建议范围。** 执行已有 [TRIAL-PROTOCOL](../../.scratch/codesec-triage-agent/TRIAL-PROTOCOL.md)，
争取 3–5 位独立参与者，用他们自己的 Java/Python 仓库与报警进行审核时间对照。历史回忆耗时
与实际计时分开；同一人先读源码再看报告存在学习效应，采用等难度分组、交叉顺序，并保留分组说明。
最终标签尽可能由另一位复核者裁决，避免用模型结论自己给自己评分。

**验收建议。** 沿用试用协议的中位审核时间 ≤基线的 60%、至少 3/5 参与者认为明显省时、
citation 全部可定位，以及样本内无危险误判作为进入下一片的决策门。样本太少或标签有争议时
报告区间与个案，不能由三次正面反馈推导付费意愿或行业精度。

通过后只接入一个 CI 场景：上传已有 SARIF、生成可定位到 commit 的研判与冻结报告、
人工接受后回写摘要。先验证用户愿意持续使用，再扩展更多 SCM、自动补丁或动态验证。
M5 动态验证继续遵守现有试用协议的价值验证前置条件。

MCP 保持共享能力的另一个入口。若评估编码 Agent 场景，另设同仓库/同任务/同模型的配对试验，
比较任务完成率、正确定位、探索时间、token 与索引维护成本，不能把工具数量当成效用。
发布检查应启动完整 MCP 进程，验证初始化、工具调用和所有 stdout 行，而不只调用 dispatch；
stdio 只能输出 MCP 消息是协议要求。
[MCP transports（2025-06-18 固定规范版本）](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
（访问：2026-10-03）。这里引用固定版本的传输约束，不宣称它是当前最新协议版本。

## 架构深化候选

以下为建议，需由对应切片的反例与验证结果决定是否实现；接口放 core、实现放现有能力包，
不引入 core 第三方依赖或 graph→vector 依赖。

| 候选 | 要隐藏的变化与最小边界 | 收益、代价与启动条件 |
|---|---|---|
| 索引变更协调器 | 对外提交一次更新/删除并查询结果，内部持有图/向量/缓存进度和幂等策略 | 失败语义集中；需要台账和清理机制。先由跨存储故障回归证明必要性 |
| 批次导入结果契约 | 返回规范报警 + 导入诊断 + 来源/版本信息，隐藏 SARIF/Semgrep 差异 | 调用者能判断结果是否完整；要处理旧 API 兼容。不要让控制器直接读工具专有 JSON |
| 固定评估执行器 | 输入样本清单与配置，输出逐条结果、分母、聚合指标和版本差异 | 评估可重放；要维护金标。先做 CLI/测试入口，晚做看板 |
| 检索候选提供者 | 复用 core `KeywordSearchService`，把全量扫描或索引实现藏在适配器后 | 可以在不改 GraphRAG 编排的情况下比较策略；仅在热点与召回损失确认后引入索引 |
| 扫描执行策略 | 集中工具版本能力、资源预算、允许的执行方式与取消清理，工具 adapter 仍负责命令和结果 | 防止每个 adapter 重复决定边界；先收敛当前 CodeQL/Semgrep 契约，不先抽象通用工作流引擎 |

这些候选都应以“减少调用者必须知道的细节”为成功标准，避免只把长类拆成更多薄包装。
已有 `TriageWorkflow`、`IndexStore`、`ScannerAdapter` 是优先深化的接缝，不需要另建一套平台骨架。

## 本次输出与后续验收边界

本研究没有新增 `.scratch` 工单、修改其状态、同步 GitHub、联系参与者或部署任何服务。
后续计划进入实现时，先按 issue tracker/triage 规则确定可领取切片；本报告不是新的已批准 PRD。
工程验收分开记录编译、单元测试、真实服务集成、检索基准、运行态 stdout/UI 与试用结果，
每类都保留实际 passed/failed/skipped/未运行，不能用一次快速构建覆盖所有结论。
