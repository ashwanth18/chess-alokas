import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing lives outside the repo: %USERPROFILE%\.chess-alokas\key.properties,
// with storeFile, storePassword, keyAlias and keyPassword. Values are never logged.
val keyPropertiesFile =
    File(System.getenv("USERPROFILE") ?: System.getProperty("user.home"), ".chess-alokas/key.properties")
val keyProperties: Properties? =
    if (keyPropertiesFile.isFile) {
        Properties().apply { keyPropertiesFile.inputStream().use { load(it) } }
    } else {
        null
    }

android {
    namespace = "com.alokas.chess"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.alokas.chess"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        keyProperties?.let { props ->
            val missing =
                listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
                    .filter { props.getProperty(it).isNullOrBlank() }
            if (missing.isNotEmpty()) {
                throw GradleException("$keyPropertiesFile is missing: ${missing.joinToString()}")
            }
            // A relative storeFile is read from the folder holding key.properties.
            val store = keyPropertiesFile.parentFile.resolve(props.getProperty("storeFile"))
            if (!store.isFile) {
                throw GradleException("The storeFile named in $keyPropertiesFile does not exist.")
            }
            create("release") {
                storeFile = store
                storePassword = props.getProperty("storePassword")
                keyAlias = props.getProperty("keyAlias")
                keyPassword = props.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            if (keyProperties != null) {
                signingConfig = signingConfigs.getByName("release")
            } else {
                signingConfig = signingConfigs.getByName("debug")
                if (gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) }) {
                    logger.warn(
                        "WARNING: $keyPropertiesFile not found. This release build is signed " +
                            "with the DEBUG key: it cannot go on Play, or update an app signed with the real key.",
                    )
                }
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
