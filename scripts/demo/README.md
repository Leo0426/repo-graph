# RepoGraph 全功能演示

主入口：

```bash
./scripts/demo/repograph-demo.sh
```

脚本自动查找仓库根目录对应的 `projectId`，逐段演示：项目发现、四类检索、Context Pack、
符号定位、调用图和影响面、CFG/PDG/污点、代码质量、SBOM、架构评审、三路漏洞扫描、
SAST 研判、反馈与抑制、审核队列、Agent Run、规则生命周期、资产导入与画像、鉴权证据，
以及可用时的 Semgrep 异步扫描。

完整运行会向 RepoGraph 的 SQLite/图/向量运行时存储写入演示记录，但不会修改被索引的源码。
每次响应默认保存在项目同级的 `.repograph-demo-results/<timestamp>/`，避免文件监听器把演示输出
误判为源码变化并触发重索引。脚本也会拒绝指向已索引项目内部的 `--output-dir`。结果目录中的
JSON、Markdown、DOT 和 Mermaid 文件可直接用于讲解。使用 `--read-only` 可只运行查询类能力；使用 `--cleanup-asset` 可在结束时
删除本次导入的托管样例资产。

测试数据：

- `data/semgrep.json`：带 source/sink trace 的 Semgrep 命令注入报警。
- `data/findings.sarif.json`：等价的 SARIF/CodeQL 报警。
- `showcase-project/`：只用于静态分析的合成项目，覆盖九类内置规则、跨过程污点、
  安全对照路径、继承、包循环、Java/C/Python/Markdown 和已知脆弱依赖。
- `UI_DEMO.md`：UI 专用演示手册，提供可直接粘贴的语义查询、qualified name、预期结果和讲解顺序。

先验证脚本与数据契约：

```bash
./scripts/demo/test-demo.sh
```

只验证 UI 演示数据：

```bash
./scripts/demo/test-ui-showcase.sh
```

常用参数：

```bash
./scripts/demo/repograph-demo.sh --read-only --no-asset
./scripts/demo/repograph-demo.sh --base-url http://localhost:18080
./scripts/demo/repograph-demo.sh --cleanup-asset --no-external-scan
```
