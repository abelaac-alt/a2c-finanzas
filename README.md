# A2C Finanzas V5

Base nueva y modular para GitHub Pages + Supabase.

## Qué incluye esta primera versión estable

- Inicio de sesión con Supabase Auth.
- Carga segura de perfil y permisos.
- Cuenta principal y resumen de movimientos.
- Huchas, carpetas, objetivos y actividad.
- Creación básica de movimientos, huchas, carpetas y objetivos.
- Panel de administrador.
- Cambio de contraseña mediante la Edge Function `admin-change-password`.
- Errores visibles: la pantalla no queda eternamente en “Cargando”.
- Sin Service Worker en esta fase para evitar problemas de caché.

## Instalación

1. Haz una copia de seguridad del repositorio actual.
2. Sustituye los archivos por esta carpeta.
3. Mantén tu `config.js` con la URL y clave pública correctas.
4. Sube todo, incluidas las carpetas `js` y `supabase`.
5. Configura GitHub Pages desde `main` y `/(root)`.
6. Despliega `supabase/functions/admin-change-password/index.ts`.
7. Ejecuta `sql/health-check.sql` para comprobar tablas.

## Importante

Esta es la base V5 limpia. Las funciones avanzadas de invitaciones, gastos divididos,
recibos y permisos detallados se añadirán sobre esta arquitectura, no mediante parches
sobre un único archivo gigante.
