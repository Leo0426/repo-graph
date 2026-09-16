package com.repograph.app.config;

import com.repograph.core.agent.AgentRunRepository;
import com.repograph.asset.ImportedAssetStore;
import com.repograph.scanner.ScanTaskStore;
import com.repograph.app.pipeline.IndexHistoryStore;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import java.time.Clock;

/**
 * 单应用进程启动时协调未完成任务；保留证据，不自动重放有副作用的操作。
 * 同一个运行数据库只能由一个 app 进程拥有。
 *
 * @author leolu
 */
@Component
public class InterruptedTaskRecovery {
    private static final Logger log = LoggerFactory.getLogger(InterruptedTaskRecovery.class);
    private final AgentRunRepository agents;
    private final ScanTaskStore scans;
    private final IndexHistoryStore indexes;
    private final Clock clock;
    private final ImportedAssetStore assets;

    /**
     * 创建启动恢复协调器。
     * @param agents Agent 运行存储
     * @param scans 扫描任务存储
     * @param indexes 索引运行历史
     * @param assets 托管资产索引状态
     * @param clock 恢复时间
     */
    public InterruptedTaskRecovery(AgentRunRepository agents, ScanTaskStore scans, IndexHistoryStore indexes,
                                   ImportedAssetStore assets, @Qualifier("agentClock") Clock clock) {
        this.agents = agents;
        this.scans = scans;
        this.indexes = indexes;
        this.clock = clock;
        this.assets = assets;
    }

    /** 在接收请求前终止上一个进程遗留的自动任务。 */
    @PostConstruct
    public void recover() {
        String now = clock.instant().toString();
        int agentCount = agents.recoverInterrupted(now);
        int scanCount = scans.recoverInterrupted(now);
        int indexCount = indexes.recoverInterrupted();
        int assetCount = assets.recoverInterrupted(now);
        log.info("Recovered interrupted tasks: agents={}, scans={}, indexes={}, assets={}",
                agentCount, scanCount, indexCount, assetCount);
    }
}
