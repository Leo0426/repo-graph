package com.repograph.core.util;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class ProjectIdUtilTest {

    @Test
    void generateProjectId_returns12Characters() {
        String id = ProjectIdUtil.generateProjectId(Path.of("/home/leolu/projects/myapp"));
        assertNotNull(id);
        assertEquals(12, id.length());
    }

    @Test
    void generateProjectId_samePathProducesSameId() {
        Path path = Path.of("/home/leolu/projects/myapp");
        assertEquals(ProjectIdUtil.generateProjectId(path), ProjectIdUtil.generateProjectId(path));
    }

    @Test
    void generateProjectId_differentPathsProduceDifferentIds() {
        String id1 = ProjectIdUtil.generateProjectId(Path.of("/home/leolu/projects/app1"));
        String id2 = ProjectIdUtil.generateProjectId(Path.of("/home/leolu/projects/app2"));
        assert !id1.equals(id2);
    }

    @Test
    void generateProjectId_resultIsHexadecimal() {
        String id = ProjectIdUtil.generateProjectId(Path.of("/home/leolu/projects/myapp"));
        assertThat(id).matches("[0-9a-f]+");
    }

    @Test
    void generateProjectId_pathWithDotSegment_sameAsNormalized() {
        // /home/leolu/projects/./myapp normalizes to /home/leolu/projects/myapp
        String id1 = ProjectIdUtil.generateProjectId(Path.of("/home/leolu/projects/myapp"));
        String id2 = ProjectIdUtil.generateProjectId(Path.of("/home/leolu/projects/./myapp"));
        assertEquals(id1, id2);
    }
}
