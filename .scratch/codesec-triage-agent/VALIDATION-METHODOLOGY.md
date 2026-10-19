Status: ready-for-agent

# P0 报警解释器:真实样本验证方法论

> roadmap(`docs/generated/roadmap-codesec-triage-agent.md`)P0 的验证重点是"用户是否愿意用报告替代
> 人工初看"。必须拿有**已知、文档化的真实漏洞**的开源项目,逐条核对 `triage_finding` 的定位、可达性
> 判定和置信度。本文记录可复用的验证流程与已执行轮次的结论;2026-10-16 压缩历史叙事,保留方法、
> 修复事实与未验证缺口。逐条修复记录在 git 历史的 `.scratch/*/issues/NN-*.md`。

## 环境准备(一次性)

不依赖生产配置里的局域网 Ollama 时:

1. `ollama serve &`,`ollama pull nomic-embed-text`(768 维轻量模型,足够验证用)
2. 本地测试容器(不复用生产数据):
   ```bash
   docker run -d --name repograph-neo4j-test -p 7474:7474 -p 7687:7687 \
     -e NEO4J_AUTH=neo4j/neo4jneo4j neo4j:5
   docker run -d --name repograph-qdrant-test -p 16333:6333 -p 16334:6334 qdrant/qdrant:latest
   ```
3. `brew install semgrep`
4. 启动 repograph-app,用环境变量覆盖指向测试实例(不改 `application.yml`):
   ```bash
   REPOGRAPH_QDRANT_COLLECTION=code_units_test \
   REPOGRAPH_QDRANT_VECTOR_SIZE=768 \
   REPOGRAPH_OLLAMA_BASE_URL=http://localhost:11434 \
   REPOGRAPH_OLLAMA_MODEL=nomic-embed-text \
   java --enable-native-access=ALL-UNNAMED -jar repograph-app/build/libs/repograph-app-<version>.jar
   ```

## 每轮验证的执行步骤

1. **选目标项目**:优先选有已知漏洞清单(README/exercises/CVE 公告)的真实开源项目,规模递增,
   覆盖不同代码模式(见下表)。
2. **索引**:`POST /api/v1/index/project?projectRoot=...&lang=java`,轮询 status 到 `done`。
3. **扫描**:`semgrep --config=auto --json --output out.json <project>`。报警数超过 `maxFindings`
   上限(REST 端 50)时按规则去重保留代表性样本,不为塞进上限漏掉稀有规则类型。
4. **研判**:`POST /api/v1/triage/report?format=semgrep&projectId=...&maxFindings=...`。
5. **核对已知漏洞**(最关键,不能省):每个已知漏洞检查是否判 `TRUE_RISK`,不是则读 `reasons`
   看卡在哪一步;用 `find_callers`/`find_callees` 直接查图验证"未发现调用方"结论;怀疑是逻辑问题时
   读 `TriageReportService` 等源码定位到函数和行号,不停留在"报告不准"。
6. **记录+修复**:确认真实 bug 后按标准模板记录 issue,写回归测试,跑全量回归,重新验证同一批
   报警的判定变化(前后对比)。
7. **闭环**:对确认为真实漏洞的报警调用 `record_triage_feedback` 标 `TRUE_POSITIVE`,验证反馈回写链路。

## 目标项目选择策略

| 轮次 | 项目 | 规模 | 选它的原因 |
|---|---|---|---|
| 1 | [bbhunter/vulnado](https://github.com/bbhunter/vulnado) | 11 文件 | 小、漏洞路径单一,验证流程本身 |
| 2 | [JoyChou93/java-sec-code](https://github.com/JoyChou93/java-sec-code) | 80 文件 | 覆盖十余种 CWE,漏洞直接写在 Controller 入口点(区别于轮 1 模式) |
| 3 | [WebGoat/WebGoat](https://github.com/WebGoat/WebGoat) | 405 文件 | OWASP 官方靶场,压测解析/embedding 在大项目上的稳定性 |
| 4+ | 待定 | 更大 | 优先选大量使用接口/多态、依赖注入、框架回调接口的项目,压测已知缺口 |

## 已执行轮次结论(1–5 轮,均已闭环)

| # | 轮次 | 根因与修复 |
|---|---|---|
| 1 | vulnado | `JavaParseContext.resolveScope()` 不识别同包无 import 的静态调用 → 调用图断链;已修复 |
| 2 | java-sec-code | 可达性只看"仓库内调用方数量",入口点自身漏洞的真实调用方是外部 HTTP 请求 → `reachable = callers>0 \|\| isEntryPoint`;已修复 |
| 3 | WebGoat | embedding 阶段:注释边界 `indexOf` 不理解字符串字面量,payload 使标记重叠导致越界异常中断整个 embedding → 闭合标记搜索从 `start+2` 开始;已修复。修复后 WebGoat 47 条筛选报警 35 条 `TRUE_RISK`(74%),无新的系统性判定问题 |
| 4 | WebGoat(复用数据压测缺口) | 入口点检测只认注解,不认框架回调接口(`HandlerInterceptor#preHandle` 等) → `FRAMEWORK_CALLBACK_INTERFACES` + `@Override` 兜底;已修复。教训:下一轮该验证什么,有时答案就在已跑过的项目里,先查再换样本 |
| 5 | WebGoat(假设证伪) | "DI 构造无调用点"结构真实但 3 轮 100+ 报警零命中,确认低影响暂不修;顺深挖发现字段级报警永远拿不到可达性证据 → `hasEntryPointSibling` 补 `entry_point` 信号;已修复。教训:假设被证伪也是有效产出,验证中的深挖常带出更有价值的发现 |

## 已知但尚未验证/修复的缺口(下一轮重点核实)

1. ~~入口点识别不覆盖框架回调接口~~(轮 4 已修复)
2. ~~依赖注入构造的 bean 无显式调用点~~(轮 5 已核实:低影响,暂不修复;出现真实案例再评估)
3. **字段被非入口点方法读取时依然拿不到可达性证据**:轮 5 修复只处理"字段所属类托管入口点方法"
   的代理,未处理"字段被普通方法读取"——需要字段读取边才能精确覆盖,等有真实反例再评估。
4. **`resolveCall` 里 scope 非空但解析失败时的兜底**(`classStack.peek()`):只修了"scope 形如类名"
   子场景,其它子场景(如类型未知的局部变量)没验证过;遇到"该有调用方但没有"时优先怀疑这条路径。
5. `FRAMEWORK_CALLBACK_INTERFACES` 只覆盖 Spring MVC/Security + JAX-RS 常见回调接口,没覆盖
   MyBatis、gRPC 拦截器等,遇到新框架按同样模式扩充。
