# 视觉收敛验收

2026-11-11；依据用户附件中的四步审计建议，在现有工作区完成。

| 要求 | 当前实现与证据 |
| --- | --- |
| 清理两套视觉语言 | `tokens.css` + `base.css`；面板规则归回各 `*-workbench.css`。原 `repograph.css` / `studio.css` 文件和模板引用均删除。 |
| 收敛颜色、字号、圆角 | CSS 的 hex 色值只存在于 tokens；共享字号为 11/12/13/14/20/24px。Agent 保留已有标准/大字号角色。控件 6px、面板 8px。 |
| 删除 cockpit 和字体包袱 | CSS uppercase 声明为 0；移除终端底栏、雷达/扫描装饰、全大写展示标签与 Oxanium 声明及两份字体文件。领域枚举/协议名保留其原始含义。 |
| 本地图标 | 13 个 Lucide 符号，随文件保留版本 1.71.0、来源和许可证；浏览器验证五个导航符号的实际几何。 |
| 简化外壳 | 图标侧栏、浅底选中态；域内导航 + 一行标题。仓库选择器保留，基础服务汇总为状态点，账户/语言/明细移入菜单。 |
| 完整命令面板 | 页面、授权仓库、最近查询；过滤/箭头/Enter/Tab/Escape/Ctrl或Cmd+K；取消恢复焦点、其他模态隔离、普通用户入口过滤、历史转义。切页/切仓库不启动后台工作。 |
| 首页与搜索 | 仓库列表首屏可操作；去 hero，当前仓库操作在列表后。紧凑检索模式、默认折叠筛选、分隔线结果列表；保留源码与图谱的独立操作。 |
| Agent 与空状态 | 能力与步骤使用可翻译的中文/英文标签；Wiki、质量、Agent 阅读区复用 `emptyState`。保留加载/错误/空数据的区别、运行证据和人工审核语义。 |
| 暗色与微反馈 | `prefers-color-scheme: dark` 同步 HTML、表单、弹窗、登录、代码与图谱 SVG；原生 select 箭头随 color-scheme。保留焦点、减少动画、手机上下文、骨架与短 hover 反馈。 |
| 规则同步 | 更新 DESIGN_SYSTEM、INTERACTION_DESIGN、VALIDATION 及 UI README。模板剩余 5 处 inline style 均为初始 `display:none`。 |

验证结果：

- 全量 UI：`NODE_PATH=/tmp/rg-pw/node_modules UI_BASE_URL=http://127.0.0.1:18550 node --test --test-concurrency=2 repograph-app/src/test/ui/*.test.cjs`，172 通过，0 失败，0 跳过。
- 最后文案调整后：设计/命令/Agent 定向回归，24 通过，0 失败，0 跳过。
- 最后 select 外观调整后：设计矩阵 14 通过，0 失败，0 跳过；结果保存在 `repograph-app/build/ui-refinement/results/final-visual.log`。
- `./gradlew :repograph-app:bootJar` 通过；核对 JAR 含新样式、命令脚本、模板和图标许可证，原样式和 Oxanium 不再打包。
- `node --check` 检查共享、Agent、命令脚本通过；`git diff --check` 通过。
- 截图：亮/暗 × 1440/390px × 仓库、搜索、Agent、Wiki、图谱、命令、登录，共 28 张，位于 `repograph-app/build/ui-refinement/screens/`。

全量及定向日志保存在 `repograph-app/build/ui-refinement/results/`。修正了测试中过宽的 index/watch 路由匹配，避免把状态 GET 错配到变更 fixture；筛选和语言操作按新 UI 路径展开后执行。

边界：浏览器使用真实模板/CSS/JS和虚构 API；本次未运行后端 JUnit、外部 Neo4j/Qdrant/Ollama 集成或完整 WCAG 审计。对比度采样排除 SVG、渐变和禁用元素；图谱另做实际截图检查。保留任务开始前已有业务改动，未创建提交或发布。
