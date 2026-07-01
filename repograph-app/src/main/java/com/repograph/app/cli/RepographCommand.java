package com.repograph.app.cli;

import picocli.CommandLine.Command;

/**
 * RepoGraph 根命令，通过子命令分发所有 CLI 操作。
 *
 * @author leolu
 * @since 0.1.0
 */
@Command(
        name = "repograph",
        mixinStandardHelpOptions = true,
        version = "repograph 0.5.0",
        description = "RepoGraph — 本地代码知识图谱与语义分析工具",
        subcommands = {
            IndexCommand.class,
            SearchCommand.class,
            SymbolCommand.class,
            LocateCommand.class,
            CallersCommand.class,
            CalleesCommand.class,
            ImpactCommand.class,
            SubtypesCommand.class,
            EntryPointsCommand.class,
            ProjectsCommand.class,
            DeleteCommand.class,
            SbomCommand.class,
            ServeCommand.class,
            WatchCommand.class,
            StatsCommand.class,
            VulnCommand.class,
            DeadCodeCommand.class,
            ComplexityCommand.class,
            CouplingCommand.class,
            TestGapCommand.class,
            CyclesCommand.class,
            ReportCommand.class,
            HotspotsCommand.class,
            ExportCommand.class
        }
)
public class RepographCommand implements Runnable {

    @Override
    public void run() {
        // 未指定子命令时打印帮助信息，由 Picocli 框架处理
    }
}
