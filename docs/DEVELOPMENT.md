# RepoGraph Development

## 环境与启动

当前构建 toolchain 是 JDK 25，版本以根 `build.gradle.kts` 为准。用仓库 `./gradlew`，
Gradle 版本以 `gradle/wrapper/gradle-wrapper.properties` 为准；首次执行可能下载分发包和 Maven 依赖。

```bash
docker compose up -d
./gradlew :repograph-app:bootJar :repograph-mcp:bootJar -x test
java --enable-native-access=ALL-UNNAMED -jar repograph-app/build/libs/repograph-app-0.5.0.jar
```

`-x test` 仅用于构建，验证入口见 [Validation](VALIDATION.md)。版本变更后按 `build/libs/` 中实际产物启动。
app 提供 Web/REST，MCP 另行作为 stdio 进程启动，使用 `repograph-mcp-0.5.0-exec.jar`。

## 配置与依赖

- app 配置源：`repograph-app/src/main/resources/application.yml`；MCP 使用自己子项目中的同名配置。
- Qdrant REST 映射到 16333，gRPC 映射到 16334；Java SDK 使用 gRPC。
- Neo4j 的 7474 是浏览器 HTTP，7687 是 Bolt。服务定义与端口以 `docker-compose.yml` 为准。
- Embedding 的模型、向量维度及 collection 必须一起核对 app 配置与已有索引；换模型不要继续向不匹配的 collection 写入。
- LLM 辅助复核使用 Agent 页面保存的运行时 SQLite 设置；YAML 仅作初始默认值。
  这套生成模型设置与检索用的 Embedding 配置不同。
- `quickstart.sh` 会启动容器、轮询服务并构建，不直接启动 Java 服务；具体模型应以 app 配置为准。

## 停止与排障

前台 Java 服务用 Ctrl-C 停止；容器用 `docker compose stop` 停止，查看依赖日志用
`docker compose logs --tail=100 qdrant neo4j`。
MCP 日志在 `~/.repograph/mcp.log`，不会出现在 stdout。
`~/.repograph/` 包含 SQLite、导入源码和运行数据，不是可随意清空的构建缓存；构建输出在子项目 `build/`。

检索故障先核对 REST/gRPC、Embedding 模型/维度/collection 和实际 projectId。
索引及 Agent 运行需检查终态、错误、missingInfo/omittedReasons，不能只看请求已接受。
