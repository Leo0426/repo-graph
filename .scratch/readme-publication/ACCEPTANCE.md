# README 与已验收项目改动发布前验收

日期：2026-11-11。用户明确选择“README 和当前已验收的项目改动”一并推送至 GitHub。
此前各轮验收记录中的“本地交付、暂不推送”为当时范围，本轮授权将已验收产品实现及配套文档提交至 main。

## 本轮文档

- 重写 README.md 与 README.en.md，统一产品定位、五个工作域、首次启动和账号审批/归属流程。
- 修正默认 Embedding 为配置中的 qwen3-embedding:latest / 4096 维。
- 补充模型发现、可选价格、生成模型与 Embedding 分离、远程服务的数据边界。
- MCP 使用实际构建产物名，说明账号环境变量、会话与 CSRF。
- 移除过时的无认证 curl 示例、未验证性能承诺及将已实现能力列为待开发的路线图。
- 两张截图来自当前真实模板/CSS/JS与虚构演示 API；不展示实际仓库或厂商账号。
- README 相对链接、图片路径、JSON 配置与 Bash 代码块语法检查通过。

## 验证

- `./gradlew --max-workers=2 check`：通过。app 共 1179 项，1175 通过、0 失败、4 跳过；
  跳过为未配置的 Semgrep 实机 2 项、检索基准 2 项。MCP 30 项通过报告为有效 UP-TO-DATE，未重新执行。
- 全量浏览器：`node --test --test-concurrency=2 --test-timeout=180000 .../*.test.cjs`，
  247 通过、0 失败、0 跳过。首次默认高并发运行有两个进程未退出，已中止，降低并发后完整运行通过。
- `git diff --check`：通过。原始日志保留在 `repograph-app/build/readme-publication/results/`，不提交构建产物。
- 模型发现真实安全链/SQLite、本地 HTTP 上游、未保存草稿不落库的运行验收，见
  [Provider 验收](../provider-model-discovery/ACCEPTANCE.md)。真实厂商账号及生成质量未在本轮验证。

## 提交边界

包含已验收源码、回归测试、职责文档、计划和验收记录。中英文 README 及两张界面图单独作为文档提交。
本地 PR 草稿、冻结审查 diff、临时日志、Python 缓存和 demo 讲稿不在此次推送范围。
独立 UI 预览用于截图及测试，完成后停止；8080 业务 app 保持运行。
