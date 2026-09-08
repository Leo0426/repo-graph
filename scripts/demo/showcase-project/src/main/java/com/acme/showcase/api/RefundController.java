package com.acme.showcase.api;

import com.acme.showcase.service.RefundService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.sql.SQLException;

/**
 * 退款审批 API。用两个结构相同的端点展示“缺少鉴权”和“角色鉴权”之间的安全差异。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/demo/refunds")
public class RefundController extends PublicController {

    private final RefundService refundService;

    /**
     * 创建退款控制器。
     *
     * @param refundService 退款应用服务
     */
    public RefundController(RefundService refundService) {
        this.refundService = refundService;
    }

    /**
     * 风险端点：未经授权的退款请求可直接触达数据库写操作，适合展示缺失鉴权证据。
     *
     * @param orderId 用户可控的订单编号
     * @return 受影响的订单数
     * @throws SQLException 数据库访问失败时抛出
     */
    @PostMapping("/unsafe")
    public int refundWithoutAuthorization(@RequestParam String orderId) throws SQLException {
        return refundService.executeRefund(orderId);
    }

    /**
     * 安全端点：仅财务管理员可发起退款，并使用参数化数据库更新。
     *
     * @param orderId 待退款的订单编号
     * @return 受影响的订单数
     * @throws SQLException 数据库访问失败时抛出
     */
    @PreAuthorize("hasRole('FINANCE_ADMIN')")
    @PostMapping("/approved")
    public int refundWithFinanceRole(@RequestParam String orderId) throws SQLException {
        return refundService.executeApprovedRefund(orderId);
    }
}
