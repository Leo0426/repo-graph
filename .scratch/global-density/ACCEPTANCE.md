# 全局紧凑布局验收

2026-11-10，按用户要求把漏洞页的紧凑方向扩展到全部页面。

- 全局：页头 64px、桌面侧栏 208px、导航入口 44px、标题 24px、内边距 24px；普通桌面控件 34px、手机 40px，贴边单圈焦点。
- 仓库与工具：收紧介绍区/仓库行、限制筛选与辅助表单宽度，去除列表及辅助工具大外框。
- 搜索/源码/概览/依赖/质量：统一开放查询工具条，限制项目与短筛选宽度，保留源码/结果阅读面板，SBOM 列表使用行分隔。
- 图谱/索引：收紧控制侧栏与按钮、保留画布和日志的必要边界。
- Wiki/Agent：减少目录和准备区重复边框，保留两档 Agent 文字及完整证据内容。
- 健康/测评/管理：统一卡片圆角和留白，短筛选有宽度边界，Provider 编辑使用分区线。
- 登录注册/弹窗：同步圆角与控件密度，收紧品牌说明和表单留白，保留短屏滚动。

验证：完整 UI 回归 158 项通过、0 失败、0 跳过。最后微调健康图标与工具表单后分别补跑 12 项及 9 项相关回归，均通过。
日志：`/tmp/repograph-global-density-final-ui.log`、`/tmp/repograph-global-density-last-check.log`、`/tmp/repograph-global-density-tools.log`。
桌面/手机各 15 页面采样，均无横向溢出、无采样文字对比度失败；结果 `/tmp/global-compact-1440.json`、`/tmp/global-compact-390.json`。
实际渲染检查：全工作域桌面及手机布局、Provider 草稿、Wiki 正文、搜索/符号/SBOM 结果、Agent 准备区与字号回归。
真实本地管理员登录后遍历 14 面板：0 JavaScript 异常、无横向溢出，手机索引配置/执行按顺序堆叠。
截图：`/tmp/global-compact-1440-*.png`、`/tmp/global-compact-390-*.png`；真实版本 `/tmp/global-compact-live-search.png`、`/tmp/global-compact-live-admin.png`、`/tmp/global-compact-live-mobile.png`。

`bootJar -x test` 成功，本地 localhost:8080 已更新；`git diff --check` 通过。
本轮仅调整 CSS 和视觉规范，未重新执行 Java 测试。UI 回归使用模拟 API，文字采样不等同完整 WCAG 审计。
