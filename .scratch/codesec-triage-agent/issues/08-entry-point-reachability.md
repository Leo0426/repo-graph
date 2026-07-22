Status: resolved

# 入口点自身漏洞被系统性压低为 NEEDS_REVIEW

## 背景

用第二个真实开源项目（[JoyChou93/java-sec-code](https://github.com/JoyChou93/java-sec-code)，
80 文件/6350 行，覆盖 SQLi/RCE/XXE/反序列化/SSRF/SpEL 注入等十余种真实 CWE 漏洞）跑 P0 报警解释器
端到端验证时发现：45 条筛选后的报警里 41 条都是 `NEEDS_REVIEW 0.5`，只有 1 条 `TRUE_RISK`——
而这些报警绝大多数命中的是项目 README 里明确标注的已知真实漏洞（`SQLI.java`、`Rce.java`、
`CommandInject.java`、`XXE.java` 等 Controller 里的漏洞方法本身）。

## 根因

`TriageReportService.build()`（`repograph-app/src/main/java/com/repograph/finding/TriageReportService.java`）
把"仓库内调用方数量（`callers`，来自 Context Pack 里 `relation=CALLER` 的证据）"当作唯一的可达性证据。

但报警命中的往往就是 Spring `@RequestMapping` Controller 方法**自身**——它的真正调用方是外部 HTTP
请求，**天然不可能**出现在仓库内的调用图里。`callers` 对入口点方法几乎恒为 0，导致原逻辑
（`!signals.isEmpty() && callers > 0` 才判 `TRUE_RISK`，否则退到 `NEEDS_REVIEW`）把几乎所有
"漏洞就在入口点方法本身"的真实高危漏洞都压到了 `NEEDS_REVIEW 0.5`——恰恰是 Web 应用里最常见、
最该被准确识别的一类报警。

对比上一次验证（vulnado 的调用图断链 bug，见 `.scratch/java-call-resolution/issues/01-...`）：
那次是"调用链存在但没连上"，这次是"调用链本来就不存在于仓库内、但代码本身就是入口"——是两个不同的
根因，凑巧都表现为"调用图给的可达性证据不足"。

## 修复

`signals` 列表本身已经包含 `"entry_point"` 标记（`SecurityAwareReranker` 对 `is_entry_point=true`
的单元打的标签）。修复：把"是入口点"也当作一种独立于"仓库内调用方"的可达性证据：

```java
boolean isEntryPoint = signals.contains("entry_point");
boolean reachable = callers > 0 || isEntryPoint;
```

把原本所有 `callers > 0` 的判断分支改为 `reachable`，理由文案区分"发现 N 个调用方"和
"定位单元本身是框架识别的入口点，视为可从外部请求直接触达"两种情况。`TRUE_RISK` 的置信度公式
未改动（`0.5 + 0.1*signals.size() + 0.05*callers`）——纯入口点可达（callers=0）时置信度天然略低于
有实际多跳调用链验证的情况，不需要额外常数。

## 验收标准

- [x] 真实样本复现：java-sec-code 里 `CommandInject`/`SQLI`/`Rce`/`XXE` 等入口点自身漏洞
      修复前全部卡在 `NEEDS_REVIEW 0.5`
- [x] 新增单测 `build_trueRiskWhenEntryPointHasSignalsButNoCallers`
      （`repograph-app/src/test/java/com/repograph/finding/TriageReportServiceTest.java`）
- [x] `./gradlew :repograph-app:test` 全量回归通过
- [x] 修复后重跑同一批 45 条报警：`TRUE_RISK` 从 1 条升到 36 条，`NEEDS_REVIEW` 从 41 条降到 6 条，
      剩余 6 条逐条核实均合理（4 条命中已知防护候选保守转 `NEEDS_REVIEW`、1 条无安全信号仅调用方存在、
      1 条硬编码密钥无法确认可达性）——没有因为放宽条件而产生过度自信的误判

## 完成记录

- `TriageReportService.build` 用 `reachable = callers > 0 || isEntryPoint` 替代原来的
  `callers > 0` 判断
- 新增回归测试覆盖"入口点无调用方也应判真实风险"场景

## 相关但本次未处理（记录，供后续参考）

- `LoginFailureHandler#onAuthenticationFailure`（实现 Spring Security `AuthenticationFailureHandler`
  接口回调，非注解式入口）没有被标 `is_entry_point`——入口点识别目前只覆盖注解式框架入口
  （`@RequestMapping` 等），不覆盖"实现框架回调接口"这一类入口，导致该报警仍判 `LIKELY_FALSE_POSITIVE`。
- `SafeDomainParser` 构造方法未发现调用方，判 `LIKELY_FALSE_POSITIVE`——可能是 Spring 依赖注入
  构造（容器反射创建），不会在源码里留下显式 `new SafeDomainParser()` 调用点，属于同一类
  "非显式调用的可达性"问题，值得和入口点识别一起在下一轮真实样本验证里专门核实。
