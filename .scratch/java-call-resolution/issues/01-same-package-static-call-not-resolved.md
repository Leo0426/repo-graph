Status: resolved

# 同包静态调用未解析为 CALLS 边

## 背景

在用真实开源项目（[bbhunter/vulnado](https://github.com/bbhunter/vulnado)，含已知 RCE/SQLi/XSS/SSRF 的靶场）
对 P0 报警解释器做端到端验证时发现：`triage_finding` 把两个已确认的真实高危漏洞
（`Cowsay#run` 命令注入、`User#fetch` SQL 注入）都判成 `NEEDS_REVIEW`，理由是"未发现调用方"，
但源码里明显有调用方（`CowController.cowsay()` → `Cowsay.run()`，`LoginController.login()` → `User.fetch()`）。

`find_callers`/`find_callees` 直接验证：图里这两条调用确实是 0 条边。

## 根因

`JavaParseContext.resolveScope(String scope)`（`repograph-app/src/main/java/com/repograph/parser/java/JavaParseContext.java`）
只识别四种接收者：`this`、局部变量/参数、字段、显式 `import` 的类型；再退化到"scope 里带 `.`"这一种情况。

`Cowsay.run(input)` 和 `User.fetch(username)` 都是**同包静态调用**——Java 同包类不需要 `import`，
所以 `scope="Cowsay"`（或 `"User"`）四条都不命中，`resolveScope` 直接返回 `null`。

上层 `resolveCall(methodName, scope, argumentTypes)` 收到 `null` 后，在 `scope` 非空但解析失败时仍然落到
`if (!classStack.isEmpty()) return unresolvedCallTarget(classStack.peek() + "#" + methodName, ...)`
这一支——把调用错误地当成"调用方自己类上的方法"，而不是留空/丢弃。生成的 target
（如 `CowController#run(String)`）在调用方类里根本不存在同名方法，图写入阶段自然连不上任何节点，
边被静默丢弃，调用链就此断掉。

**影响面不止这两条**：任何"同包直接静态调用、不经过变量、不 `import`"的写法都会漏边——这是 Java
里非常常见的写法。修复后 `Postgres` 的调用方从 3 个变成 9 个，说明之前项目内被漏掉的边不止验证时看到的这两条。

`TriageReportService` 的可达性置信度直接依赖调用图的调用方数量，断链会系统性地把真实高危漏洞压低成
`NEEDS_REVIEW`，正好削弱了 [ADR：AI Agent 缺陷发现接口] 里"结构化查询比 grep 精确"这个核心卖点。

## 修复

`resolveScope` 新增第五条兜底：变量/字段/import 都未命中，且 `scope` 形如类型名（首字母大写）时，
猜测为**同包类型**，返回 `packageName + "." + scope`。猜错时下游按 `targetBase + arity` 匹配不到候选，
边照样被静默丢弃（保持"外部库调用不入图"的既有语义），不会引入新的误连边——比原来"归到调用方自己类"更安全。

```java
// 不是变量/字段/显式 import，且形如类型名（首字母大写）：猜测为同包静态调用的接收者
if (!packageName.isEmpty() && Character.isUpperCase(scope.charAt(0))) {
    return packageName + "." + scope;
}
```

未改动 `resolveCall` 落到 `classStack.peek()` 的兜底分支本身（那是更广的"scope 非空但确实无法解析"场景，
例如类型未知的局部变量、跨包未 import 的类），只解决了本次验证实测到的同包静态调用这一具体断链场景。

## 验收标准

- [x] 用真实样本（vulnado）复现：`find_callers com.scalesec.vulnado.Cowsay#run(String)` 修复前为空
- [x] 新增单测 `parse_samePackageStaticCall_resolvesToOwnerTypeNotCaller`
      （`repograph-app/src/test/java/com/repograph/parser/java/JavaCodeParserTest.java`）：
      同包静态调用应解析到被调用类型，不能错误归到调用方自己类
- [x] `./gradlew :repograph-app:test` 全量回归通过，无既有测试受影响
- [x] 修复后重新索引 vulnado 并重跑 `triage_finding`：`Cowsay#run` 与 `User#fetch` 均从
      `NEEDS_REVIEW 0.5` 升级为 `TRUE_RISK 0.65`，`Postgres` 的调用方从 3 个增至 9 个

## 完成记录

- `JavaParseContext.resolveScope` 增加同包类型名猜测兜底
- 新增回归测试覆盖该场景
- 用 vulnado 端到端复测确认修复生效
