# Discovery:研判层商业化与下一周期方向(2026-10-13)

> 状态:草案,待人工确认后固化。输入:[competitive-landscape-2026-10-13.md](../../docs/generated/competitive-landscape-2026-10-13.md)、
> [TRIAL-PROTOCOL](../codesec-triage-agent/TRIAL-PROTOCOL.md)(ready-for-outreach)、
> [roadmap](../../docs/generated/roadmap-codesec-triage-agent.md)、[DeepMap 设计借鉴](../../docs/generated/deepmap-design-borrow-2026-10-12.md)。
> 本文件对应 forgeflow:discovery 的产出;第 5 节的三条 ADR 为草案,批准后由 domain-modeling 同步 `CONTEXT.md`。

## 1. 要验证的问题

竞品调研把模糊的"接下来怎么开发"收敛为三个可验证问题:

| # | 问题 | 为什么现在是决策时机 |
|---|------|---------------------|
| Q1 | 企业安全团队是否愿意为**独立的多引擎报警研判层**单独部署/付费? | 调研证实五家 SAST 大厂均不开放此生态位(GitHub/Sonar/Semgrep/Snyk/DeepSource 全是垂直栈),但"没人做"也可能是"没人需要"——TRIAL-PROTOCOL 外联至今未执行,这是唯一能分辨两者的证据 |
| Q2 | **分层摘要(Wiki)** 是否应作为仓库智能层的第一入口? | DeepWiki 用 5 万+仓库验证了需求,但增量维护、citation-ready、agent+人双消费是四家共同空白;DeepMap S1 设计已就绪,机会窗口与 Greptile/Devin 补私有化的速度在赛跑 |
| Q3 | 是否需要为"编码前拦截"(Semgrep Guardian 式 hooks)在 roadmap 留位? | 竞争焦点已从"事后研判"前移到"编码时拦截";RepoGraph 目前只有事后闭环,但不做也可能是对的(差异化在研判深度而非拦截时点) |

## 2. 用户与痛点画像

| 画像 | 痛点(竞品信号佐证) | 对应能力 |
|------|---------------------|----------|
| 企业安全团队(2-10 人 AppSec) | 多引擎报警淹没;FP 裁决依赖个人经验不可沉淀;SaaS 垂直栈不接自家已有扫描器 | 多引擎导入 + 研判管道 + 版本化反馈/抑制/变体(Q1) |
| 私有内网研发组织 | 代码不出内网与 AI 能力冲突;云端产品需合同+credits($16K 起的 Sourcegraph、按 ACU 的 DeepWiki) | 本地优先 + 完全离线知识图谱(Q2) |
| 重度编码 Agent 用户/平台团队 | Agent 只见局部上下文;上下文成本高;缺行级溯源 | GraphRAG/Context Pack/分层摘要(Q2) |

## 3. 替代方案(为什么不是它们)

- **上 Semgrep Platform 全家桶**:研究证实其 Autotriage+Autofix 是最强闭环,但内置扫描器锁定、SaaS 形态、AI credits 计费——与"多引擎导入、本地优先、可审计反馈沉淀"的定位正交,不可替代。
- **自建脚本堆**(各团队现状):无图谱定位、无上下文组装、裁决不沉淀——正是 TRIAL-PROTOCOL 要对照的基线。
- **不做,继续堆功能**:调研显示短板在"验证缺失"而非"能力缺失";没有真实团队反馈,后续投入方向都是猜。

## 4. MVP 成功指标(合并外联,一份调研喂两个决策)

执行方式:将 TRIAL-PROTOCOL 外联与痛点问卷(见 [questionnaire.md](questionnaire.md))合并为一次触达;
目标 3~5 家,最少 2 家完成完整试用。**试用成功门(与 TRIAL-PROTOCOL 决策门对齐,量化口径以此为准):**

| 指标 | 门槛 | 数据来源 |
|------|------|----------|
| 研判采纳率 | 人工终审与系统研判结论一致 ≥60% | 审核队列 confirm/reject 对比 TriageReport verdict |
| 时间节省 | 单报警研判耗时 vs 现有流程自评节省 ≥50% | 问卷 Q7 + 试用访谈 |
| 反馈沉淀率 | ≥30% 的裁决产生结构化反馈/抑制(而非口头) | triage_feedback / suppressions 计数 |
| 付费/续用意向 | ≥1 家明确表达部署意向;0 家则 Q1 证伪 | 问卷 Q10 |
| 分层摘要需求信号 | ≥半数受访者认为"仓库→可增量维护摘要"能进入其日常工作流 | 问卷 Q5/Q6(Q2 证据) |

**证伪信号(触发转向而非坚持)**:Q1 证伪 → 仓库智能层(Q2)升为主线;Q2 无需求信号 → 分层摘要降为 backlog;两者都证伪 → 回到内置扫描精度与 RuleRegistry 情报方向。

## 5. ADR 草案(待批准后同步 CONTEXT.md 架构决策表)

| # | 决策 | 选择 | 理由(证据) | 状态 |
|---|------|------|-------------|------|
| ADR-D1 | 产品形态 | 坚持"多引擎报警导入 + 独立研判层"为近期主线,不自研内置扫描器全家桶 | 五家竞品全部垂直栈,独立研判层生态位空缺;自研扫描器与 Semgrep/CodeQL 竞争无胜算 | 待批准 |
| ADR-D2 | 仓库智能层切入 | 分层摘要以"增量维护 + 图谱事实直供 + agent/人双消费"为差异化切入(DeepMap S1 方向),不做一次性 DeepWiki 复刻 | DeepWiki 验证需求但增量缺失;Greptile KB 是 agent 消费变体;Sourcegraph Living Documentation 未落地 | 待批准 |
| ADR-D3 | 拦截时点 | 近期不做"编码前拦截"(Guardian 式 hooks);在 roadmap 远期留观察位 | 研判深度是当前差异化;拦截时点竞争由 Semgrep/Guardian 主导,资源应聚焦试用验证 | 待批准 |

## 6. 下一步(执行序列)

1. 人工:批准/修订第 5 节 ADR 草案 → domain-modeling 同步 `CONTEXT.md`。
2. 人工:按 [questionnaire.md](questionnaire.md) 外联 3~5 家(邮件/社区/现有联系人)。
3. Agent:回收答案后跑 decision-forge 收敛 → 更新 roadmap 排序(T11-2 与 DeepMap S1 的先后由 Q2 证据定)。
4. 试用期间:T11-2 效果评估 + T9 遗留照常推进(工单已就绪),为试用提供数据支撑。
