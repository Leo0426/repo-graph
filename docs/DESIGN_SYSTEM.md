# RepoGraph Design System

本文件只描述已有共享视觉入口；用户动作和恢复语义见 [Interaction Design](INTERACTION_DESIGN.md)。

共享视觉变量和组件样式从 `repograph-app/src/main/resources/static/css/repograph.css` 读取：
背景层使用 `--bg*`，文字层使用 `--text*`，边框使用 `--border*`，字体角色由 `--ff`/`--fm` 表达。
调整跨面板外观先检查这些变量及共享 `.btn`、状态 badge、面板样式的消费点，不从单页截图推导新全局规范。

Agent 作战台另有 `--agent-text-*` 字号角色，由页面字号选择切换；修改正文、控件和提示时检查两种字号状态。
样式拆分时以 `templates/fragments/head.html` 的实际加载顺序为准，避免在旧位置添加不生效的覆盖。
`prefers-reduced-motion` 下运行态动画已有关闭规则，修改运行状态外观时同时检查该模式。

这些入口说明当前复用关系，不表示对比度、键盘焦点或所有 viewport 已通过自动验证；检查入口见
[Validation](VALIDATION.md)。
