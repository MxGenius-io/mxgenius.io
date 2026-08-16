plugins {
    id("com.android.application")
}

val releaseStoreFile = providers.environmentVariable("MXGENIUS_SIGNING_STORE_FILE").orNull
val releaseStorePassword = providers.environmentVariable("MXGENIUS_SIGNING_STORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("MXGENIUS_SIGNING_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("MXGENIUS_SIGNING_KEY_PASSWORD").orNull

android {
    namespace = "io.mxgenius.sensorbridge"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.mxgenius.sensorbridge"
        minSdk = 33
        targetSdk = 36
        versionCode = 2
        versionName = "0.1.0-poc.2"
        buildToolsVersion = "36.0.0"
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
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    buildFeatures { buildConfig = true }
}

dependencies {
    implementation("", name = "androidsdk-release", ext = "aar")
    implementation("", name = "thermalsdk-release", ext = "aar")
    implementation("com.squareup.okhttp3:okhttp:5.3.0")
}
