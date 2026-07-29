A2C Finanzas 4.2

Incluye:
- Búsqueda de usuarios por @usuario.
- Solicitudes y aceptación de amistad.
- Lista de amigos.
- Invitación de amigos a huchas, carpetas y objetivos.
- Los grupos continúan usando amigos aceptados.
- Mensajes privados entre amigos.
- Mensajes cifrados en reposo con pgcrypto AES-256 en Supabase.
- Transporte protegido por HTTPS/TLS.
- Notificaciones Android de mensajes y solicitudes.

Importante:
El cifrado implementado es cifrado del lado del servidor, no cifrado de extremo a extremo.
Supabase descifra el mensaje únicamente dentro de funciones protegidas y solo para participantes.

Instalación:
1. Ejecuta SUPABASE_AMIGOS_MENSAJES_CIFRADOS_V42.sql.
2. Sube app.js, groups-v54.js e index.html al repositorio web.
3. Actualiza Android y compila la APK.
