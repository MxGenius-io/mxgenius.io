plugins {
    id("com.android.application") version "8.11.1" apply false
    // Spatial SDK 0.13.2 embeds the Kotlin 2.2 compiler; keep the Gradle plugin aligned.
    id("org.jetbrains.kotlin.android") version "2.2.0" apply false
    id("com.meta.spatial.plugin") version "0.13.2" apply false
}
