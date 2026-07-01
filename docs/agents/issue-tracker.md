# Issue Tracker

此仓库的 issues 和 PRD 以 markdown 文件形式存放在 `.scratch/` 目录下。

## 约定

- 每个功能一个目录：`.scratch/<feature-slug>/`
- PRD 文件：`.scratch/<feature-slug>/PRD.md`
- 实现 issues：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号
- Triage 状态记录在每个 issue 文件顶部附近的 `Status:` 行（role 字符串见 `triage-labels.md`）
- 评论和对话历史追加到文件底部的 `## 评论` 标题下

## 当 skill 说"发布到 issue tracker"时

在 `.scratch/<feature-slug>/` 下创建新文件（如需要则创建目录）。

## 当 skill 说"获取相关工单"时

读取引用路径处的文件。用户通常会直接传入路径或 issue 编号。
