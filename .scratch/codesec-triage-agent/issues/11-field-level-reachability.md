Status: resolved

# 字段级报警（硬编码密钥/弱随机种子）无法获得可达性证据

## 背景

第五轮验证的目标是压测第 2 轮遗留的另一个缺口："依赖注入构造的 bean 无显式调用点"
（`HijackSessionAuthenticationProvider` 的构造方法 `find_callers` 为空）。

先做了系统性核实：3 轮真实样本合计 100+ 条报警里，**没有一条**报警的位置落在构造方法上——
CWE 规则（SQLi/RCE/XSS/反序列化等）几乎都命中方法体，不命中构造方法签名。而且字段的
声明类型解析（`fieldTypeMap`）完全独立于该类是靠 `new` 构造还是靠 DI 反射构造，`someService.foo()`
这类调用的解析不受影响。**结论：这个缺口结构上真实存在（`find_callers` 对 DI bean 构造方法
确实返回空），但目前对研判结果的实际影响为零**，不需要现在修。

顺着这条线深入排查时，发现了一个相关但更常见、影响更大的问题：**字段级报警**。WebGoat 里
`弱随机种子` 类规则常年命中字段而不是方法（`ImageServlet.PINCODE`、
`HijackSessionAuthenticationProvider.id`、`JWTSecretKeyEndpoint.JWT_SECRET`），这三条报警
分别是 `LIKELY_FALSE_POSITIVE`/`LIKELY_FALSE_POSITIVE`/`NEEDS_REVIEW`——但 `JWT_SECRET`
明明是一个直接参与 JWT 签发（`@RestController` 里 `/JWT/secret/gettoken` 端点）的硬编码
弱密钥，是真实高危问题。

## 根因

`TriageReportService` 的 `callers` 完全基于 CALLS 边统计。**FIELD 单元从不参与 CALLS 边**
（只有 METHOD/CONSTRUCTOR 之间才有调用关系），所以字段级报警的 `callers` 永远是 0；
入口点标记（`is_entry_point`）目前只打在类/方法级别的声明节点上，不会传播给同一个类里的
兄弟字段。两者叠加导致：字段级报警既拿不到 CALLER 证据，也拿不到 entry_point 信号，无论
字段本身对安全有多关键，都会被系统性低估。

## 修复

`FindingContextService.build()`：定位到的单元是 FIELD 且尚未带 `entry_point` 信号时，
查询该字段所属类（`parentQualifiedName`）是否托管至少一个框架入口点方法（复用已有的
`GraphQueryService.findEntryPoints`，按 `parentQualifiedName` 匹配），命中则给这条 FINDING
证据补上 `entry_point` 信号——直接复用第 4 轮已经建立的 `reachable = callers>0 || isEntryPoint`
机制，不需要改 `TriageReportService` 本身。

## 验收标准

- [x] 系统性核实"DI 构造无调用点"缺口：确认结构性存在但 3 轮 100+ 报警零命中，记录结论但不修复
- [x] 真实样本定位到字段级可达性缺口的三个反例（`ImageServlet.PINCODE`、
      `HijackSessionAuthenticationProvider.id`、`JWTSecretKeyEndpoint.JWT_SECRET`）
- [x] 新增单测 `build_fieldLocation_markedReachableWhenEnclosingClassHostsEntryPoint` /
      `build_fieldLocation_notMarkedReachableWhenNoEntryPointInEnclosingClass`
      （`repograph-app/src/test/java/com/repograph/finding/FindingContextServiceTest.java`）
- [x] `./gradlew :repograph-app:test` 全量回归通过
- [x] 重跑 WebGoat 同一批 47 条报警：3 条字段级报警精确升级
      （`LIKELY_FALSE_POSITIVE→TRUE_RISK` ×2、`NEEDS_REVIEW→TRUE_RISK` ×1），其余 44 条逐条比对
      verdict 不变；java-sec-code 45 条报警 0 变化；确认无副作用

## 完成记录

- `FindingContextService` 新增 `hasEntryPointSibling`，FIELD 单元命中时补充 `entry_point` 信号
- 新增两条回归测试（命中 / 不命中两种路径）
- 用 WebGoat 端到端复测，逐条 diff 确认只有预期的 3 条报警变化

## 相关但本次未处理（记录，供后续参考）

- "DI 构造的 bean 无显式调用点"这个缺口本身确认真实存在但影响面为零，不建议现在投入修复；
  如果以后某个真实项目里出现"报警命中构造方法本身"的案例，再回来处理。
- 本次只处理了"字段属于托管入口点的类"这一种可达性代理，没有处理"字段被非入口点的普通方法
  读取"这种情况（比如一个内部 service 类的字段，被同项目里另一个类的普通方法读取）——这类
  情况目前依然会因为拿不到 CALLER 证据而被低估，需要真正的"字段读取边"才能精确覆盖，
  是比这次修复更大的工程量，留给以后有真实反例时再评估。
