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

### Opción 1 · GitHub Actions (sin instalar nada, firmado con TU clave)
El workflow `.github/workflows/android-apk.yml` compila el APK firmado con tu clave de siempre,
así se instala **encima** de la app que ya tienes sin perder nada.

**Una sola vez — crear los secretos:**
1. En tu PC, abre **PowerShell** y convierte tu clave a texto (base64):
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\Abel\Desktop\ARCHIVO DE CUENTA APP\firma-a2c\a2c-release.p12")) | Set-Clipboard
   ```
   El resultado queda copiado en el portapapeles.
2. En GitHub: repositorio › *Settings › Secrets and variables › Actions › New repository secret*. Crea:

   | Nombre | Valor |
   |---|---|
   | `A2C_KEYSTORE_BASE64` | lo que copiaste en el paso 1 (pégalo) |
   | `A2C_STORE_PASSWORD` | la contraseña de tu clave |
   | `A2C_KEY_ALIAS` | `a2c` |

**Cada vez que quieras un APK:**
1. Pestaña *Actions › APK Android › Run workflow* (también se ejecuta solo al subir cambios a `main`).
2. Al terminar (≈5 min), abre la ejecución y descarga el artefacto **A2C-Finanzas-APK**.
3. Descomprímelo y pasa el `.apk` al móvil.

> La firma **nunca** debe estar en el repositorio: `android/keystore.properties`, la carpeta `firma-a2c`
> y los archivos `.p12` están en `.gitignore`. Usa `android/keystore.properties.example` como plantilla local.

### Opción 2 · Android Studio
1. Instala Android Studio y abre la carpeta `android/`.
2. Copia `keystore.properties.example` como `keystore.properties` (si no lo tienes ya) y pon la ruta y contraseña de tu clave.
3. Espera a que sincronice Gradle y pulsa *Build › Build App Bundle(s) / APK(s) › Build APK(s)*
   con la variante *release*.
4. El APK queda en `android/app/build/outputs/apk/release/`.

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
