plugins {
    id("org.springframework.boot")
    id("io.spring.dependency-management")
}

springBoot {
    buildInfo()
}

dependencies {
    // Spring Boot
    implementation("org.springframework.boot:spring-boot-starter")
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-thymeleaf")

    // CLI
    implementation(libs.picocli.spring)

    // Storage
    implementation(libs.sqlite.jdbc)
    implementation(libs.neo4j.driver)
    implementation(libs.jackson.databind)
    implementation(libs.commons.compress)

    // Parser — AST (JavaParser) + bytecode (SootUp) + tree-sitter
    implementation(libs.javaparser)
    implementation(libs.sootup.core)
    implementation(libs.sootup.java.core)
    implementation(libs.sootup.java.bytecode)
    implementation(libs.treesitter)
    implementation(libs.treesitter.c)
    implementation(libs.treesitter.python)

    // Vector store
    implementation(libs.qdrant)
    implementation(libs.protobuf.java)  // Qdrant gRPC API exposes protobuf MessageOrBuilder at compile time

    // Report PDF export — Markdown → HTML (flexmark) → PDF (openhtmltopdf on PDFBox)
    implementation(libs.flexmark)
    implementation(libs.openhtmltopdf.pdfbox)

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation(libs.neo4j.harness)
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

// Forward benchmark.* system properties to the test JVM.
// Uses providers.systemProperty() so the configuration cache is correctly
// invalidated when any of these values change between runs.
tasks.named<Test>("test") {
    listOf(
        "benchmark.projectRoot",
        "benchmark.qdrant.host", "benchmark.qdrant.port",
        "benchmark.qdrant.collection", "benchmark.qdrant.vectorSize",
        "benchmark.ollama.url", "benchmark.ollama.model", "benchmark.ollama.timeout"
    ).forEach { key ->
        val value = providers.systemProperty(key)
        if (value.isPresent) systemProperty(key, value.get())
    }
}
