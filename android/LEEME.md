# A2C Finanzas para Android

Proyecto Android nativo (Kotlin) que empaqueta la web de A2C Finanzas y añade lo que una web no puede hacer:

| Función | Cómo funciona |
|---|---|
| App completa | La web (`index.html`, `styles.css`, `src/`) se copia dentro del APK al compilar y se sirve de forma segura desde `https://appassets.androidplatform.net`. Necesita internet para Supabase y las cotizaciones. |
| Sesión compartida | La sesión de Supabase se guarda en el almacenamiento nativo, así los widgets y las alertas funcionan con la app cerrada sin cerrar tu sesión. |
| Widgets de escritorio | **A2C · Saldo** (saldo disponible, ahorro del mes, huchas), **Objetivos** (hasta 3, los eliges en Herramientas › Objetivos › Widget) y **Mis acciones** (las marcadas con «Mostrar en Inicio»). Se actualizan cada 15 minutos y al salir de la app. |
| Alertas de bolsa en segundo plano | Cada 15 minutos (mínimo de Android) comprueba tus alertas y te avisa con una notificación aunque la app esté cerrada. |
| Detección de pagos | Perfil › Detección de pagos. Con tu permiso lee las notificaciones de tu banco o cartera (Google Wallet, BBVA, Santander, CaixaBank, ING, Revolut…), detecta el importe y el comercio y te propone **Registrar** o **Descartar**. Nada se envía hasta que pulsas Registrar. |
| Copias de seguridad | «Exportar copia» abre el selector de Android para guardar el archivo; «Importar copia» y las fotos usan el selector de archivos. |
| Botón Atrás | Cierra la ventana abierta, vuelve a Inicio y, desde Inicio, sale de la app. |

## Cómo obtener el APK

### Opción 1 · GitHub Actions (sin instalar nada)
1. Sube el repositorio completo a GitHub (incluidas las carpetas `android/` y `.github/`).
   **No subas** `android/keystore.properties` ni la carpeta `firma-a2c` (el `.gitignore` ya los excluye).
2. En GitHub: *Settings › Secrets and variables › Actions › New repository secret*, crea los tres secretos
   que indica `firma-a2c/LEEME-FIRMA.txt` (`A2C_KEYSTORE_BASE64`, `A2C_STORE_PASSWORD`, `A2C_KEY_ALIAS`).
3. Pestaña *Actions › APK Android › Run workflow*. Al terminar (≈5 min), descarga el artefacto
   **A2C-Finanzas-APK**, descomprímelo y pasa el `.apk` al móvil.

Cada vez que subas cambios a `main` se compila solo.

### Opción 2 · Android Studio
1. Instala Android Studio y abre la carpeta `android/`.
2. Espera a que sincronice Gradle y pulsa *Build › Build App Bundle(s) / APK(s) › Build APK(s)*
   con la variante *release*. La firma se toma de `android/keystore.properties`.
3. El APK queda en `android/app/build/outputs/apk/release/`.

## Instalar en el móvil
1. Abre el `.apk` en el móvil y permite «Instalar apps desconocidas» para el explorador de archivos o el navegador.
2. Inicia sesión con tu cuenta de siempre (los datos están en Supabase).
3. Acepta las notificaciones. Para detectar pagos: Perfil › Detección de pagos › Conceder acceso.
4. Mantén pulsado el escritorio › Widgets › A2C Finanzas para añadir los widgets.

Si el móvil tiene ahorro de batería agresivo (Xiaomi, Huawei, Samsung…), quita las restricciones de
batería a A2C para que las alertas y los widgets se actualicen con la app cerrada.

## Actualizaciones
- Sube `versionCode` (y `versionName`) en `app/build.gradle.kts` en cada versión nueva.
- Firma siempre con la misma clave (`firma-a2c/a2c-release.p12`); si se pierde, no se podrá instalar encima.

## Requisitos de servidor
- Cotizaciones: publicar la función `supabase/functions/a2c-market` (ver su LEEME) o usar una clave de Twelve Data.
