package com.repograph.taint.e2e.fixtures;

/**
 * 端到端污点分析的目标 fixture:命令注入(CWE-78)。
 * <p>
 * source 与 sink 均为 JRE 库方法(Primordial 类加载器),与引擎
 * {@code SourceDefinition/SinkDefinition.getMethodReference()} 使用的 Primordial 一致:
 * <ul>
 *   <li>source:{@code System.getenv(String)} 的返回值受污染</li>
 *   <li>sink:{@code Runtime.exec(String)} 的参数 0</li>
 * </ul>
 */
public class CommandInjectionSample {

    /** 有漏洞:环境变量(污点源)未经过滤直接进入命令执行(sink)。 */
    @SuppressWarnings("deprecation")
    public void entry() throws Exception {
        String tainted = System.getenv("USER_INPUT");
        Runtime.getRuntime().exec(tainted);
    }

}
