plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ai.wisp.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.bubbleai.android"
        minSdk = 26
        targetSdk = 35
        // release builds get these from the tag (see .github/workflows/android-release.yml)
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("versionName") as String?) ?: "0.1.0"
    }

    // A real release key when the build is given one (CI decodes the ANDROID_KEYSTORE_BASE64 secret, see
    // .github/workflows/android-release.yml); otherwise release builds are signed with the debug key so testers
    // can still sideload them.
    val keystore = System.getenv("ANDROID_KEYSTORE_PATH")?.takeIf { it.isNotBlank() && file(it).exists() }
    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(if (keystore != null) "release" else "debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    // Google's ready-made QR scanner (through Play services): no camera permission for Bubble AI itself
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
    // Push notifications. Firebase starts at runtime from settings the hub hands over (see Push.kt),
    // so there is no google-services plugin and no google-services.json in this build.
    implementation("com.google.firebase:firebase-messaging:24.1.0")
}
