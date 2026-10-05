import org.gradle.api.artifacts.VersionCatalogsExtension

plugins {
    alias(libs.plugins.spring.boot) apply false
    alias(libs.plugins.spring.dep.mgmt) apply false
}

allprojects {
    group = "com.repograph"
    version = "0.5.0"

    repositories {
        mavenCentral()
    }
}

subprojects {
    apply(plugin = "java")
    apply(plugin = "io.spring.dependency-management")

    val libsCatalog = rootProject.extensions.getByType<VersionCatalogsExtension>().named("libs")
    val asmVersion = libsCatalog.findVersion("asm").get().requiredVersion
    val grpcVersion = libsCatalog.findVersion("grpc").get().requiredVersion

    configurations.all {
        resolutionStrategy {
            // SootUp 1.3.0 bundles ASM 9.6 which doesn't support Java 25 class files (major version 69).
            force("org.ow2.asm:asm:$asmVersion")
            force("org.ow2.asm:asm-tree:$asmVersion")
            force("org.ow2.asm:asm-util:$asmVersion")
            force("org.ow2.asm:asm-commons:$asmVersion")
            force("org.ow2.asm:asm-analysis:$asmVersion")
            // Qdrant ships grpc-netty-shaded:1.59.0 but other deps pull grpc-core:1.63.0,
            // causing AbstractMethodError on getSupportedSocketAddressTypes(). Align all gRPC.
            force("io.grpc:grpc-netty-shaded:$grpcVersion")
        }
    }

    dependencies {
        "implementation"("org.slf4j:slf4j-api")
        "testImplementation"("org.junit.jupiter:junit-jupiter")
        "testRuntimeOnly"("org.junit.platform:junit-platform-launcher")
    }

    configure<JavaPluginExtension> {
        toolchain {
            // JDK 22+ required for stable FFM API (JEP 454);
            // use installed JDK 25 for now
            languageVersion.set(JavaLanguageVersion.of(25))
        }
    }

    val springBootVersion = libsCatalog.findVersion("spring-boot").get().requiredVersion
    the<io.spring.gradle.dependencymanagement.dsl.DependencyManagementExtension>().imports {
        mavenBom("org.springframework.boot:spring-boot-dependencies:$springBootVersion")
    }

    tasks.withType<JavaCompile>().configureEach {
        options.compilerArgs.addAll(listOf("-Xlint:all", "-parameters"))
    }

    tasks.withType<Test>().configureEach {
        useJUnitPlatform()
        jvmArgs(
            "--enable-native-access=ALL-UNNAMED",  // Tree-sitter FFM; forked test JVM doesn't inherit gradle.properties
            "-Dnet.bytebuddy.experimental=true"    // Mockito/ByteBuddy workaround for JDK 25
        )
    }
}
