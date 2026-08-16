pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
        val flirHome = providers.environmentVariable("FLIR_MOBILE_SDK_HOME").orNull
            ?: providers.gradleProperty("flirSdkHome").orNull
            ?: "D:/AAog/Flir-SDK/atlas-java-sdk-android-2.22.0"
        flatDir { dirs(flirHome) }
    }
}

rootProject.name = "MxGeniusFlirCompanion"
include(":app")
