plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.meta.spatial.plugin")
}

val releaseStoreFile = providers.environmentVariable("MXGENIUS_SIGNING_STORE_FILE").orNull
val releaseStorePassword = providers.environmentVariable("MXGENIUS_SIGNING_STORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("MXGENIUS_SIGNING_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("MXGENIUS_SIGNING_KEY_PASSWORD").orNull

android {
    namespace = "io.mxgenius.sensorbridge"
    // FLIR Mobile SDK 2.22.0 publishes API 36 metadata. The Quest runtime target
    // remains Android 14/API 34; compileSdk only controls available build APIs.
    compileSdk = 36

    defaultConfig {
        applicationId = "io.mxgenius.sensorbridge"
        minSdk = 34
        targetSdk = 34
        versionCode = 14
        versionName = "0.1.0-poc.14"
        buildConfigField("String", "FLIR_SDK_VERSION", "\"2.22.0\"")
        ndk { abiFilters += "arm64-v8a" }
    }

    signingConfigs {
        create("release") {
            if (!releaseStoreFile.isNullOrBlank()) {
                storeFile = file(releaseStoreFile)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }

    buildFeatures { buildConfig = true }

    packaging { resources.excludes.add("META-INF/LICENSE") }
}

dependencies {
    implementation("", name = "androidsdk-release", ext = "aar")
    implementation("", name = "thermalsdk-release", ext = "aar")
    implementation("com.squareup.okhttp3:okhttp:5.3.0")
    implementation("org.java-websocket:Java-WebSocket:1.6.0") {
        exclude(group = "org.slf4j", module = "slf4j-api")
    }
    implementation("com.meta.spatial:meta-spatial-sdk:0.13.2")
    implementation("com.meta.spatial:meta-spatial-sdk-toolkit:0.13.2")
    implementation("com.meta.spatial:meta-spatial-sdk-vr:0.13.2")
    implementation("com.meta.spatial:meta-spatial-sdk-isdk:0.13.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
