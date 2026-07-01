# 任务清单：漏洞管理 MVP 完成

> 来源：`prd-vuln-mvp.md`  
> 生成时间：2026-06-27  
> 背景：漏洞管理后端/CLI/UI 骨架已完整实现并编译通过，本轮目标是补测试、扩数据、验 UI、更新文档，将模块推进到可提交状态。

---

## 任务拆分

### T-1 VulnStore + AdvisoryStore SQLite 层测试

类型：AFK  
被阻塞于：无  
覆盖用户故事：存储层正确性保障（支撑 T-2、T-3）

要构建什么：为 `VulnStore` 和 `AdvisoryStore` 补充单元测试，使用 `super(":memory:")` 跑内存 SQLite（与 `CapturingVulnStore` 已有模式一致），覆盖所有公开方法，无需 Neo4j / 外部服务。

验收标准：
- [ ] `VulnStoreTest`：upsertAll 写入并可 list 读出；重复 upsert 保留 status（CONFIRMED 不被覆盖）；updateStatus 合法/非法路径；findById 存在/不存在；removeProject 后 list 返回空
- [ ] `AdvisoryStoreTest`：initTable 幂等；importAdvisories 跳过重复（INSERT OR IGNORE）；findByCoordinate 匹配 groupId+artifactId；listAll 返回全部
- [ ] `./gradlew :repograph-app:test --tests "*.vuln.VulnStoreTest" --tests "*.vuln.AdvisoryStoreTest"` 全绿

验证方式：
- 直接运行上述 Gradle 命令

---

### T-2 DepsVulnScanner 扫描链路测试

类型：AFK  
被阻塞于：无（可与 T-1 并行）  
覆盖用户故事：依赖漏洞扫描链路正确性

要构建什么：为 `DepsVulnScanner` 补充单元测试，使用 mock `SbomService`（注入预设 CycloneDX JSON 字符串）+ 内存 `AdvisoryStore`（`:memory:`）+ `CapturingVulnStore`，覆盖版本区间命中、测试依赖跳过、SBOM 解析失败容错三条路径。不依赖外部服务和 pom.xml 文件。

验收标准：
- [ ] `DepsVulnScannerTest`：版本在 `introduced..fixed` 区间内 → finding 写入
- [ ] 版本 >= fixed → 不写入 finding
- [ ] `scope=excluded` 的组件跳过
- [ ] SbomService 抛异常 → 返回 `ScanSummary(0, 0)`，不向上传播
- [ ] `./gradlew :repograph-app:test --tests "*.vuln.DepsVulnScannerTest"` 全绿

验证方式：
- 直接运行上述 Gradle 命令

---

### T-3 VulnController MockMvc 集成测试

类型：AFK  
被阻塞于：无（可与 T-1、T-2 并行）  
覆盖用户故事：REST API 端点正确性

要构建什么：用 `@WebMvcTest(VulnController.class)` + `@MockBean` 模式（参照 `GraphControllerTest`）为 VulnController 的 6 个端点补充 MockMvc 测试，覆盖正常路径和关键异常路径，无需启动完整 Spring 应用。

验收标准：
- [ ] `POST /api/v1/vulns/scan/code?projectId=p1` → 200，body 含 `scannedUnits`/`newFindings`
- [ ] `POST /api/v1/vulns/scan/code` 无 projectId → 400
- [ ] `POST /api/v1/vulns/scan/deps?projectId=p1&projectRoot=/tmp/x` → 200
- [ ] `GET /api/v1/vulns?projectId=p1` → 200，body 是 JSON 数组
- [ ] `PUT /api/v1/vulns/{id}/status?status=CONFIRMED` → 200，返回 `{id, status}`
- [ ] `PUT /api/v1/vulns/{id}/status?status=INVALID` → 400，body 含 `valid` 字段
- [ ] `PUT /api/v1/vulns/{nonexistent}/status?status=FIXED` → 404
- [ ] `GET /api/v1/vulns/{id}/impact` 存在 → 200，`{id}/impact` 不存在 → 404
- [ ] `GET /api/v1/vulns/report/p1` → 200，body 含 `totalFindings`/`bySeverity`/`byStatus`
- [ ] `./gradlew :repograph-app:test --tests "*.api.VulnControllerTest"` 全绿

验证方式：
- 直接运行上述 Gradle 命令

---

### T-4 maven-bundled.json Advisory 数据库扩充

类型：AFK  
被阻塞于：无（可与 T-1、T-2、T-3 并行）  
覆盖用户故事：依赖扫描能命中常见 Java 框架真实 CVE

要构建什么：将 `resources/advisories/maven-bundled.json` 从当前 20 条扩充到 ≥ 80 条，补充以下 groupId 的主要高危历史 CVE，以 GHSA / NVD 官方版本区间为准：

| 补充域 | 典型目标 |
|--------|---------|
| `io.netty` | Netty HTTP/2 HPACK OOM、Denial-of-Service 系列 |
| `org.hibernate.validator` | Expression Language 注入（CVE-2012-4431 等） |
| `com.alibaba` (fastjson) | 反序列化 RCE 系列（CVE-2022-25845 等） |
| `com.thoughtworks.xstream` | 任意代码执行系列 |
| `org.yaml` (snakeyaml) | 反序列化 DoS / RCE |
| `org.apache.tomcat` / `org.apache.tomcat.embed` | Ghostcat（CVE-2020-1938）、HTTP/2 DoS 等 |
| `org.apache.commons` (补漏) | Commons Text（CVE-2022-42889 Text4Shell）、Commons FileUpload |
| `org.springframework` (补漏) | Spring4Shell（CVE-2022-22965）、Spring Cloud Gateway RCE |
| `ch.qos.logback` | JNDI 注入（CVE-2021-42550） |
| `org.eclipse.jetty` | HTTP 请求走私系列 |

条目结构不变：`{id, summary, severity, cwe, groupId, artifactId, introduced, fixed}`

验收标准：
- [ ] `maven-bundled.json` 条目数 ≥ 80，JSON 格式合法（`python3 -m json.tool` 验证）
- [ ] 每条记录 id / groupId / artifactId / severity 均非空
- [ ] 补充条目的 `introduced` / `fixed` 与 NVD / GHSA 官方数据一致（有据可查）
- [ ] `./gradlew :repograph-app:test --tests "*.vuln.AdvisoryStoreTest"` 仍全绿（结构未破坏）

验证方式：
- `python3 -m json.tool repograph-app/src/main/resources/advisories/maven-bundled.json > /dev/null`
- `python3 -c "import json; d=json.load(open('...')); print(len(d))"`

---

### T-5 浏览器 E2E 验证 + 文档更新

类型：HITL（浏览器操作）+ AFK（文档）  
被阻塞于：T-1、T-2、T-3 全绿（测试通过），T-4 完成（数据可用）  
覆盖用户故事：端到端流程可用、文档状态准确

要构建什么：
1. 启动 RepoGraph 服务，在浏览器中执行完整漏洞管理流程并修复发现的 UI/前端问题
2. 通过验证后，更新 `CONTEXT.md` 和 `README.md`，将漏洞管理从"规划中"改为"已实现"，并在 CONTEXT.md ADR 表格中补充 Advisory 存储决策

HITL 阻塞点：需要人工在浏览器中操作并判断 UI 行为是否符合预期。

验收标准：
- [ ] 漏洞面板可切换，项目选择器有数据
- [ ] 点击"代码扫描" → 扫描完成，发现列表出现
- [ ] 过滤器（severity / status）生效
- [ ] 点击发现行的状态下拉 → PUT 请求成功，状态更新显示
- [ ] "查看影响面"弹出影响面列表（或空列表不报错）
- [ ] 点击"生成报告" → 弹出 Markdown 报告内容可读
- [ ] 若有 pom.xml 的项目：依赖扫描可触发并返回结果
- [ ] `README.md` 漏洞管理章节状态标注从"规划中"改为"已实现"
- [ ] `CONTEXT.md` ADR 表格新增 Advisory 数据库决策行

验证方式：
- 人工浏览器操作 + Chrome 开发者工具 Network 面板确认各请求返回正常状态码

---

## 推荐执行顺序

```
并行执行（无依赖关系）：
  T-1  VulnStore + AdvisoryStore 测试
  T-2  DepsVulnScanner 测试
  T-3  VulnController MockMvc 测试
  T-4  Advisory DB 扩充

串行在最后：
  T-5  浏览器 E2E 验证 + 文档更新    ← 等 T-1/T-2/T-3/T-4 全部完成
```

所有任务完成后：提交本轮变更为一个 commit，版本升到 0.5.0。

---

## 完成信号

`./gradlew :repograph-app:test` 全绿（含 T-1/T-2/T-3 新增测试），`maven-bundled.json` ≥ 80 条，浏览器 E2E 无阻断性 Bug，文档状态更新完毕。
