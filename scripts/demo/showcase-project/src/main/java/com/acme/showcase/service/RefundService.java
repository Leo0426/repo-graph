package com.acme.showcase.service;

import com.acme.showcase.gateway.UnsafeGateway;

import java.sql.SQLException;

/**
 * 退款应用服务。连接 HTTP 鉴权证据与数据库资源访问证据。
 *
 * @author leolu
 */
public class RefundService {

    private final UnsafeGateway gateway;

    /**
     * 创建退款服务。
     *
     * @param gateway 支付数据库网关
     */
    public RefundService(UnsafeGateway gateway) {
        this.gateway = gateway;
    }

    /**
     * 执行缺少鉴权保护的危险退款路径。
     *
     * @param orderId 用户可控订单编号
     * @return 受影响行数
     * @throws SQLException 数据库访问失败时抛出
     */
    public int executeRefund(String orderId) throws SQLException {
        return gateway.refundUnsafe(orderId);
    }

    /**
     * 执行经过角色鉴权且参数化的退款路径。
     *
     * @param orderId 订单编号
     * @return 受影响行数
     * @throws SQLException 数据库访问失败时抛出
     */
    public int executeApprovedRefund(String orderId) throws SQLException {
        return gateway.refundSafely(orderId);
    }
}
