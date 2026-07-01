package com.repograph.core.util;

import com.repograph.core.model.CodeUnitKind;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link CodeUnitIdUtil} 单元测试，验证 SHA-256 ID 生成的确定性、唯一性，
 * 以及多项目隔离（同 file/kind/QN 但不同 projectId 产出不同 id）。
 *
 * @author leolu
 * @since 0.1.0
 */
class CodeUnitIdUtilTest {

    private static final String PID = "proj-aaa";

    @Test
    void computeId_sameInputs_returnsSameId() {
        String id1 = CodeUnitIdUtil.computeId(PID, "Foo.java", CodeUnitKind.CLASS, "com.example.Foo");
        String id2 = CodeUnitIdUtil.computeId(PID, "Foo.java", CodeUnitKind.CLASS, "com.example.Foo");

        assertThat(id1).isEqualTo(id2);
    }

    @Test
    void computeId_differentProjectIds_returnsDifferentId() {
        String id1 = CodeUnitIdUtil.computeId("proj-aaa", "Foo.java", CodeUnitKind.CLASS, "com.example.Foo");
        String id2 = CodeUnitIdUtil.computeId("proj-bbb", "Foo.java", CodeUnitKind.CLASS, "com.example.Foo");

        assertThat(id1).isNotEqualTo(id2);
    }

    @Test
    void computeId_differentFilePaths_returnsDifferentId() {
        String id1 = CodeUnitIdUtil.computeId(PID, "Foo.java", CodeUnitKind.CLASS, "com.example.Foo");
        String id2 = CodeUnitIdUtil.computeId(PID, "Bar.java", CodeUnitKind.CLASS, "com.example.Foo");

        assertThat(id1).isNotEqualTo(id2);
    }

    @Test
    void computeId_differentKinds_returnsDifferentId() {
        String id1 = CodeUnitIdUtil.computeId(PID, "Foo.java", CodeUnitKind.CLASS, "com.example.Foo");
        String id2 = CodeUnitIdUtil.computeId(PID, "Foo.java", CodeUnitKind.METHOD, "com.example.Foo");

        assertThat(id1).isNotEqualTo(id2);
    }

    @Test
    void computeId_differentQualifiedNames_returnsDifferentId() {
        String id1 = CodeUnitIdUtil.computeId(PID, "Foo.java", CodeUnitKind.CLASS, "com.example.Foo");
        String id2 = CodeUnitIdUtil.computeId(PID, "Foo.java", CodeUnitKind.CLASS, "com.example.Bar");

        assertThat(id1).isNotEqualTo(id2);
    }

    @Test
    void computeId_nullProjectId_treatedAsEmpty() {
        String idNull  = CodeUnitIdUtil.computeId(null, "Foo.java", CodeUnitKind.CLASS, "com.example.Foo");
        String idEmpty = CodeUnitIdUtil.computeId("",   "Foo.java", CodeUnitKind.CLASS, "com.example.Foo");

        assertThat(idNull).isEqualTo(idEmpty);
    }

    @Test
    void computeId_returnsHexString() {
        String id = CodeUnitIdUtil.computeId(PID, "Foo.java", CodeUnitKind.CLASS, "com.example.Foo");

        assertThat(id).matches("[0-9a-f]+");
        assertThat(id).hasSize(64); // SHA-256 = 256 bits = 64 hex chars
    }

    @Test
    void computeId_nonNullNonEmpty() {
        String id = CodeUnitIdUtil.computeId(PID, "x.py", CodeUnitKind.FUNCTION, "foo");

        assertThat(id).isNotNull().isNotEmpty();
    }

    /**
     * Regression: prior to this fix, two projects with the same relative file structure
     * produced identical CodeUnit ids. The Neo4j {@code MERGE} (and Qdrant {@code upsert})
     * then treated them as the same node, silently overwriting one project with the other.
     */
    @Test
    void computeId_twoProjectsSameFile_neverCollide() {
        String[] commonPaths = {
            "src/main/java/com/example/Service.java",
            "src/main/java/com/example/Util.java",
            "src/main/python/handler.py"
        };
        for (String path : commonPaths) {
            String idA = CodeUnitIdUtil.computeId("project-aaa", path, CodeUnitKind.CLASS, "com.example.Foo");
            String idB = CodeUnitIdUtil.computeId("project-bbb", path, CodeUnitKind.CLASS, "com.example.Foo");
            assertThat(idA).as("collision on %s", path).isNotEqualTo(idB);
        }
    }
}
