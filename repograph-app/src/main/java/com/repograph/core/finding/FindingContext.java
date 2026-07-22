package com.repograph.core.finding;

import com.repograph.core.retrieval.ContextPack;

/**
 * 单条外部报警的研判上下文，由报警定位结果与可溯源上下文包组成。
 *
 * @param finding               外部报警
 * @param located               是否在索引中定位到报警所在代码单元
 * @param locatedQualifiedName  定位到的代码单元全限定名；未定位到时为空字符串
 * @param pack                  带 citation 的上下文证据包
 * @author leolu
 */
public record FindingContext(
        ExternalFinding finding,
        boolean located,
        String locatedQualifiedName,
        ContextPack pack
) {}
