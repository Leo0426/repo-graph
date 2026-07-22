Status: ready-for-agent

# P0 报警解释器：真实样本验证方法论

## 目标

roadmap（`docs/generated/roadmap-codesec-triage-agent.md`）P0 阶段的验证重点是："用户是否愿意用报告
替代人工初看"。光看"报告能不能生成"不能回答这个问题——必须拿有**已知、文档化的真实漏洞**的开源项目，
逐条核对 `triage_finding` 的定位、可达性判定和置信度是否合理，才能真正验证研判质量。

这份文档记录可复用的验证流程，以及跑过的每一轮验证发现了什么、修了什么。后续找新项目验证时，
按这个流程走一遍即可；新发现的问题按下面的模板追加记录。

## 环境准备（一次性）

不依赖生产配置里的局域网 Ollama（`192.168.4.113:11434`，如果不可达）：

1. `brew install ollama`，`ollama serve &`，`ollama pull nomic-embed-text`（274MB，768 维，
   轻量替代生产用的 `manutic/nomic-embed-code` 7.5GB/3584 维模型，足够验证用）
2. 本地测试用 Neo4j + Qdrant 容器（不复用生产数据）：
   ```bash
   docker run -d --name repograph-neo4j-test -p 7474:7474 -p 7687:7687 \
     -e NEO4J_AUTH=neo4j/neo4jneo4j neo4j:5
   docker run -d --name repograph-qdrant-test -p 16333:6333 -p 16334:6334 qdrant/qdrant:latest
   ```
3. `brew install semgrep`
4. 启动 repograph-app，用环境变量覆盖指向测试实例（不改 `application.yml`）：
   ```bash
   REPOGRAPH_QDRANT_COLLECTION=code_units_test \
   REPOGRAPH_QDRANT_VECTOR_SIZE=768 \
   REPOGRAPH_OLLAMA_BASE_URL=http://localhost:11434 \
   REPOGRAPH_OLLAMA_MODEL=nomic-embed-text \
   java --enable-preview --enable-native-access=ALL-UNNAMED \
     -jar repograph-app/build/libs/repograph-app-<version>.jar serve
   ```

## 每轮验证的执行步骤

1. **选目标项目**：优先选有已知漏洞清单（README/exercises/CVE 公告）的真实开源项目，规模从小到大
   递增，覆盖不同代码模式（见"目标项目选择策略"）。
2. **索引**：`POST /api/v1/index/project?projectRoot=...&lang=java`，轮询
   `GET /api/v1/index/project/status` 到 `done`。
3. **扫描**：`semgrep --config=auto --json --output out.json <project>`。报警数超过
   `maxFindings` 上限（REST 端 50）时，按规则去重/限流保留代表性样本，不要为了塞进上限而漏掉
   稀有规则类型。
4. **研判**：`POST /api/v1/triage/report?format=semgrep&projectId=...&maxFindings=...`，
   body 为 semgrep JSON。
5. **核对已知漏洞**（最关键的一步，不能省）：
   - 对项目文档里明确标注的每个已知漏洞，检查对应报警是否被 `triage_finding` 判成
     `TRUE_RISK`；如果不是，读 `reasons` 字段看卡在哪一步。
   - 用 `find_callers`/`find_callees` 直接查图，验证"未发现调用方"这类结论是否符合代码事实。
   - 怀疑是逻辑问题而非个例时，去读 `TriageReportService`/`JavaParseContext` 等相关源码，
     定位到具体函数和行号，不要只停留在"报告不准"的表面结论。
6. **记录+修复**：确认是真实 bug 后，在 `.scratch/<feature-slug>/issues/NN-*.md` 按标准模板
   （背景/根因/修复/验收标准/完成记录）记录，写回归测试，跑 `./gradlew :repograph-app:test` 全量
   回归，重新验证同一批报警的判定变化（前后对比表）。
7. **闭环**：对确认为真实漏洞的报警调用 `record_triage_feedback` 标 `TRUE_POSITIVE`，验证反馈
   回写链路本身也是通的。

## 目标项目选择策略

按"能暴露不同代码模式"递进选择，而不是随便挑：

| 轮次 | 项目 | 规模 | 选它的原因 |
|---|---|---|---|
| 1 | [bbhunter/vulnado](https://github.com/bbhunter/vulnado) | 11 文件 | 小、漏洞路径单一，适合验证流程本身能不能跑通 |
| 2 | [JoyChou93/java-sec-code](https://github.com/JoyChou93/java-sec-code) | 80 文件 | 覆盖十余种 CWE，且漏洞大多直接写在 Controller 入口点方法里（区别于第 1 轮"入口点调用到别处"的模式） |
| 3 | [WebGoat/WebGoat](https://github.com/WebGoat/WebGoat) | 405 文件 | 规模再上一个量级（测试解析/embedding 在大项目上的稳定性），OWASP 官方漏洞教学靶场，覆盖面广 |
| 4+ | 待定，见"下一轮候选" | 更大 | 优先选会大量使用接口/多态、依赖注入、框架回调接口（非注解式入口）的项目，专门压测已知的两个覆盖缺口（第 3 轮没有专门命中这两个缺口） |

## 已发现问题清单（滚动更新）

| # | 轮次 | 现象 | 根因 | 状态 | 记录位置 |
|---|---|---|---|---|---|
| 1 | vulnado | 已知 RCE/SQLi 被判 NEEDS_REVIEW（"未发现调用方"），但源码明显有调用方 | `JavaParseContext.resolveScope()` 不识别同包无 import 的静态调用，解析失败后误归到调用方自己的类，调用图断链 | 已修复 | `.scratch/java-call-resolution/issues/01-same-package-static-call-not-resolved.md` |
| 2 | java-sec-code | 45 条报警 41 条卡 NEEDS_REVIEW，只有 1 条 TRUE_RISK，但大多命中已知真实漏洞 | `TriageReportService` 把"仓库内调用方数量"当唯一可达性证据；漏洞若就在入口点方法自身，其真正调用方是外部 HTTP 请求，天然不在仓库调用图里 | 已修复（`reachable = callers>0 \|\| isEntryPoint`） | `.scratch/codesec-triage-agent/issues/08-entry-point-reachability.md` |
| 3 | WebGoat | 索引在 embedding 阶段永久卡死在 pct=5，反复轮询不再变化 | `EmbeddingUpsertRunner.extractDocSummary()` 用纯文本 `indexOf` 找注释边界，不理解字符串字面量；SQL 注入测试用例里的 payload 字符串（含 `/**/*/**/`）让开闭标记重叠，`substring(start+2, end)` 越界抛异常，同步循环里未捕获直接中断整个 embedding 阶段 | 已修复（闭合标记搜索从 `start+2` 开始） | `.scratch/codesec-triage-agent/issues/09-doc-summary-crash-on-comment-like-string-literals.md` |
| 4 | WebGoat（同一份数据，针对性核实缺口） | `HandlerInterceptor#preHandle`/`AuthenticationProvider#authenticate` 等框架回调接口方法无 `is_entry_point`、`find_callers` 为空，本应可达的框架直调方法被当成完全不可达 | 入口点检测（`ENTRY_POINT_ANNOTATIONS`）只认注解式入口，不认"实现框架回调接口"这类入口 | 已修复（`FRAMEWORK_CALLBACK_INTERFACES` + `@Override` 兜底判断） | `.scratch/codesec-triage-agent/issues/10-framework-callback-interface-entry-point.md` |

**第 3 轮的正向信号**：修复问题 #3 后重新索引，WebGoat 47 条筛选后的报警里 35 条判 `TRUE_RISK`
（74%），其余 9 条 `NEEDS_REVIEW`（逐条核实：大多是命中"参数化查询"防护候选后的合理保守判断）、
3 条 `LIKELY_FALSE_POSITIVE`（无安全信号且无调用方的常量字段）——没有再出现新的系统性判定问题。
说明前两轮修复的可达性逻辑在更大、更复杂的项目上依然成立，不是只对小样本凑效的局部修补。
本轮筛选出的报警集合恰好没有命中下面两个已知缺口（框架回调接口入口、DI 构造的 bean），
不代表这两个缺口不存在，只是这次样本没触发，仍需专门找会命中它们的代码模式验证。

## 第 4 轮：不换新项目，针对性压测已知缺口

第 4 轮没有另外找新项目——直接复用第 3 轮已索引的 WebGoat 数据，因为它本身就含有真实的
`HandlerInterceptor`/`AuthenticationProvider` 实现类，正好是缺口 1 的现成反例，没必要为了
"找一个用接口/DI 的项目"重新克隆索引一遍。用 `lookup_symbol`/`find_callers` 直接核实
`UserInterceptor#preHandle` 无 `is_entry_point`、无调用方，确认缺口 1 成立后修复
（见上表 #4）。这说明"下一轮该验证什么"有时候答案就在已经跑过的项目里，先查再决定要不要
换新样本。

## 已知但尚未验证/修复的缺口（下一轮重点核实）

1. ~~入口点识别不覆盖框架回调接口~~ ——第 4 轮已修复，见上表 #4。
2. **依赖注入构造的 bean 无显式调用点**：Spring 容器反射创建的 bean，构造方法在源码里没有
   `new X()` 调用点，`find_callers` 显示"无调用方"，即便实际会被框架实例化。已确认反例：
   `HijackSessionAuthenticationProvider`（`@Component`）构造方法 `find_callers` 为空
   （见 issue 10），下一轮可以直接从这个类开始验证。
3. **`resolveCall` 里 scope 非空但解析失败时的兜底**（`classStack.peek()`）：只修了
   "scope 形如类名"这一种子场景（问题 #1 的根因），其它子场景（如类型未知的局部变量）没验证过，
   遇到"该有调用方但没有"时优先怀疑这条路径。
4. `FRAMEWORK_CALLBACK_INTERFACES` 目前只覆盖 Spring MVC/Security + JAX-RS 常见回调接口，
   没覆盖 MyBatis、gRPC 拦截器等其他框架，遇到新框架按同样模式扩充。

## 给 GitHub Issue 的建议拆分

如果要把这份文档拆成 issue 提交，建议：
- 一个 "方法论/流程" issue：本文档的"环境准备"+"执行步骤"+"目标项目选择策略"部分，作为团队协作的
  操作手册。
- 每个已发现问题单独一个 issue（可直接摘录上面"已发现问题清单"对应的 `.scratch/.../issues/NN-*.md`
  内容），保留"背景/根因/修复/验收标准"结构，方便追溯。
- "已知但尚未验证的缺口"部分可以合并成一个 "下一轮验证 TODO" issue，或者留在本文档滚动更新，
  等真正验证到再拆分成独立 issue（避免记录一堆没验证过的猜测）。
