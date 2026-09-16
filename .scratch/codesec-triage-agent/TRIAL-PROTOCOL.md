Status: ready-for-outreach

# P0 商业假设验证：真实安全团队试用协议

## 这份文档解决什么

`VALIDATION-METHODOLOGY.md` 已经用 5 轮真实靶场证明了**研判逻辑正确**（WebGoat 47 条筛选后报警
74% 判 `TRUE_RISK`，无新的系统性判定问题）。但那验证的是"准不准"，不是"有没有人愿意买单"。

roadmap（`docs/generated/roadmap-codesec-triage-agent.md`）P0 的验证重点原文是"用户是否愿意用
报告替代人工初看"，核心假设表第一行是"安全团队愿意为减少 SAST 报警研判时间付费"。这条假设至今
**没有被任何真实用户验证过**。在它被验证前，M5 动态验证（T7/T8）不启动（见记忆 `validate-before-m5`）。

这份文档把"交给安全团队试用"拆成可执行步骤：找谁、给什么、量什么、什么结果算通过。

## 试用对象画像

有效试用参与者必须同时满足：

| 条件 | 为什么 |
|---|---|
| 日常处理 SAST/SCA 报警（AppSec 工程师 / 安全运营 / 安全负责人） | 只有他们能判断"是否省了研判时间" |
| 团队当前有**在跑的** SAST 工具（Semgrep / CodeQL / SonarQube / Fortify / Checkmarx 任一） | 试用输入必须是他们的真实报警，不是我们的 showcase |
| 有一个 Java 或 Python 仓库可以本地索引（可以是内部小服务，不必是核心系统） | 当前能力聚焦 Java/Python；C 支持较弱 |
| 愿意投入 1 次 60–90 分钟的引导会话 + 会后一个 5 分钟问卷 | 低于这个投入拿不到有效信号 |

**目标数量**：3–5 个独立参与者（对齐 roadmap 成功指标"试用用户认为节省研判时间 ≥ 3/5"）。
不同组织优先于同组织多人。

## 试用输入（参与者提供）

1. 一个 Java/Python 仓库的只读访问或本地副本。
2. 该仓库最近一次 SAST 扫描的原始结果 JSON（Semgrep `--json` / CodeQL SARIF / 其它工具的 SARIF 导出）。
   - 报警数 > 50 时，按规则类型去重取代表性子集（保留稀有规则），不为凑上限漏掉规则类型。
3. 如果这批报警他们**已经人工研判过**，请他们带上当时的结论（真漏洞 / 误报 / 待确认）和大致耗时——
   这是最理想的对照基线，省掉现场盲筛。

## 环境（我方在参与者环境内部署，或参与者自建）

数据不出域是硬约束也是卖点：Neo4j / Qdrant / Ollama / repograph-app 全部本地容器，源码和索引
不离开参与者的机器。部署步骤见 `README.md`「前置依赖」+「快速上手」，验证用轻量 embedding 配置见
`VALIDATION-METHODOLOGY.md`「环境准备」。

会话前我方预先完成：起容器 → 建仓库索引到 `done` → 冒烟跑一条报警确认链路通。
参与者会话中只看研判结果，不看部署过程。

## 对照方法

**A/B 同批报警，测两件事：耗时 和 结论一致性。**

- **基线（人工初筛）**：
  - 若参与者已有历史研判结论 → 直接用，记录他们回忆的耗时。
  - 若没有 → 会话开始时让参与者对随机抽取的 8–10 条报警按平时方式初筛（只看报警 + 跳到代码），
    掐表记录每条耗时和结论。
- **处理组（RepoGraph 研判报告）**：对**同一批**报警调用
  `POST /api/v1/triage/report?format=<tool>&projectId=<id>`，把生成的 Markdown 报告给参与者，
  让他们基于报告给出结论 + 判断"这份报告能不能替代我刚才那一步"，掐表记录阅读+决策耗时。
- 顺序做一半正序一半反序（先人工后报告 / 先报告后人工），降低学习效应偏差。

## 度量指标与通过阈值

| 指标 | 口径 | 通过阈值 | 对应 roadmap |
|---|---|---|---:|
| 主观"省时间" | 会后问卷："这份报告能替代或显著缩短你的人工初筛吗？"（是/部分/否） | ≥ 3/5 参与者答"是" | 成功指标行 4 |
| 单报警研判耗时 | 处理组 vs 基线的中位耗时 | 处理组 ≤ 基线 × 0.6 | 核心假设"减少研判时间" |
| 结论一致性 | 处理组结论 vs 参与者最终确认结论（会后复核） | ≥ 80% 一致，且**零**"报告说安全但实际是真漏洞" | 风险"误报判断不可信" |
| 证据可用性 | 报告里的 citation / 调用路径能否点到真实代码位置 | 100% 可定位 | 成功指标行 2 |
| 报告生成耗时 | 单条报警 API 响应 | < 30 秒 | 成功指标行 1 |
| 主动追问 | 会话结束时是否主动问"能不能接我们 CI / 多久能用上" | 记录，不设阈值（强买单信号） | 核心假设"愿意付费" |

## 60–90 分钟会话脚本

1. （5 min）背景：你们现在一条 SAST 报警从看到到下结论大概多久？一周多少条？最烦的是哪一步？
2. （15 min）基线初筛：8–10 条报警，平时方式，掐表。（有历史结论则跳过，改为快速回顾）
3. （20 min）给报告，同批报警，参与者边看边出声（think-aloud），掐表，记录他们信 / 不信哪部分。
4. （10 min）挑 2 条参与者和报告结论不一致的，一起看代码定论，记录谁对。
5. （10 min）开放问题：哪部分最有用？哪部分是噪音？会用它替代现在的哪一步？还差什么才敢在团队推？
6. （5 min）问卷 + 下一步意向（愿不愿意用更大的仓库再跑一轮 / 引荐同事）。

## 决策门

- **继续投入 + 解锁 M5 排序**：≥ 3/5 答"省时间" **且** 结论一致性达标 **且** 至少 1 人主动问集成/上线。
  → 说明痛点真实、方案可信，可以开始建 P2（CI/PR 集成）和评估 M5。
- **方案对但入口错**：参与者认可报告质量，但都说"我们报警量没大到需要这个" / "我们更缺修复不缺研判"。
  → 不加功能，转向验证 P3（修复闭环）或"面向编码 Agent 的代码仓库智能层"那条线。
- **报告不可信**：出现"报告说安全但是真漏洞"，或一致性 < 60%。
  → 回到 `VALIDATION-METHODOLOGY.md` 的技术验证循环，补齐暴露的判定缺口，暂停商业推广。
- **无人愿意试**：联系了 5+ 符合画像的人都不愿投入 60 分钟。
  → 痛点强度可能不足以支撑产品，回到 discovery，重新审视目标用户。

## 一页纸 pitch（外联用）

> 你们的 SAST（Semgrep / CodeQL / …）每周产出几十上百条报警，大部分时间花在"这条是不是误报、
> 能不能被触发"的人工初筛上。RepoGraph 接在扫描器之后：对每条报警自动组装调用链、source→sink
> 路径、已有防护识别和代码 citation，输出一份可直接复制给研发的 Markdown 研判报告，给出
> 真漏洞 / 误报 / 需人工确认的结论和依据。
>
> 全本地部署，源码和索引不出你们的环境。想请你花 60 分钟，用你们真实的一个 Java/Python 仓库
> 和一批真实报警跑一遍，我们一起量一下它能替代人工初筛的哪一步、省多少时间。

## 每次会话记录模板

```
## 参与者 NN — <角色> @ <组织类型/规模> — <日期>

现状：报警量 __/周，单条研判耗时 __，最痛的一步 __
仓库：<语言> <大致规模> 索引耗时 __
报警批次：<工具> 原始 __ 条 → 抽样 __ 条，覆盖规则类型 __

| 报警 | 基线耗时/结论 | 报告耗时/结论 | 复核定论 | 一致? |
|---|---|---|---|---|
| ... | | | | |

主观省时间：是 / 部分 / 否
最有用：
是噪音：
推团队还差：
主动追问集成/上线：有 / 无 —— 原话：
问卷分数（省研判时间 1–5）：
```

## 操作者 runbook（会话前 + 会话中）

Agent 作战台的 SAST TRIAGE 面板有「从漏洞中心选择」和「导入外部报警」两种输入模式。试用用后者：
选项目 → 切「导入外部报警」→ 粘贴或选择参与者的 Semgrep/SARIF JSON → 执行研判 → 运行时间线 +
`report-snapshot` 的 MARKDOWN / JSON / PDF 导出。下面的 curl 只作为无头（headless）备选保留。

### 会话前（操作者，约 20–40 分钟，取决于仓库大小）

```bash
# 1. 起依赖（compose 把 Qdrant 映射到 16333/16334，Neo4j 7687）
docker compose up -d
ollama serve &            # 另起终端；ollama pull nomic-embed-text（验证用轻量模型）

# 2. 构建 + 启动 app（JDK 25，指向轻量 embedding，不改 application.yml）
./gradlew :repograph-app:bootJar -x test
REPOGRAPH_QDRANT_COLLECTION=code_units_trial \
REPOGRAPH_QDRANT_VECTOR_SIZE=768 \
REPOGRAPH_OLLAMA_MODEL=nomic-embed-text \
java --enable-native-access=ALL-UNNAMED -jar repograph-app/build/libs/repograph-app-*.jar &

# 3. 索引参与者仓库（projectRoot/lang 是 query param，不是 JSON body），轮询到 done
REPO=/abs/path/to/participant-repo
curl -X POST -G "http://localhost:8080/api/v1/index/project" \
  --data-urlencode "projectRoot=$REPO" --data-urlencode "lang=java"   # -G 把参数拼进 query，-X POST 保持方法
curl -sG "http://localhost:8080/api/v1/index/project/status" \
  --data-urlencode "projectRoot=$REPO" | jq .
#   → status 到 done 后，GET /api/v1/projects 查这个 root 对应的 projectId

# 4. 冒烟：拿参与者报警 JSON 跑一条，确认链路通
curl -X POST "http://localhost:8080/api/v1/triage/report?format=semgrep&projectId=<ID>&maxFindings=1" \
  -H 'Content-Type: application/json' --data-binary @participant-findings.json | jq '.[0].report'
```

### 会话中（UI，给参与者看的报告）

1. 打开 `http://localhost:8080` → 左侧「Agent 作战台」。
2. 顶部选参与者项目 → 输入模式切「导入外部报警」。
3. 选「报警格式」（`semgrep` = Semgrep `--json`；`sarif` = CodeQL 及其它工具的 SARIF 导出），
   粘贴 JSON 或点「选择文件」。状态条显示 `SEMGREP · N 条报警 · 本次处理 M 条`（M 上限见「最多处理」，
   REST 端硬上限 50）。
4. 「执行研判」→ 右侧运行栏出现新 run，时间线逐步展开（定位 → 证据组装 → 研判 → 待审核）。
5. run 完成后出现 `report-snapshot`，点 **MARKDOWN** 导出把逐条研判报告给参与者看
   （JSON / PDF 同一处）。

无头备选（无 UI 时）：

```bash
curl -X POST "http://localhost:8080/api/v1/triage/report?format=semgrep&projectId=<ID>&maxFindings=10" \
  -H 'Content-Type: application/json' --data-binary @participant-findings.json > trial-reports.json
jq -r '.[].report' trial-reports.json      # 逐条 Markdown
```

会话结束后按上面「每次会话记录模板」填一份，5 份填完对照「决策门」分流。

## 与既有文档的关系

- 技术正确性验证循环 → `VALIDATION-METHODOLOGY.md`（不变，本文档不替代它）。
- 产品范围与假设 → `PRD.md` / `roadmap-codesec-triage-agent.md`。
- 本文档只覆盖"把已跑通的静态研判闭环交给真实安全团队、以省时间为口径判断"这一步，
  结果按上面「决策门」分流。这是低成本可反转的排序决策，**不写 ADR、不动 CONTEXT**。
