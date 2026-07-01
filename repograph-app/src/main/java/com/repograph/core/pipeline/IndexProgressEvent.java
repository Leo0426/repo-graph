package com.repograph.core.pipeline;

/**
 * 索引进度事件，由 {@code DefaultIndexPipeline} 在关键阶段发布，由
 * {@code IndexController} 监听并转化为 {@code GET /status} 响应中的进度字段。
 *
 * <p>使用 Spring 的 {@code ApplicationEventPublisher} 解耦发布方和消费方，
 * 两个模块（repograph-app / repograph-api）通过 repograph-core 的共享类型进行通信。
 *
 * @param projectRoot 项目根目录绝对路径，作为进度 key 使用
 * @param stage       当前阶段名称，如 {@code "parsing"}、{@code "embedding"}
 * @param done        已完成的单元数（文件数或 CodeUnit 数，依阶段而异）
 * @param total       本阶段总数
 * @author leolu
 * @since 0.4.0
 */
public record IndexProgressEvent(String projectRoot, String stage, int done, int total) {}
