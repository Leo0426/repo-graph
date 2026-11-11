# 浏览器交互回归

回归由 `workspace.test.cjs` 及 `search`、`graph`、`agent`、`stats`、`vulns`、`shell`、`index`、`tools`、`symbol`、`sbom`、`metrics`、`benchmark`、`health` 的
`*-workflow.test.cjs` 组成，覆盖导航与焦点、搜索筛选/分页/输入恢复、图谱查询与大图连线、
Agent 准备及运行切换、概览分布与局部失败、漏洞筛选与证据、跨面板项目选择及请求乱序、
索引阶段与恢复、项目管理及辅助工具、符号与源码定位、SBOM 筛选与图、质量静态指标与模型建议、离线测评来源与明细、健康检查新鲜度与恢复、字号与窄屏、英文和减少动画偏好。

`PreviewServer` 使用真实首页控制器、Thymeleaf 模板及源码目录中的 CSS/JS。它不扫描业务组件，
并排除 Neo4j、JDBC 与 SQL 初始化自动配置；独立 `preview.properties` 替代生产 `application.yml`。
因此不启动索引、文件监听或扫描器，不读写用户数据库，也不连接 Qdrant、Neo4j 或 Ollama。
浏览器请求的 `/api/**` 由 `fixtures.cjs` 拦截为虚构 Demo 数据，未知接口会被记录并使回归断言失败。
这些检查验证真实页面配合模拟 API 的行为，不代表真实服务或存储集成通过。

## 前提

- 使用仓库要求的 JDK 25，`java` 和 `javac` 指向相同版本。
- Node.js 20+，当前 Node 环境能 `require('playwright')`。依赖已装在其他目录时，可通过
  `NODE_PATH=/绝对路径/node_modules` 指向已有环境；本辅助不会安装依赖。
- 已安装 Google Chrome；测试默认使用 Playwright 的 `chrome` channel。
  `UI_BROWSER` 可指定其他已安装且受 Playwright 支持的 channel。

以下命令均从仓库根目录运行。这些文件位于 `src/test/ui`，不加入默认 Java 测试 sourceSet，
普通 `./gradlew test` 不会启动预览或执行浏览器用例。

## 编译并启动隔离预览

先通过临时 init script 导出与当前构建一致的依赖路径；不要拼接整个 Gradle 缓存，缓存可能有多个版本。
该步骤编译 app 主代码，不运行测试、不启动服务，也不修改生产构建脚本。

```bash
./gradlew --no-configuration-cache \
  -I repograph-app/src/test/ui/preview.init.gradle \
  :repograph-app:writeUiPreviewClasspath

preview_dir="$PWD/repograph-app/build/ui-preview"
preview_cp="$(cat "$preview_dir/runtime-classpath.txt")"
mkdir -p "$preview_dir/classes"
javac -cp "$preview_cp" -d "$preview_dir/classes" \
  repograph-app/src/test/ui/PreviewServer.java

UI_PORT=18550 java --enable-native-access=ALL-UNNAMED \
  -cp "$preview_dir/classes:$preview_cp" com.repograph.uipreview.PreviewServer
```

默认只监听 `127.0.0.1:18550`；端口冲突时设置另一个 `UI_PORT`，并同步下方 `UI_BASE_URL`。
模板和静态文件从 `repograph-app/src/main/resources` 读取，无缓存，修改后刷新即可。
`UI_RESOURCES` 可指定另一个资源目录；`UI_PREVIEW_DIR` 指定临时 Tomcat 目录；
`-Drepograph.preview.config=/绝对路径/preview.properties` 可指定独立配置文件。
等待日志出现 Tomcat started 后再启动浏览器测试；完成后在此终端 Ctrl-C 关闭预览。

## 执行浏览器用例

在另一个终端、相同仓库根目录运行：

```bash
UI_BASE_URL=http://127.0.0.1:18550 UI_BROWSER=chrome \
  node --test repograph-app/src/test/ui/*.test.cjs
```

每个用例创建独立页面与浏览器上下文，模拟项目和语言偏好；不会使用用户的 Chrome 配置。
套件结束后关闭浏览器，预览服务器仍由启动终端管理。结果以本次 `node --test` 的退出码和
通过/失败明细为准；预览能启动或 Java 编译成功均不能代替浏览器回归结果。

`wiki-workflow.test.cjs` 覆盖项目文档读取与筛选、源码引用跳转、Markdown 安全展示与导出、
跨项目旧响应隔离、生成状态重试与刷新恢复、空状态、窄屏和英文。数据及生成任务均为模拟 API。

`design-system.test.cjs` 使用真实样式检查中性灰阶与墨绿视觉角色：亮/暗两主题、桌面/手机的 14 个面板、登录注册、
弹窗、搜索图标间距及短屏滚动。`visual-contrast.cjs` 对当前视口内可测 HTML 文字采样，
检查普通文字 4.5:1、大字 3:1，并检查页面/面板横向溢出。SVG、渐变、禁用元素不在采样范围，
这不是完整 WCAG 审计，也不能替代图谱和长内容的视觉检查。

`interaction-polish.test.cjs` 覆盖当前入口重复点击不刷新、搜索阅读位置恢复、手机菜单背景隔离、
通知暂停/关闭/焦点恢复/替换计时，以及 Wiki 阅读章节跟随。通知时间使用浏览器模拟时钟，
不依赖长时间真实等待；Wiki 使用长文档 fixture 验证滚动行为。


`command-palette.test.cjs` 验证页面/仓库/最近查询命令、输入过滤、箭头与 Enter、空结果、Tab 焦点约束、
取消与焦点恢复、重复快捷键、其他模态隔离、普通用户入口过滤、历史文字转义及手机账户菜单。
同时检查仓库首屏可操作、本地图标具有实际 SVG 几何；所有动作都使用模拟 API。


`visual-refinement.test.cjs` 验证页头名称与宽度、状态按钮、静态/动态 select 箭头及原生选择、导航操作同排、
键盘展开说明、检索结果字体层级、图谱图标在换语言后仍渲染，以及主题三态、跨登录页持久化、系统变化和异常存储。
