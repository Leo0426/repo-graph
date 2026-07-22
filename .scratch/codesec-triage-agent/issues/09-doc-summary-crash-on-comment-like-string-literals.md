Status: resolved

# 索引大项目时因字符串字面量崩溃：extractDocSummary 越界异常

## 背景

用第三个真实开源项目（[WebGoat](https://github.com/WebGoat/WebGoat)，405 文件/2.65 万行/2331
CodeUnit，OWASP 官方漏洞教学靶场）做端到端验证时，索引在 embedding 阶段永久卡死在 5%
（`{"status":"error: Range [384, 383) out of bounds for length 1011", ..., "pct":5}`），
反复轮询状态不再变化，5 分钟超时后手动 kill 才发现。

## 根因

`EmbeddingUpsertRunner.extractDocSummary()`（`repograph-app/src/main/java/com/repograph/app/pipeline/EmbeddingUpsertRunner.java:186`）
用 `indexOf("/**")` / `indexOf("/*")` 找注释起点，再用 `indexOf("*/", start)` 找终点，
**从 `start`（而不是 `start + 2`）开始搜索闭合标记**——如果 rawSource 里在起点之后紧跟着一个
`/`，会把刚匹配到的开头 `/*` 的第二个字符 `*` 当成闭合标记 `*/` 的第一个字符复用，产生
`end < start + 2`，下面的 `rawSource.substring(start + 2, end)` 直接抛
`StringIndexOutOfBoundsException`。

真实触发源在 WebGoat 的 SQL 注入测试用例里，字符串字面量本身就是 SQL 注入 payload：

```java
// src/test/java/.../SqlOnlyInputValidationOnKeywordsTest.java:25
"Smith';SESELECTLECT/**/*/**/FRFROMOM/**/user_system_data;--"
```

这个启发式方法完全不理解 Java 语法（不区分注释 / 字符串字面量 / 正则），只做纯文本
`indexOf` 扫描，遇到"看起来像嵌套注释"的字符串内容就会误判并崩溃。

**影响面**：这不是"这一条报警判断不准"，而是**整个项目索引直接中断**——`buildSemanticText`
在主线程同步循环里调用（不在 `CompletableFuture` 里），未捕获异常会直接终止
`embedAndUpsert`，之后所有批次都不会再提交。已提交批次仍在后台线程跑完，Neo4j
图数据在 embedding 之前已写完整（不受影响），但 Qdrant 向量数据永久残缺——`locate_at`/
语义检索会长期失效，且没有任何自动重试或告警，只能靠手动发现状态卡住。项目越大、
测试代码里出现"看起来像注释"的字符串字面量的概率越高，越容易触发（vulnado/java-sec-code
这两个更小的项目都没触发，WebGoat 才第一次遇到）。

## 修复

`indexOf("*/", start)` 改为 `indexOf("*/", start + 2)`——从"跳过开头两个字符之后"开始找闭合
标记，结构上保证 `end` 要么是 `-1` 要么 `>= start + 2`，彻底消除这一类越界。

## 验收标准

- [x] 真实样本复现：WebGoat 索引在 embedding 阶段崩溃，堆栈定位到
      `EmbeddingUpsertRunner.extractDocSummary:198`
- [x] 新增单测 `extractDocSummary_stringLiteralWithOverlappingCommentMarkers_doesNotThrow`
      （`repograph-app/src/test/java/com/repograph/app/pipeline/EmbeddingUpsertRunnerTest.java`），
      用真实崩溃触发字符串复现
- [x] `./gradlew :repograph-app:test` 全量回归通过
- [x] 修复后删除旧的（图完整、向量残缺的）WebGoat 项目数据重新索引：
      404 文件、2331 单元、18478 边、0 错误，完整跑完（之前永久卡在 pct=5）
      ；Qdrant 向量计数核对与三个已验证项目总量一致（61+510+2331=2902）

## 完成记录

- `extractDocSummary` 闭合标记搜索起点从 `start` 改为 `start + 2`
- 新增回归测试，用真实触发字符串复现
- 删除并重新索引 WebGoat，确认图+向量数据完整
