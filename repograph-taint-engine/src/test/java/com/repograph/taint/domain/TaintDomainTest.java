package com.repograph.taint.domain;

import com.repograph.taint.api.DomainElementType;
import com.repograph.taint.domain.element.DomainElement;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * IFDS 污点域 {@link TaintDomain} 的事实编号测试。
 * TabulationDomain 负责把 dataflow fact 与整数索引双向映射 —— 这是 tabulation 求解器
 * 在超图上以 bitset 传播事实的基础。ZERO 固定为索引 0。
 */
class TaintDomainTest {

    private static DomainElement fact(int base) {
        return new DomainElement(null, new AccessPath(base, null, null), null,
            DomainElementType.NORMAL, null, null);
    }

    @Test
    void zero_isIndexZero() {
        TaintDomain<IDomainElement> domain = new TaintDomain<>(DomainElement.ZERO);
        assertEquals(1, domain.getSize());
        assertEquals(0, domain.getMaximumIndex());
        assertEquals(0, domain.getMappedIndex(DomainElement.ZERO));
        assertSame(DomainElement.ZERO, domain.getMappedObject(0));
    }

    @Test
    void add_assignsIncrementingIndicesAndRoundTrips() {
        TaintDomain<IDomainElement> domain = new TaintDomain<>(DomainElement.ZERO);
        DomainElement f1 = fact(5);
        DomainElement f2 = fact(6);

        int i1 = domain.add(f1);
        int i2 = domain.add(f2);

        assertEquals(1, i1);
        assertEquals(2, i2);
        assertEquals(3, domain.getSize());
        assertEquals(f1, domain.getMappedObject(i1));
        assertEquals(i2, domain.getMappedIndex(f2));
    }

    @Test
    void add_isIdempotentForEqualFacts() {
        TaintDomain<IDomainElement> domain = new TaintDomain<>(DomainElement.ZERO);
        int first = domain.add(fact(5));
        int second = domain.add(fact(5)); // 值相等的事实

        assertEquals(first, second, "值相等的 fact 应复用同一索引");
        assertEquals(2, domain.getSize(), "重复添加不应增大域");
    }

    @Test
    void hasMappedIndex_reflectsMembership() {
        TaintDomain<IDomainElement> domain = new TaintDomain<>(DomainElement.ZERO);
        DomainElement f1 = fact(5);
        assertFalse(domain.hasMappedIndex(f1));
        domain.add(f1);
        assertTrue(domain.hasMappedIndex(f1));
    }

    @Test
    void isValidIndex_boundsCheck() {
        TaintDomain<IDomainElement> domain = new TaintDomain<>(DomainElement.ZERO);
        domain.add(fact(5)); // size 现在为 2，有效对象索引为 0、1
        assertTrue(domain.isValidIndex(0));
        assertTrue(domain.isValidIndex(1));
        assertFalse(domain.isValidIndex(2), "index==size 越界，应为无效（off-by-one 已修复）");
        assertFalse(domain.isValidIndex(-1));
    }
}
