Status: resolved

# P2 第一片：研判报告接入 GitHub PR 评论

## 目标

roadmap P2（"进入研发流程"）的第一个可验证切片：把 `TriageReportService` 生成的研判报告
自动发布到真实 GitHub PR 评论上，而不只是能通过 REST/MCP 查出来。验证"研判结果能不能真的
嵌入 DevSecOps 流程"这个假设的最小闭环。

## 设计

- `GitHubProperties`（`repograph.github.token` / `api-base-url` / `timeout-seconds`）+
  `GitHubConfiguration`（独立 `githubRestTemplate` bean，超时可配）+ `GitHubPrCommentClient`
  （`POST /repos/{owner}/{repo}/issues/{prNumber}/comments`，PR 评论在 GitHub API 里等价于
  issue 评论）。token 未配置或调用失败统一抛 `GitHubCommentException`，`GlobalExceptionHandler`
  映射为 502 Bad Gateway。
- 应用内已有 `ollamaRestTemplate` 这一个 `RestTemplate` bean，新增第二个后两处注入点都补了
  显式 `@Qualifier`，避免 Spring 因两个候选 bean 报错。
- `TriageReportService` 新增 `toMarkdownSummary(List<TriageReport>)`：把多条报告合并成一条
  评论（每条报警各发一条会刷屏），头部是 verdict 统计概览，每条报告用 `<details>` 折叠。
- `TriageController` 新增 `POST /api/v1/triage/report/pr`，复用已有的报警导入 + 研判逻辑
  （抽出 `buildReports` 私有方法给 `/report` 和 `/report/pr` 共用），额外接 `owner`/`repo`/
  `prNumber` 参数，研判完直接调用 `GitHubPrCommentClient` 发布。

## 验收标准

- [x] 新增单测：`GitHubPrCommentClientTest`（返回 html_url、Bearer 认证头、token 未配置抛异常、
      REST 调用失败包装异常）、`TriageReportServiceTest.toMarkdownSummary_*`、
      `TriageControllerTest.reportToPr_*`（成功路径 + GitHub 失败返回 502）
- [x] `./gradlew :repograph-app:test` 全量回归通过
- [x] **真实端到端验证**：在本仓库建了一个临时测试 PR（#15），用 `gh auth token` 拿真实
      GitHub token 配置到运行中的 app，对这个 PR 调用 `POST /api/v1/triage/report/pr`
      （body 为 vulnado 的真实 semgrep 扫描结果），确认评论真的发布成功
      （`https://github.com/Leo0426/repo-graph/pull/15#issuecomment-5045384993`），
      内容包含 verdict 统计和逐条可折叠研判报告；验证完关闭 PR 并删除分支，未留痕迹

## 完成记录

- 新增 `com.repograph.finding.github` 包：`GitHubProperties`/`GitHubConfiguration`/
  `GitHubPrCommentClient`/`GitHubCommentException`
- `TriageReportService` 新增 `toMarkdownSummary`
- `TriageController` 新增 `POST /api/v1/triage/report/pr`，重构出共享的 `buildReports`
- `application.yml` 新增 `repograph.github.*` 配置块
- 用真实测试 PR 验证发帖成功

## 相关但本次未处理（记录，供后续参考）

- 只做了 GitHub；GitLab MR 评论、Bitbucket 等平台未做，roadmap 里 P2 明确提到 GitLab
- 没有做"从 CI 触发"这一环——目前是手动调 REST 接口，没有 GitHub Actions/webhook 自动触发
- 没有做"状态回写"——PR 评论发出去之后，人工在 PR 里的讨论/resolve 不会同步回
  `TriageFeedbackStore`
