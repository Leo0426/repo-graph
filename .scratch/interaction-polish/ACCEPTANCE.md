# 精致交互验收

日期：2026-11-10。延续暖白墨绿视觉，改进连续性、反馈与阅读体验。

| 范围 | 交付与证据 |
|---|---|
| 导航 | 重复当前入口不加载；搜索往返保留查询与滚动位置。新增浏览器行为测试通过。 |
| 手机抽屉 | 主内容 inert、关闭恢复、选项切换解除隔离；断点切换不播放抽屉位移。新增行为测试与真实手机尺寸冒烟通过。 |
| 通知 | 可关闭，hover/focus/标签页隐藏暂停，错误至少 8 秒，新通知重置倒计时；键盘关闭回到原操作位置。模拟时钟测试与真实运行版冒烟通过。 |
| Wiki | 章节定位、滚动跟随 aria-current、不抢焦点或改变 hash；长文档行为测试和桌面实际渲染检查通过。 |
| 共享触感 | 控件 hover/pressed/focus、短过渡、忙碌指针、模态轻量进入；取消整面板位移动画，选中前景背景同步切换，保留减少动态效果。共享视觉与既有键盘/模态/英文/窄屏回归通过。 |

完整 UI 回归：158 项通过，0 失败、0 跳过。日志 `/tmp/repograph-polish-final-ui.log`。
新增 6 项行为回归位于 `interaction-polish.test.cjs`。此前导航过渡采样失败已修正并完整重跑。
`./gradlew :repograph-app:bootJar -x test` 成功；`git diff --check` 通过。
已重启并打开 `http://localhost:8080`，真实管理员登录、手机菜单、通知关闭后焦点回到搜索框，0 JavaScript 异常、无横向溢出。

实际渲染：`/tmp/polish-search-toast.png`、`/tmp/polish-drawer.png`、`/tmp/polish-wiki-reading.png`。
真实运行截图：`/tmp/polish-live-mobile.png`。

边界：UI 数据来自模拟 API；真实运行冒烟不证明模型/索引集成。未改后端，本轮未重跑 Java 测试，打包明确跳过测试。
文字对比度采样仍不是完整 WCAG 审计。未提交代码、未调用付费模型。
