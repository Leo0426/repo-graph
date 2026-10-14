# T9 遗留 3:PDF 视觉回归测试

Status: ready-for-agent

## 背景

T9 能力矩阵遗留:"PDF 仅文本抽取回归、无视觉回归"。`ReportPdfRenderer`
(Markdown → flexmark HTML → openhtmltopdf/PDFBox,内嵌 Noto Sans SC)目前只验证文本可抽取,
排版退化(字体缺失、代码块溢出、CJK 断行错乱)无法被发现。内嵌字体 + 固定渲染器意味着输出
理论上确定性,具备视觉回归的前提。

## 要构建什么

`PdfVisualRegressionTest`(app 测试):

1. 构造固定内容的 fixture 快照(覆盖:中文正文、代码块、长路径/长 URL、表格、证据编号列表——
   即 `ReportPdfRenderer` 文档里声明的能力点)。
2. `ReportPdfRenderer` 渲染 → PDFBox `renderImageWithDPI(96)` 逐页转 PNG。
3. 与基线图片对比:逐像素比对,允许阈值内差异(默认差异像素占比 ≤0.5%,容忍抗锯齿抖动)。
4. 基线 PNG 存 `src/test/resources/pdf-regression/`,命名含 fixture 名;
   提供 `-Dpdf.baseline.update=true` 系统属性重新生成基线(更新基线属于**人工检查后的动作**,
   diff 大于阈值时测试输出失败页 PNG 到 `build/` 供人看,不得自动覆盖基线)。

**确定性前提(先验证再写断言)**:同一 JVM 连续渲染两次逐字节一致;跨平台差异若不可忽略,
在测试内用 assumption 显式跳过非 Linux/Windows 目标并记录,不得让基线测试在 CI 上随机红。

## 验收标准

- [ ] fixture PDF 渲染两次逐字节一致(确定性验证先行)
- [ ] 与基线一致 → 测试通过;人为破坏渲染器(如临时改字号)→ 测试红且输出差异页
- [ ] `-Dpdf.baseline.update=true` 重新生成基线流程可用,且正常路径下不触发覆盖
- [ ] 基线 PNG 与测试进入常规 `./gradlew :repograph-app:test`,无平台随机红(连续 3 次本地全绿)

## 验证方式

`PdfVisualRegressionTest` 本身即验证;连续 3 次 `./gradlew :repograph-app:test` 全绿后报告。

## 范围外

- 不做多页面复杂排版新增能力(只锁现有渲染能力不退化)
- 不引入 ImageMagick/外部图像库,像素比对自实现(阈值简单,无第三方依赖)

## 评论
