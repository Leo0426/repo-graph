## 问题陈述

RepoGraph 的漏洞管理模块骨架已完整实现：9 条代码规则扫描器、依赖 CVE 匹配器、SQLite 持久化、REST API、CLI 子命令组和 Web UI panel 全部存在并编译通过。但模块停在"骨架完整但未验证"的状态——缺少 VulnStore / AdvisoryStore / VulnController 的集成测试、Web UI 未经浏览器实际验证、Advisory 数据库只有约 20 条 CVE。

对于需要本地安全扫描的开发者而言，这个功能实际上不可用：Advisory 数据库太小无法命中真实依赖，UI 流程可能存在隐性 Bug，也无法作为可演示 / 可交付的功能对外呈现。

## MVP 目标

将漏洞管理模块从"代码完整但未验证"推进到"可演示、可提交"：

- 测试全绿（含新补的存储层与 API 层测试）
- 浏览器流程端到端可跑通
- Advisory 数据库达到实用覆盖（≥ 80 条主流 Java 框架 CVE）
- 文档从"规划中"更新为"已实现"

用户达成以下动作后 MVP 成立：选择项目 → 触发代码扫描 → 查看发现列表 → 将一条发现标记为 CONFIRMED → 触发依赖扫描（若有 pom.xml）→ 生成 Markdown 报告。

## 目标用户

- **主要用户**：本地代码库安全审计者（离线、私有代码库场景）
- **次要用户**：企业内网 DevSecOps 流程中使用 RepoGraph MCP 的 AI 助手

## 解决方案

在现有骨架基础上补全两件事：

1. **质量门禁**：补充 VulnStore、AdvisoryStore、DepsVulnScanner、VulnController 的测试；浏览器验证 Web UI 完整流程。
2. **Advisory 数据库扩充**：将 maven-bundled.json 从 ~20 条扩充到覆盖 Spring、Jackson、Commons、Struts、Log4j、Netty、Shiro 等常见框架的历史高危 CVE（目标 ≥ 80 条）。

不新增任何接口或能力，只让已有能力达到可用状态。

## 用户故事

1. 作为一个安全审计者，我想要在 Web 界面触发代码扫描并查看按严重程度排序的发现列表，以便快速定位高危方法。
2. 作为一个安全审计者，我想要把误报标记为 DISMISSED 并把真实漏洞标记为 CONFIRMED，以便报告中只含有意义的发现。
3. 作为一个安全审计者，我想要查看单条漏洞的调用链影响面，以便评估修复优先级。
4. 作为一个安全审计者，我想要触发依赖扫描并在结果中看到已知 CVE，以便评估 Maven 依赖风险。
5. 作为一个安全审计者，我想要生成 Markdown 格式的漏洞报告并导出，以便分享给团队或存档。

## 范围

### 范围内

- 补充 `VulnStore` 测试（upsert / list / updateStatus / findById / removeProject）
- 补充 `AdvisoryStore` 测试（seeding / findByCoordinate / 重复导入幂等性）
- 补充 `DepsVulnScanner` 测试（版本区间命中 / 测试依赖跳过 / SBOM 解析失败容错）
- 补充 `VulnController` MockMvc 集成测试（scan / list / updateStatus / impact / report 五个端点）
- 浏览器端到端验证 Web UI 完整流程
- `maven-bundled.json` 扩充至 ≥ 80 条 CVE，覆盖 Spring Boot、Spring Security、Jackson、Apache Commons、Struts、Log4j、Netty、Shiro、Hibernate Validator
- 更新 `CONTEXT.md` 和 `README.md` 漏洞管理章节（规划中 → 已实现）
- 更新 `CONTEXT.md` 的 ADR 表格（新增一行：Advisory 数据库 → bundled JSON + SQLite，离线优先）

### 范围外

- 新增扫描规则（9 条当前已足够 MVP）
- GHSA / NVD 在线同步（当前设计为离线优先，不联网）
- CI/CD pipeline 集成
- MCP 工具暴露漏洞扫描能力
- 其他语言（C / Python）的代码漏洞规则

## 实现决策

**主要 Module（只补全，不新增）：**

- `vuln/` — 核心域：VulnFinding、VulnStore、CodeVulnScanner、DepsVulnScanner、AdvisoryStore、SemanticVersion、VulnReport。补测试，不改接口。
- `api/VulnController` — REST 门面。补 MockMvc 测试。
- `resources/advisories/maven-bundled.json` — Advisory 数据。扩充内容，结构不变。
- `CONTEXT.md` / `README.md` — 文档。更新状态描述。

**关键 Interface（已稳定，不变）：**
- `VulnStore.upsertAll / list / updateStatus / findById / removeProject`
- `CodeVulnScanner.scan(projectId) → ScanSummary`
- `DepsVulnScanner.scan(projectId, projectRoot) → ScanSummary`
- `AdvisoryStore.findByCoordinate(groupId, artifactId) → List<Advisory>`
- REST: `POST /api/v1/vulns/scan/code`, `POST /api/v1/vulns/scan/deps`, `GET /api/v1/vulns`, `PUT /api/v1/vulns/{id}/status`, `GET /api/v1/vulns/{id}/impact`, `GET /api/v1/vulns/report/{projectId}`

**数据契约：**
- `maven-bundled.json` 结构不变：`{id, summary, severity, cwe, groupId, artifactId, introduced, fixed}`
- SQLite `vuln_findings` schema 不变
- `VulnFinding` record 字段不变

**架构约束：**
- Advisory 数据库离线优先（不联网），CVE 数据以 JSON 文件随 JAR 打包
- VulnStore 与增量索引共用同一个 `~/.repograph/index.db`，无额外服务依赖
- 测试：VulnStore / AdvisoryStore 测试用临时 SQLite 文件（`tmp`），不依赖外部服务

**已有 ADR 对齐：**
- 增量存储选 SQLite（已有 ADR）：VulnStore 复用同一 db 文件，一致
- 离线优先（已有约束）：Advisory 数据打包为 classpath 资源，不联网

## 测试决策

**关键路径：**
- `CodeVulnScanner.scan` → `VulnStore.upsertAll` → `VulnStore.list` 整条链路
- `DepsVulnScanner.scan` → SBOM 解析 → Advisory 匹配 → VulnStore 写入
- `PUT /api/v1/vulns/{id}/status` 状态机转换（合法 / 非法 status）

**边界行为：**
- `SemanticVersion` 空字符串 / qualifier 版本 / 4 段版本
- `AdvisoryStore` 重复导入时幂等（`INSERT OR IGNORE`）
- `VulnStore.list` severity + status 双过滤
- `DepsVulnScanner` scope=excluded 的测试依赖跳过

**异常行为：**
- SBOM 生成失败（无 pom.xml）→ 返回 ScanSummary(0,0)，不抛异常
- `VulnController.updateStatus` 非法 status → 400 + valid 字段
- `VulnController.impact` 不存在的 id → 404

**可复用测试先例：**
- `CodeVulnScannerRulesTest` 中的 `CapturingVulnStore` / `StubGraphQueryService` 模式可直接复用
- 临时 SQLite 文件模式可参考现有 `IncrementalIndexCacheTest`（如有）

## 风险与开放问题

- **Advisory 覆盖准确性**：手工整理 CVE 数据存在版本区间错误风险 → 以官方 GHSA / NVD 数据为准，添加来源注释
- **DepsVulnScanner 依赖 SbomService**：测试需要 mock `SbomService.generateCycloneDx`，需确认 mock 点是否合适
- **maven-bundled.json 大小**：扩充到 80+ 条后 JSON 文件约 30-50KB，classpath 加载无性能问题
- **UI 测试方式**：计划用浏览器手动验证（非自动化），若发现问题当场修复
