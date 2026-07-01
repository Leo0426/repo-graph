## Discovery Brief — 漏洞管理模块 MVP 完成

**Date:** 2026-06-27

Problem:
RepoGraph 已有静态分析基础（SecurityAwareReranker、影响面分析、SBOM 生成），漏洞管理骨架代码也已完整实现，但尚未通过质量门禁（无完整测试覆盖、UI 未端到端验证、Advisory 数据库覆盖不足约 20 条 CVE），无法作为可用功能对外演示或提交。

Target users:
本地代码库安全审计者、需要离线安全扫描的个人开发者 / 企业内网用户。

Current alternatives:
手工 grep 关键词；商业 SAST 工具（需联网 / 有学习曲线）。

Evidence:
- Fact: 后端核心（CodeVulnScanner × 9 规则、DepsVulnScanner、VulnStore、AdvisoryStore、VulnController）编译通过
- Fact: CLI 子命令组（vuln scan-code / scan-deps / list / report）已注册
- Fact: Web UI panel（vulns.html + repograph-vulns.js）存在
- Fact: CodeVulnScannerRulesTest.java 294 行，规则覆盖已测试
- Assumption: Web UI 在浏览器中可正常工作（未实际运行验证）
- Unknown: maven-bundled.json ~20 条 CVE 是否足够让用户有"这个依赖扫描有用"的感受

MVP success metric:
1. `./gradlew test` 全绿，含 VulnStore / AdvisoryStore / VulnController 测试
2. 浏览器端到端跑通：代码扫描 → 查看发现 → 更改状态 → 生成报告
3. maven-bundled.json 扩充至覆盖常见 Java 框架主要 CVE（≥ 80 条）
4. CONTEXT.md / README 漏洞管理章节从"规划中"改为"已实现"

Decision: go

Next step: 生成 PRD → issue-breakdown → 实现
