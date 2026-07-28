package com.repograph.core.authorization;

import java.util.List;

/**
 * Spring HTTP 路由证据。
 *
 * @param path        合并控制器级和方法级路径后的路由
 * @param httpMethods HTTP 方法；无法从注解确认时为空
 * @param handler     处理方法全限定名
 * @param citation    处理方法源码引用
 * @author leolu
 */
public record RouteEvidence(
        String path,
        List<String> httpMethods,
        String handler,
        SourceCitation citation
) {
    /**
     * 创建不可变路由证据。
     */
    public RouteEvidence {
        httpMethods = List.copyOf(httpMethods);
    }
}
