# 首次启动时 ~/.repograph 目录不存在导致 SQLite 崩溃

Status: ready-for-agent

## 问题

index.db 路径为 `${user.home}/.repograph/index.db`,但应用启动不自动创建
`~/.repograph` 目录;全新机器上首次启动直接崩溃,无友好错误。

## 验收标准

- [ ] 启动时(或 SQLite 存储初始化前)自动创建 ~/.repograph 及子目录
- [ ] 新增测试:目录不存在时应用可正常启动并完成索引
- [ ] docs/DEVELOPMENT.md 排障节同步更新

## 评论

- 2026-10-15 全仓审计发现。
