# A2C Finanzas v22 — Comunidad

## Actualización obligatoria
1. Ejecuta `supabase/v11-social-network.sql` en SQL Editor.
2. Despliega:
   - `npx supabase functions deploy secure-login --no-verify-jwt`
   - `npx supabase functions deploy account-settings`
3. Sube los archivos web a GitHub.
4. Limpia la caché de la PWA.

## Funciones
- Nombre único `@usuario`.
- Inicio de sesión por email o @usuario.
- Cuenta pública o privada.
- Solicitudes de amistad.
- Feed social con publicaciones vinculadas a transacciones.
- Imágenes privadas protegidas con RLS y URLs firmadas.
