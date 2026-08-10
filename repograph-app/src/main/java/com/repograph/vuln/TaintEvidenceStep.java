package com.repograph.vuln;

/**
 * 污染链中的一条可审计源码证据。
 *
 * @param sequence      路径顺序，从 1 开始
 * @param role          步骤角色：SOURCE、PROPAGATION 或 SINK
 * @param methodQn      所在方法全限定名
 * @param fromSlot      污点来源槽位
 * @param toSlot        污点目标槽位
 * @param filePath      源文件相对路径
 * @param startLine     代码单元起始行
 * @param endLine       代码单元结束行
 * @param sourceExcerpt 源码片段；无法定位时为空
 * @author leolu
 */
public record TaintEvidenceStep(
        int sequence,
        String role,
        String methodQn,
        String fromSlot,
        String toSlot,
        String filePath,
        int startLine,
        int endLine,
        String sourceExcerpt
) {
}
