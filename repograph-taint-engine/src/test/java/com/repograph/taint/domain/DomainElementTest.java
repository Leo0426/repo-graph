package com.repograph.taint.domain;

import com.repograph.taint.api.DomainElementType;
import com.repograph.taint.domain.element.DomainElement;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * IFDS 事实 {@link DomainElement} 的单元测试:ZERO 事实、元素类型判定与相等语义。
 * 这些是 tabulation 求解中在超图上传播的 dataflow fact。
 */
class DomainElementTest {

    private static DomainElement element(int base, DomainElementType type) {
        return new DomainElement(null, new AccessPath(base, null, null), null, type, null, null);
    }

    @Test
    void zeroFact_isNormalWithBaseZero() {
        assertNotNull(DomainElement.ZERO);
        assertEquals(0, DomainElement.ZERO.getAccessPath().getBase(), "ZERO 事实的 access path base 为 0");
        assertEquals(DomainElementType.NORMAL, DomainElement.ZERO.getElementType());
        assertFalse(DomainElement.ZERO.isReturnType());
        assertFalse(DomainElement.ZERO.isExceptionType());
    }

    @Test
    void returnType_isReportedCorrectly() {
        DomainElement e = element(3, DomainElementType.RETURN);
        assertTrue(e.isReturnType());
        assertFalse(e.isExceptionType());
        assertEquals(DomainElementType.RETURN, e.getDomainElementType());
    }

    @Test
    void exceptionType_isReportedCorrectly() {
        DomainElement e = element(3, DomainElementType.EXCEPTION);
        assertTrue(e.isExceptionType());
        assertFalse(e.isReturnType());
    }

    @Test
    void equalsAndHashCode_sameContent() {
        DomainElement a = element(7, DomainElementType.NORMAL);
        DomainElement b = element(7, DomainElementType.NORMAL);
        assertEquals(a, b);
        assertEquals(a.hashCode(), b.hashCode());
    }

    @Test
    void notEqual_whenAccessPathDiffers() {
        assertNotEquals(element(7, DomainElementType.NORMAL), element(8, DomainElementType.NORMAL));
    }

    @Test
    void notEqual_whenTypeDiffers() {
        assertNotEquals(element(7, DomainElementType.NORMAL), element(7, DomainElementType.RETURN));
    }

    @Test
    void zero_notEqualToTaintFact() {
        assertNotEquals(DomainElement.ZERO, element(5, DomainElementType.NORMAL));
    }
}
