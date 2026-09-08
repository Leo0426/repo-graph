package com.acme.showcase.gateway;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/**
 * 支付数据库网关。同时保留字符串拼接和参数化查询，
 * 用于直观比较危险 Sink 与安全修复。
 *
 * @author leolu
 */
public class UnsafeGateway {

    private final Connection connection;

    /**
     * Creates the gateway.
     *
     * @param connection demonstration database connection
     */
    public UnsafeGateway(Connection connection) {
        this.connection = connection;
    }

    /**
     * 危险实现：把不可信客户名称拼接进 SQL，并调用 Statement.executeQuery(String)。
     *
     * @param customer untrusted fragment
     * @return rows
     * @throws SQLException on database failure
     */
    public List<String> findByCustomer(String customer) throws SQLException {
        String sql = "select id from orders where customer = '" + customer + "'";
        Statement statement = connection.createStatement();
        ResultSet rows = statement.executeQuery(sql);
        return collect(rows);
    }

    /**
     * 安全实现：SQL 结构固定，客户名称只通过 PreparedStatement 参数绑定。
     *
     * @param customer exact customer name
     * @return rows
     * @throws SQLException on database failure
     */
    public List<String> findByCustomerSafely(String customer) throws SQLException {
        PreparedStatement statement = connection.prepareStatement(
                "select id from orders where customer = ?");
        statement.setString(1, customer);
        return collect(statement.executeQuery());
    }

    /**
     * 危险退款写操作：将用户可控订单编号拼接进 UPDATE，并进入 executeUpdate Sink。
     *
     * @param orderId 用户可控订单编号
     * @return 受影响行数
     * @throws SQLException 数据库访问失败时抛出
     */
    public int refundUnsafe(String orderId) throws SQLException {
        String sql = "update orders set status = 'REFUNDED' where id = '" + orderId + "'";
        return connection.createStatement().executeUpdate(sql);
    }

    /**
     * 安全退款写操作：使用固定 SQL 和参数绑定，阻断订单编号改变查询结构。
     *
     * @param orderId 订单编号
     * @return 受影响行数
     * @throws SQLException 数据库访问失败时抛出
     */
    public int refundSafely(String orderId) throws SQLException {
        PreparedStatement statement = connection.prepareStatement(
                "update orders set status = 'REFUNDED' where id = ?");
        statement.setString(1, orderId);
        return statement.executeUpdate();
    }

    private List<String> collect(ResultSet rows) throws SQLException {
        List<String> result = new ArrayList<>();
        while (rows.next()) {
            result.add(rows.getString(1));
        }
        return result;
    }
}
