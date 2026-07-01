package com.repograph.framework;

import com.repograph.core.model.CodeUnit;

import java.util.Map;

/**
 * 框架识别接口，通过注解字符串匹配为代码单元添加框架相关的元数据标记。
 *
 * <p>识别结果为启发式标记，不做 classpath 验证；覆盖约 80% 的常见框架使用场景。
 *
 * @author leolu
 * @since 0.1.0
 */
public interface FrameworkDetector {

    /**
     * 分析代码单元的注解，返回需要写入 {@link CodeUnit#metadata()} 的键值对。
     *
     * <p>典型返回示例：{@code {"framework": "spring"}} 或 {@code {"framework": "jaxrs"}}。
     * 无法识别任何框架时返回空 Map，不返回 {@code null}。
     *
     * @param unit 待检测的代码单元，不为 {@code null}
     * @return 需要合并进 metadata 的键值对，不为 {@code null}；无匹配时返回空 Map
     */
    Map<String, String> detect(CodeUnit unit);
}
