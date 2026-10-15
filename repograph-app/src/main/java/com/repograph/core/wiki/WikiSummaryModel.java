package com.repograph.core.wiki;

/**
 * 分层摘要的 LLM 模型适配契约（S2）。
 *
 * <p>实现负责读取运行时连接设置并调用模型；输入提示词由调用方完成脱敏与预算裁剪，
 * 输出为自由文本，由调用方做 citation 白名单校验。实现不修改任何启发式事实。
 *
 * @author leolu
 * @since 0.7.0
 */
public interface WikiSummaryModel {

    /**
     * 判断模型通道当前是否可用（设置已启用且连接信息完整）。
     *
     * @return 可用时 {@code true}
     */
    boolean available();

    /**
     * 当前使用的模型名称，用于审计记录。
     *
     * @return 模型名称；通道不可用时返回空字符串
     */
    String model();

    /**
     * 执行一次文本补全。
     *
     * @param systemPrompt 系统提示词（约束输出格式与不可信数据边界）
     * @param userPrompt   用户提示词（已脱敏、已裁剪的事实输入）
     * @return 模型原始输出文本，不为 {@code null}
     * @throws WikiModelException 模型调用失败（网络、超时、无效输出）
     */
    String complete(String systemPrompt, String userPrompt);
}
