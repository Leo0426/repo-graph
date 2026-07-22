# Issue Tracker

此仓库的 issues 和 PRD 以 markdown 文件形式存放在 `.scratch/` 目录下，**同时同步到本仓库的
GitHub Issues**（`gh issue` / GitHub API，仓库 `Leo0426/repo-graph`）。`.scratch/` 里的文件是
权威版本（更完整、和代码改动同一个 commit 历史）；GitHub issue 是对外可见的同步副本，方便
协作者浏览和检索，不是独立维护的第二份内容。

## 约定

- 每个功能一个目录：`.scratch/<feature-slug>/`
- PRD 文件：`.scratch/<feature-slug>/PRD.md`
- 实现 issues：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号
- Triage 状态记录在每个 issue 文件顶部附近的 `Status:` 行（role 字符串见 `triage-labels.md`）
- 评论和对话历史追加到文件底部的 `## 评论` 标题下

## GitHub 同步规则

- **新建/完成一个 bug issue 时**：创建对应 GitHub issue（标题取文件的 `# ` 一级标题，正文为文件
  内容去掉 `Status:` 行，末尾追加一行注明同步自哪个本地文件路径），打 `bug` 标签；若本地文件
  `Status: resolved` 且对应代码修复已经 commit（不要求已 push，但 push 后 issue 里的文件路径/行号
  引用才有意义，建议先 push 代码再建 issue），额外打 `resolved` 标签并立即 `gh issue close`。
- **PRD.md / 方法论一类"活文档"（非单个 bug）**：同步为长期 `open` 的 issue，不 close；打
  `epic`（PRD 类）或 `documentation`（方法论/流程类）标签；本地文件后续更新时，用
  `gh issue edit <编号> --body-file` 同步更新对应 issue 正文，保持两边一致。
- **Triage role → GitHub label** 的映射见 `triage-labels.md`；6 个标准 role 对应的 label 需要
  预先在仓库里创建好（`needs-triage`/`needs-info`/`ready-for-agent`/`ready-for-human`/`wontfix`/
  `resolved`），已创建过的不用重复创建。
- 找不到 `gh` CLI 或未登录（`gh auth status` 失败）时，先完成本地 `.scratch/` 记录，明确告知
  用户 GitHub 同步跳过了，不要静默略过。

## 当 skill 说"发布到 issue tracker"时

在 `.scratch/<feature-slug>/` 下创建新文件（如需要则创建目录），并按上面"GitHub 同步规则"
同步到 GitHub Issues。

## 当 skill 说"获取相关工单"时

读取引用路径处的文件。用户通常会直接传入路径或 issue 编号（本地文件路径和 GitHub issue
编号是等价的两种引用方式）。
