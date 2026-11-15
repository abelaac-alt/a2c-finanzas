import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ---------- Firma ----------
// Local: android/keystore.properties (no se sube a GitHub).
// GitHub Actions: variables de entorno A2C_STORE_FILE, A2C_STORE_PASSWORD, A2C_KEY_ALIAS, A2C_KEY_PASSWORD.
val signing = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
fun signingValue(key: String, env: String): String? = signing.getProperty(key) ?: System.getenv(env)?.takeIf { it.isNotBlank() }
val releaseStoreFile = signingValue("storeFile", "A2C_STORE_FILE")

// ---------- Web empaquetada ----------
// Copia la aplicación web del repositorio (carpeta superior) dentro del APK en assets/www.
val webRoot = rootProject.projectDir.parentFile
val webAssetsDir = layout.buildDirectory.dir("generated/webAssets")
val syncWebAssets by tasks.registering(Sync::class) {
    description = "Copia la web de A2C Finanzas dentro de los assets del APK."
    from(webRoot) {
        include("index.html", "styles.css", "config.js", "manifest.webmanifest", "logo-a2c.png", "icon-192.png", "icon-512.png", "src/**")
    }
    into(webAssetsDir.map { it.dir("www") })
}

android {
    namespace = "es.a2c.finanzas"
    compileSdk = 35

    defaultConfig {
        applicationId = "es.a2c.finanzas"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "8.4.0"
    }

    signingConfigs {
        create("release") {
            if (releaseStoreFile != null) {
                storeFile = file(releaseStoreFile)
                storePassword = signingValue("storePassword", "A2C_STORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "A2C_KEY_ALIAS") ?: "a2c"
                keyPassword = signingValue("keyPassword", "A2C_KEY_PASSWORD") ?: storePassword
                storeType = "pkcs12"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (releaseStoreFile != null) signingConfigs.getByName("release") else null
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    sourceSets["main"].assets.srcDir(webAssetsDir)

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}

tasks.named("preBuild") { dependsOn(syncWebAssets) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
}
