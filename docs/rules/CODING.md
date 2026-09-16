# RepoGraph Coding

本文件承接原 AGENTS.md 的编码与测试规则；包放置见 [Architecture](../ARCHITECTURE.md)。

## Java

- 缩进 4 空格，行长 120 字符；类 PascalCase，方法/变量 camelCase，常量 UPPER_SNAKE_CASE。
- 包名 `com.repograph.{module}`；Record 优先于 POJO；接口方法不加 `public`。
- 所有 public 类、接口、方法、构造器、字段写 Javadoc；类级别含 `@author leolu`。
- 统一构造器注入，禁止 `@Autowired` 字段注入；多构造器时在注入构造器上标注 `@Autowired`。
- 统一 SLF4J，禁止 `System.out.println`。MCP 的协议 writer 仅用于 JSON-RPC，不作为日志出口。
- Java 类中不硬编码连接地址或端口；运行配置从 `application.yml` 读取。
- 依赖版本只在 `gradle/libs.versions.toml` 定义，Gradle 脚本通过 Version Catalog 引用。
- 嵌套类和匿名类 qualifiedName 使用 `Outer$Inner` 或 `Outer$1_L{startLine}`。

## 测试设计

- 单元测试放各子项目 `src/test/java`；集成测试后缀 `IT`，放 app；测试间不共享可变状态。
- Parser 覆盖正常、语法错误、空文件、嵌套类和 C 指针函数名解包。
- 图测试覆盖 CALLS 正确性、EXTENDS/IMPLEMENTS 分离及 `resolved=false`。
- VectorStore 使用独立测试 collection，测试后清理。
- SBOM 的 Maven/Gradle/npm/pip 分别覆盖，用 `@TempDir` 写 fixture。
- Vuln 覆盖规则命中/不命中和 SUSPECTED→CONFIRMED 状态迁移。

运行命令、环境前提和结果解释统一见 [Validation](../VALIDATION.md)。
