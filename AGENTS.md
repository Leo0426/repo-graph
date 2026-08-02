# RepoGraph — Agent Rules

> 本文件是 AI Agent 的行为规范。回答问题前先看 CONTEXT.md 了解项目背景。

## 硬性约束（违反即错）

| 约束 | 原因                                   |
|------|--------------------------------------|
| `repograph-core` 禁止引入第三方依赖 | 领域模型层必须无外部耦合                         |
| 接口定义在 `repograph-core`，实现在子模块，禁止反向依赖 | 依赖方向单向                               |
| `repograph-graph` 不依赖 `repograph-vector` | 图与向量是并列能力，互不知晓                       |
| `CodeUnit` 字段不可随意增删 | 影响 Qdrant payload、SQLite 缓存、Neo4j 节点属性映射的兼容性 |
| `metadata` key 新增必须在 CONTEXT.md 注释说明 | 防止各模块各自为政                            |
| EXTENDS 和 IMPLEMENTS 必须分开存储 | 影响分析时语义不同                            |
| 禁止在 Java 类中硬编码连接地址或端口 | 统一从 `application.yml` 读取             |
| 禁止 `@Autowired` 字段注入，统一构造器注入 | Spring 规范，便于测试                       |
| 禁止 `System.out.println`，统一用 SLF4J | 日志规范                                 |
| 多构造器时必须在注入构造器上加 `@Autowired` | 消除 Spring AOT 歧义                     |
| `repograph-mcp` 禁止任何代码向 stdout 写非 JSON-RPC 内容 | stdout 是 MCP 传输通道，污染会导致协议解析失败 |

## 代码风格

- 缩进 4 空格，行长 120 字符
- 类 PascalCase，方法/变量 camelCase，常量 UPPER_SNAKE_CASE
- 包名 `com.repograph.{module}`
- Record 优先于 POJO；接口方法不加 `public`
- 所有 `public` 类/接口/方法/构造器/字段必须有 Javadoc，类级别含 `@author leolu`

## 错误处理规则

- JavaParser 解析失败 → log WARN，跳过文件，不中断索引
- Tree-sitter native lib 加载失败 → log ERROR，跳过该语言，不崩溃
- Tree-sitter 单文件异常 → 降级启发式解析，记录日志
- 调用目标无法解析 → `resolved=false`，不建 CALLS 边入图
- 图单条边失败 → log WARN，跳过该边
- 嵌套类/匿名类 qualifiedName → `Outer$Inner` 或 `Outer$1_L{startLine}`

## 测试规则

- 单元测试放各模块 `src/test/java`；集成测试类名后缀 `IT`，放 `repograph-app`
- Parser 测试必须覆盖：正常文件、语法错误文件、空文件、嵌套类、C 指针函数名解包
- 图测试必须覆盖：CALLS 边正确性、EXTENDS/IMPLEMENTS 分开存储、`resolved=false` 标记
- VectorStore 测试用独立 collection（如 `code_units_test`），测试后清理
- SBOM 测试每种构建系统（Maven / Gradle / npm / pip）独立覆盖，用 `@TempDir` 写 fixture
- Vuln 测试必须覆盖：规则命中 + 规则不命中两种路径；状态机流转（SUSPECTED→CONFIRMED）
- 禁止测试间共享可变状态

## 构建与运行

```bash
./gradlew build -x test   # 快速构建
./gradlew test            # 跑测试
java --enable-preview --enable-native-access=ALL-UNNAMED \
  -jar repograph-app/build/libs/repograph-app-0.5.0.jar
```

## 版本管理

所有依赖版本只在 `gradle/libs.versions.toml` 中定义，子模块通过 Version Catalog 引用，禁止在 `build.gradle.kts` 中写裸版本号。

## Agent skills

### Issue tracker
Issues 和 PRD 作为 markdown 文件存放在 `.scratch/` 目录下。见 `docs/agents/issue-tracker.md`。
### Triage labels
使用 ForgeFlow 规范的六个 label 字符串（needs-triage / ready-for-agent / resolved 等）。见 `docs/agents/triage-labels.md`。
### Domain docs
单一上下文：根目录 `CONTEXT.md` 为完整上下文，架构决策内联在其末尾的表格中（无独立 ADR 目录）。见 `docs/agents/domain.md`。

## 新模块约束

| 约束 | 原因 |
|------|------|
| `VulnFinding` 创建时 status 必须为 `SUSPECTED` | 防止自动误报进入报告 |
| `TaintVulnScanner` Callee 解析按简单名匹配，存在多重载时全部展开 | Flow-insensitive，宁多报不漏报 |
| `ComplexityAnalyzer` 基于 rawSource 字符串统计，非 AST 精确值 | 可接受误差，不应用于严格门禁 |
| `MarkdownDocParser` 生成的 DOCUMENT CodeUnit 不建 CALLS 边 | Markdown 无调用语义 |
| `GraphExportService` 只做包级聚合，不暴露方法级依赖 | 避免图过大无法渲染 |

## 已知局限（记录，不修复）

- 无完整 classpath，外部依赖源码缺失时调用目标解析失败
- Lombok / annotation processor 生成代码不可靠
- 反射、动态代理调用无法静态追踪
- C 预处理器宏展开不做，条件编译不按 build config 选择
- C 函数指针调用无法精确解析
- `TaintVulnScanner` 为 flow-insensitive 保守近似，Callee 按简单名匹配可多展开
- `ComplexityAnalyzer` / `CouplingAnalyzer` 为启发式估算，注释中的关键字可产生少量误计
