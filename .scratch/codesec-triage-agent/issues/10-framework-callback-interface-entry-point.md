Status: resolved

# 入口点检测漏掉框架回调接口方法

## 背景

第四轮验证针对性压测第 2 轮遗留的已知缺口之一："入口点识别只覆盖注解式框架入口
（`@RequestMapping` 等），不覆盖实现框架回调接口这一类入口"。没有另外找新项目——
WebGoat（第 3 轮已索引）本身就有现成的真实反例：

- `org.owasp.webgoat.container.UserInterceptor implements HandlerInterceptor`
  （Spring MVC 拦截器，由 `MvcConfiguration#addInterceptors` 注册，`preHandle`/`postHandle`/
  `afterCompletion` 由 DispatcherServlet 对**每个**匹配路径的请求直接调用）
- `org.owasp.webgoat.lessons.hijacksession.cas.HijackSessionAuthenticationProvider
  implements AuthenticationProvider<Authentication>`

用 `lookup_symbol`/`search_keyword` 核实：`UserInterceptor#preHandle` 的 metadata 里
**没有 `is_entry_point`**，`find_callers` 也确实是空——它是比大多数 `@RequestMapping` 方法
覆盖面更广的入口（拦截所有匹配路径），却在系统里被当成"完全不可达"的普通方法。
`postHandle` 里还真的做了敏感操作（把 OAuth client id 写进每个请求的 model）。

## 根因

`ENTRY_POINT_ANNOTATIONS`（`repograph-app/src/main/java/com/repograph/parser/java/JavaParserHelpers.java`）
只是一份硬编码的注解名集合（`@RestController`/`@RequestMapping`/JAX-RS 等）。方法只要不带
这些注解，无论它是否在实现一个框架已知会主动回调的接口（`HandlerInterceptor`、
`AuthenticationProvider`、Servlet `Filter` 等），都不会被标记为入口点。

## 修复

- `JavaParserHelpers` 新增 `FRAMEWORK_CALLBACK_INTERFACES`：一组框架回调接口简单类型名
  （`Filter`、`HandlerInterceptor`、`AuthenticationProvider`、`AuthenticationEntryPoint`、
  `AuthenticationFailureHandler`、`AuthenticationSuccessHandler`、`AccessDeniedHandler`、
  `LogoutHandler`、`LogoutSuccessHandler`、`UserDetailsService`、`AuthenticationManager`、
  JAX-RS `ContainerRequestFilter`/`ContainerResponseFilter`/`ExceptionMapper`）。
- `JavaParseContext` 新增 `classImplementsCallbackInterface: Map<FQN, Boolean>`，在
  `visit(ClassOrInterfaceDeclaration)` 解析 `implements` 子句时按简单类型名匹配填充。
- `visit(MethodDeclaration)` 里补一条规则：方法带 `@Override` 且所属类实现了已知回调接口时，
  标记 `is_entry_point=true`（启发式匹配同一个类里的普通 `@Override` 辅助方法也会被覆盖到，
  但实测这类类里的非回调辅助方法本身通常不带 `@Override`，误标风险低；对比"漏判真实入口"
  这个更严重的问题，这个方向的不精确是可接受的，符合仓库里"宁多报不漏报"的一贯取舍）。

## 验收标准

- [x] 真实样本复现：WebGoat `UserInterceptor#preHandle`（`find_callers` 为空、无
      `is_entry_point`）
- [x] 新增单测 `parse_frameworkCallbackInterfaceOverride_marksEntryPoint`
      （`repograph-app/src/test/java/com/repograph/parser/java/JavaCodeParserTest.java`），
      同时验证同类里的普通 private 方法不会被误标
- [x] `./gradlew :repograph-app:test` 全量回归通过
- [x] 删除并重新索引 WebGoat 后核实：`preHandle`/`postHandle`/`afterCompletion` 均正确标记
      `is_entry_point=true`；同项目里不实现回调接口的普通配置方法（`MvcConfiguration#addInterceptors`）
      未被误标
- [x] 重跑第 3 轮同一批 47 条报警：判定分布不变（35 TRUE_RISK / 9 NEEDS_REVIEW /
      3 LIKELY_FALSE_POSITIVE），确认修复不影响已验证过的既有判断，无回归

## 完成记录

- `JavaParserHelpers` 新增 `FRAMEWORK_CALLBACK_INTERFACES` 常量集合
- `JavaParseContext` 新增 `classImplementsCallbackInterface` map
- `JavaTypeVisitor` 在 `visit(ClassOrInterfaceDeclaration)` 填充该 map，在
  `visit(MethodDeclaration)` 补充 `@Override` + 回调接口的入口点兜底判断
- 新增回归测试，复用 WebGoat 真实反例验证

## 相关但本次未处理（记录，供后续参考）

- 第 2 轮遗留的另一个缺口——依赖注入构造的 bean 无显式 `new X()` 调用点——本轮没有专门验证，
  下一轮可以直接查 `HijackSessionAuthenticationProvider`（`@Component`）的构造方法调用方
  （已确认为空）作为已知反例起点。
- 本次只覆盖 Spring MVC/Security + JAX-RS 的常见回调接口，未覆盖 MyBatis、gRPC 拦截器等其他
  框架的回调接口，遇到新框架时需要按同样模式扩充 `FRAMEWORK_CALLBACK_INTERFACES`。
