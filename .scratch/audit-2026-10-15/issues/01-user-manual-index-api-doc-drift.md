# 用户手册 index API 示例与实际行为不符

Status: ready-for-agent

## 问题

docs/user-manual.md 第 5 节(REST API 参考)中 `POST /api/v1/index/project`
示例使用 JSON body;实际控制器只接受 query 参数,JSON body 会返回 400。

## 验收标准

- [ ] 手册示例改为实际签名(query 参数),并注明 202 异步 + status 轮询
- [ ] 对照 IndexController 实际参数逐一核对

## 评论

- 2026-10-15 全仓审计发现;关联 CONTEXT.md"索引 API 异步(202)"决策。
