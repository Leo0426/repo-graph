package com.acme.showcase.service;

import com.acme.showcase.gateway.UnsafeGateway;

import java.sql.SQLException;
import java.util.List;

/**
 * 订单检索应用服务。保留 HTTP 参数到数据库网关之间的业务调用边，便于影响面分析。
 *
 * @author leolu
 */
public class OrderService {

    private final UnsafeGateway gateway;

    /**
     * Creates the service.
     *
     * @param gateway database gateway
     */
    public OrderService(UnsafeGateway gateway) {
        this.gateway = gateway;
    }

    /**
     * 将不可信客户名称规范化后传给危险网关；trim 不构成安全净化。
     *
     * @param customer untrusted fragment
     * @return rows
     * @throws SQLException on database failure
     */
    public List<String> searchOrders(String customer) throws SQLException {
        String normalized = customer.trim();
        return gateway.findByCustomer(normalized);
    }

    /**
     * 将客户名称传给参数化查询路径，不参与 SQL 结构拼接。
     *
     * @param customer exact customer name
     * @return rows
     * @throws SQLException on database failure
     */
    public List<String> safeSearch(String customer) throws SQLException {
        return gateway.findByCustomerSafely(customer);
    }
}
