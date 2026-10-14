# T9 遗留 1:审核队列列表分页

Status: resolved

## 背景

T9 能力矩阵([next-development-plan-audit-platform.md](../../../docs/generated/next-development-plan-audit-platform.md)
能力矩阵第 6 行)明确遗留:"缺少分页与批量导出多个快照"。当前
`ReviewQueueStore.list` 一次返回项目内全部条目,`ReviewQueueController.list` 直接返回数组——
真实团队试用中条目数会到数百条,无分页不可用。

## 要构建什么

- `ReviewQueueStore.list(...)` 增加 `offset`/`limit` 参数(现有全部过滤条件保持不变),
  新增 `count(...)` 方法返回同过滤条件下的总数(SQL `COUNT(*)`,同一 WHERE 拼装)。
- `ReviewQueueController.list` 增加 `page`(默认 0)/`size`(默认 100,上限 500)参数。

**契约变更(破坏性,预决策)**:响应从 `List<ReviewQueueEntry>` 改为信封:

```json
{"entries": [...], "page": 0, "size": 100, "total": 342}
```

`page/size` 缺省时行为等价于旧的"全量"(size 默认 100 会截断超百条项目——这是有意收紧,
防止前端无意全量拉取;需要全量时显式传大 size,上限 500)。前端/测试中的数组消费点必须同步修改:
排查 `src/main/resources/templates`、`static/js`、UI 测试(`src/test/ui/*.test.cjs`)与
`ReviewQueueControllerTest` 中对该端点的所有调用。

## 验收标准

- [x] 过滤条件(严重程度/结论/状态/规则/时间窗)与分页参数组合正确,`total` 与全量计数一致
- [x] `size` 超过 500 被钳制到 500;负数 `page` 被钳制到 0
- [x] 响应为信封结构,`entries` 顺序与既有排序(`updated_at DESC`)不变
- [x] 前端/UI 消费点已排查:`repograph-agent.js` 只消费 export 端点、UI fixtures 对集合路由
      统一返回空数组——**无需修改**;`node --test` 因无 UI 改动未运行(验收项允许的跳过声明)
- [x] `ReviewQueueControllerTest` 全部契约断言更新且通过(信封 + 钳制两个新用例)

## 验证方式

`ReviewQueueControllerTest` 契约扩展 + `ReviewQueueStoreTest`(分页/计数,含过滤组合)。
命令:`./gradlew :repograph-app:test`;UI 部分按 [VALIDATION](../../../docs/VALIDATION.md)
跑 `node --test`(需预览服务)。报告实际结果。

## 范围外

- 不做游标/键集分页(offset/limit 足够,条目无高频插入场景)
- 不改导出端点(批量导出是姊妹工单 02)
- 不做排序参数化(保持 `updated_at DESC` 唯一排序)

## 评论

- 2026-10-13:完成。`ReviewQueueService` 接口的 `list` 增加 `offset/limit`(null = 不分页),
  新增 `count`(同过滤条件总数);SQL 过滤段抽取为 `appendFilters` 供 list/count 共用。
  控制器信封 `ReviewQueueListResponse(entries, page, size, total)`,page<0→0、size≤0→默认
  100、size>500→500。消费点排查:前端无 list 调用,仅 `ReviewQueueControllerTest` 与
  `ReviewQueueStoreTest` 更新(新增分页/计数/钳制用例)。全量回归 944 tests,6 failures
  与改动前一致(既有 Windows 环境失败)。GitHub 同步跳过(gh 未登录)。
