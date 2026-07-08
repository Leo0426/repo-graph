package com.repograph.taint.domain;

import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.TypeReference;
import com.ibm.wala.core.util.strings.Atom;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * IFDS 域模型 {@link AccessPath} 的单元测试:字段敏感性、深度截断、访问路径变换与相等语义。
 * 不依赖 WALA 调用图 —— 仅用 WALA 纯类型对象（TypeReference/FieldReference）。
 */
class AccessPathTest {

    private static FieldReference field(String name) {
        TypeReference owner = TypeReference.findOrCreate(ClassLoaderReference.Application, "Lcom/example/Foo");
        TypeReference type = TypeReference.findOrCreate(ClassLoaderReference.Application, "Ljava/lang/String");
        return FieldReference.findOrCreate(owner, Atom.findOrCreateAsciiAtom(name), type);
    }

    @Test
    void localBase_isLocalNotStatic() {
        AccessPath ap = new AccessPath(5, null, null);
        assertTrue(ap.isLocal(), "base>0 且无字段 => 局部变量");
        assertFalse(ap.isStatic());
        assertEquals(5, ap.getBase());
        assertEquals(0, ap.getFieldLength());
    }

    @Test
    void staticBase_isStatic() {
        AccessPath ap = new AccessPath(-1, null, null);
        assertTrue(ap.isStatic(), "base==-1 => 静态字段");
        assertFalse(ap.isLocal());
    }

    @Test
    void baseWithFields_isNotLocal() {
        AccessPath ap = new AccessPath(5, List.of(field("f1")), null);
        assertFalse(ap.isLocal(), "有字段则不是纯局部变量");
        assertEquals(1, ap.getFieldLength());
    }

    @Test
    void fieldDepth_isTruncatedToMax() {
        List<FieldReference> deep = List.of(field("a"), field("b"), field("c"), field("d"), field("e"));
        AccessPath ap = new AccessPath(3, deep, null);
        assertEquals(3, ap.getFieldLength(), "字段深度应被截断到 maxFieldDepth=3");
        assertEquals("a", ap.getFirstField().getName().toString());
    }

    @Test
    void baseType_nullNode_returnsNull() {
        AccessPath ap = new AccessPath(2, null, null);
        assertEquals(TypeReference.Null, ap.getBaseType(), "无 CGNode 时 baseType 退化为 TypeReference.Null");
    }

    @Test
    void appendAndCutFields_areNonMutating() {
        AccessPath ap = new AccessPath(1, List.of(field("f1")), null);

        List<FieldReference> prepended = ap.appendFirstField(field("head"));
        assertEquals(2, prepended.size());
        assertEquals("head", prepended.get(0).getName().toString());

        List<FieldReference> appended = ap.appendLastField(field("tail"));
        assertEquals(2, appended.size());
        assertEquals("tail", appended.get(1).getName().toString());

        // 原对象不受影响
        assertEquals(1, ap.getFieldLength());

        List<FieldReference> cut = ap.cutFirstField();
        assertTrue(cut.isEmpty(), "单字段路径去掉首字段后为空");
    }

    @Test
    void cutFirstField_onEmpty_returnsEmpty() {
        AccessPath ap = new AccessPath(1, null, null);
        assertTrue(ap.cutFirstField().isEmpty());
    }

    @Test
    void equalsAndHashCode_sameContent() {
        AccessPath a = new AccessPath(5, List.of(field("f1")), null);
        AccessPath b = new AccessPath(5, List.of(field("f1")), null);
        assertEquals(a, b);
        assertEquals(a.hashCode(), b.hashCode());
    }

    @Test
    void equals_distinctBase() {
        assertNotEquals(new AccessPath(5, null, null), new AccessPath(6, null, null));
    }

    @Test
    void clone_equalsOriginal() {
        AccessPath a = new AccessPath(5, List.of(field("f1"), field("f2")), null);
        AccessPath c = a.clone();
        assertNotSame(a, c, "clone 应返回新实例");
        assertEquals(a, c);
    }
}
