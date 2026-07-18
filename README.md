# A2C Finanzas v20 — inicio de sesión reforzado

Esta versión añade una Edge Function de inicio de sesión, validación en servidor y bloqueo temporal tras cinco intentos fallidos.

## Actualización obligatoria

1. Ejecuta `supabase/v9-secure-login.sql` en **Supabase → SQL Editor**.
2. Despliega las funciones:

```bash
supabase functions deploy secure-login --no-verify-jwt
supabase functions deploy account-settings
supabase functions deploy admin-users
```

La función `secure-login` debe ser pública porque se ejecuta antes de que exista una sesión. Internamente solo usa la clave de servicio en el servidor y nunca la expone al navegador.

## Comportamiento de seguridad

- El email se normaliza y valida en servidor.
- La contraseña se valida por longitud, pero no se recorta ni transforma.
- Tras 5 fallos, la cuenta queda bloqueada durante 15 minutos.
- Solo se guarda SHA-256 del email normalizado, no el email en claro.
- Nunca se guarda la contraseña en las tablas de la aplicación.
- Supabase Auth almacena las contraseñas mediante bcrypt con salt.
- Los mensajes de credenciales son genéricos: `Email o contraseña incorrecta`.
- La creación de usuarios y la edición del perfil validan email, nombre y contraseña en Edge Functions.

## Contraseñas nuevas

Las contraseñas creadas o cambiadas deben tener entre 10 y 128 caracteres e incluir mayúscula, minúscula y número.

## Desbloqueo manual opcional

El bloqueo expira automáticamente. Para borrar todos los bloqueos antes de tiempo:

```sql
truncate table public.login_attempts;
```
