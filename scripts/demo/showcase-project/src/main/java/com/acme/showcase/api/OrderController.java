package com.acme.showcase.api;

import com.acme.showcase.service.OrderService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.sql.SQLException;
import java.util.List;

/**
 * 支付订单查询 API。演示用户输入从 HTTP 入口，经业务服务流向数据访问层的完整证据链。
 * Payment-order API used to compare vulnerable and parameterized query paths.
 *
 * @author leolu
 */
@RestController
@RequestMapping("/demo/orders")
public class OrderController extends PublicController {

    private final OrderService orderService;

    /**
     * Creates the showcase controller.
     *
     * @param orderService service under analysis
     */
    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    /**
     * 风险路径：未经验证的客户名称经过三跳调用链进入动态 SQL，形成可解释的 SQL 注入证据。
     *
     * @param customer user-controlled customer fragment
     * @return matching rows
     * @throws SQLException when the demo gateway fails
     */
    @GetMapping("/search")
    public List<String> search(@RequestParam String customer) throws SQLException {
        return orderService.searchOrders(customer);
    }

    /**
     * 安全路径：同一业务请求使用参数化查询，作为风险路径的可验证对照组。
     *
     * @param customer user-controlled customer name
     * @return matching rows
     * @throws SQLException when the demo gateway fails
     */
    @GetMapping("/safe-search")
    public List<String> safeSearch(@RequestParam String customer) throws SQLException {
        return orderService.safeSearch(customer);
    }
}

/** Base type used by the subtype graph demo. */
abstract class PublicController {
}
