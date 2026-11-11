# 八包最终验收索引

2026-11-11。全部八包的本地交付已完成。本文件记录实际证据；按用户确认，外部创建/推送不在本轮范围。

| 包 | 已验证行为 | 证据 |
| --- | --- | --- |
| 01 仓库范围 | 当前仓库默认、显式全部授权、同名仓库、一次修改后的历史、清空与撤权、迟到响应 | search-scope / repository-tasks / shell；HTTP 安全链；真实 Qdrant IT |
| 02 能力 | 基础健康、Embedding、生成配置/启用/验证/实际步骤分开；关闭/离线/未知和恢复入口；查看无隐式任务 | capabilities / health / agent / admin；能力 HTTP；真实业务空仓库读取 |
| 03 仓库任务 | 行内一次进入、当前标记、长名称、筛选/页码/阅读锚点和权限保持 | repository-tasks / tools / workspace；六条前后路径 |
| 04 Agent | 全部 Run 状态、两档字号、按仓库草稿、安静轮询、冻结报告和显式审核、失败保留 | agent-reading / agent-workflow；ReviewQueue/ProjectAccess/SastAgent；独立真实栈审核 snapshot 不变 |
| 05 连续证据 | 桌面非模态/手机模态、位置/行号/源码、跨页、失败重试、焦点和乱序隔离 | result-reader / vulns / symbol / search；实际源码 Demo.java L6–9；1024px 容器布局 |
| 06 图谱 | 八模式保留、常用/更多、实际邻接、键盘、源码返回及缩放、孤立/长名/范围 | graph-reading / graph-workflow / symbol；SVG 焦点/连线与减少动态效果 |
| 07 高频导航 | 双语别名、分组/最近使用、重验权限、坏存储/IME、分页/范围/密度 | command-palette / list-navigation；20/200/1000 条三样本测量；实际行高及字号 |
| 08 维护 | 管理/认证双语、动态客户端错误、原位草稿、具体帮助、组件样式、主题/焦点/长英文 | admin / accessibility / design-system / visual-refinement；42 张人工截图矩阵；Chrome 实际 200% 缩放 |

## 实际执行

- 全量浏览器：`final-reviewed-ui-10.log`，240 通过、0 失败、0 跳过。真实模板/CSS/JS，API 为虚构数据。
- 普通 Java：app 1140 + MCP 30 = 1170，0 失败/错误/跳过。MCP 是 Gradle 有效 up-to-date 结果；XML 独立保存。
- 真实 Qdrant 集成：15 通过、0 失败/跳过，独立 collection 清理；不代表真实模型质量。
- 独立真实 HTTP/SQLite/Neo4j/Qdrant/JavaParser 栈：索引、检索源码、扫描、研判及认领/确认走通；只有 Embedding 是固定向量 HTTP 替身，生成请求 0。测试容器、卷、数据库、进程和凭据已清理。
- 最新打包应用 8080：登录、列表/能力与 Provider 读取通过，业务仓库数 0；无扫描/索引/生成写请求。73 个静态/模板资源与源码逐字节一致。
- JavaScript 语法、Python 工具语法、`git diff --check` 通过。截图 42 张逐一查看，额外状态与限定见 SCREENSHOT-REVIEW.md。

原始日志在 `repograph-app/build/ux-next/results/`，截图在同级 `screens/`；任务和性能测量在 measurements/。完整工作说明见 IMPLEMENTATION.md。

## 交付状态

用户已明确确认本轮交付本地代码、验收记录和八份 PR 草稿，暂不推送。八份正文在 review/，未自动提交旧工作区；外部创建/推送不属于本轮完成条件。最终双轴审查已完成：Standards 0 阻断/0 建议，Spec 0 阻断/0 建议，见 REVIEW.md。以上本地范围已全部完成。
