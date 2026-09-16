# RepoGraph Security Showcase

这是只用于 RepoGraph 演示的合成项目，所有漏洞信号均为刻意构造，不应部署或运行。

它包含 Spring 风格入口、三跳调用链、SQL/命令注入 Sink、九类内置代码规则信号、
继承与实现关系、包循环、测试调用、多语言源码、Markdown 文档，
以及带已知 CVE 的 Maven 依赖。

## 安全边界

源码只用于静态分析。演示脚本不会编译或执行其中任何危险方法。
