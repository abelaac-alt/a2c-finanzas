# A2C Finanzas — instalación limpia

Esta versión se ha reconstruido desde cero.

## Incluye
- Inicio de sesión.
- Cuenta principal.
- Ingresos, gastos, inversión y ahorro.
- Huchas, carpetas y objetivos personales o compartidos.
- Invitaciones por email.
- Notificaciones de invitaciones y movimientos compartidos.
- Edición y borrado de movimientos por su creador.
- Edición y borrado de huchas, carpetas y objetivos por su propietario.
- Estadísticas por periodo.
- Cambio de nombre y contraseña del usuario.
- Administración de usuarios, nombres, roles, estado y contraseñas.
- Fotos privadas de justificantes.

## Instalación

1. Haz copia de seguridad si necesitas conservar datos antiguos.
2. Supabase → SQL Editor.
3. Pega TODO `supabase/schema-clean.sql` y pulsa Run.
4. Los usuarios de Authentication se conservan.
5. Convierte tu cuenta en administrador:

```sql
update public.profiles
set role='admin',active=true
where email='TU_EMAIL';
```

6. Supabase → Edge Functions → crea `admin-users`.
7. Pega `supabase/functions/admin-users/index.ts` y despliega con JWT activo.
8. Edita `config.js` con la URL y la clave pública de Supabase.
9. Sube todos los archivos a GitHub Pages desde `main` y `/(root)`.

No publiques nunca la clave `service_role`.


## PWA
Incluye manifest, Service Worker, iconos 192/512 y botón de instalación.
