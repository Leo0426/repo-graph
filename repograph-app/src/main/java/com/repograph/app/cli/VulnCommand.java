package com.repograph.app.cli;

import org.springframework.stereotype.Component;
import picocli.CommandLine.Command;
import picocli.CommandLine.HelpCommand;

/**
 * {@code repograph vuln} 漏洞管理子命令组。
 *
 * <pre>
 * repograph vuln scan-code  &lt;projectId&gt;
 * repograph vuln scan-deps  &lt;projectId&gt; &lt;projectRoot&gt;
 * repograph vuln list       &lt;projectId&gt; [--severity CRITICAL] [--status SUSPECTED]
 * repograph vuln report     &lt;projectId&gt; [--out report.md] [--all]
 * </pre>
 *
 * @author leolu
 * @since 0.5.0
 */
@Command(
    name = "vuln",
    mixinStandardHelpOptions = true,
    description = "漏洞管理：代码规则扫描、依赖 CVE 比对、发现列表与 Markdown 报告",
    subcommands = {
        VulnScanCodeCommand.class,
        VulnScanDepsCommand.class,
        VulnListCommand.class,
        VulnReportCommand.class,
        HelpCommand.class
    }
)
@Component
public class VulnCommand implements Runnable {

    @Override
    public void run() {
        // 未指定子命令时 Picocli 打印用法（由框架处理）
    }
}
