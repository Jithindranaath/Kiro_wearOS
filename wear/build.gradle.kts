// Toolchain versions are pinned deliberately:
//   AGP 9.2.1     pairs with Gradle 9.4.1 (see gradle/wrapper/gradle-wrapper.properties)
//   Kotlin 2.4.10 supplies the Compose compiler and serialization plugins
//
// Note: AGP 9 has built-in Kotlin support, so the standalone
// `org.jetbrains.kotlin.android` plugin must NOT be applied.
plugins {
    id("com.android.application") version "9.2.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.10" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.4.10" apply false
}
