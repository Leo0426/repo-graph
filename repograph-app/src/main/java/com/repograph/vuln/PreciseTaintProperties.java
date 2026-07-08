package com.repograph.vuln;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 精确污点扫描(方案 A:独立进程引擎)配置。
 * <p>
 * repograph-app 运行在 JDK 25(FFM/tree-sitter),而 WALA IFDS 引擎需要带 jmods 的 JDK。
 * 故引擎以独立进程方式运行:app 用 {@link #javaHome} 指定的 JDK(如 21)启动引擎发行版
 * {@link #engineLibDir}/* 中的 TaintScanCli,读取其 JSON 输出并映射为漏洞发现。
 */
@ConfigurationProperties(prefix = "repograph.taint.precise")
public class PreciseTaintProperties {

    /** 是否启用精确污点扫描(需先配置好 javaHome 与 engineLibDir)。 */
    private boolean enabled = false;

    /** 运行引擎的 JDK 主目录(必须带 jmods,建议 JDK 21 LTS)。 */
    private String javaHome = "";

    /** 引擎发行版 lib 目录(installDist 产物:build/install/repograph-taint-engine/lib)。 */
    private String engineLibDir = "";

    /** 可选:WALA 排除文件路径;为空则用引擎打包的默认排除。 */
    private String exclusions = "";

    /** 子进程超时(秒)。 */
    private long timeoutSeconds = 600;

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }

    public String getJavaHome() { return javaHome; }
    public void setJavaHome(String javaHome) { this.javaHome = javaHome; }

    public String getEngineLibDir() { return engineLibDir; }
    public void setEngineLibDir(String engineLibDir) { this.engineLibDir = engineLibDir; }

    public String getExclusions() { return exclusions; }
    public void setExclusions(String exclusions) { this.exclusions = exclusions; }

    public long getTimeoutSeconds() { return timeoutSeconds; }
    public void setTimeoutSeconds(long timeoutSeconds) { this.timeoutSeconds = timeoutSeconds; }
}
