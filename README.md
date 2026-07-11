# A2C Finanzas con Supabase

Aplicación web lista para publicar como sitio estático. Incluye:

- acceso privado mediante email y contraseña asignada por el administrador;
- registro de usuarios exclusivamente desde el panel administrador;
- usuarios normales y administradores;
- permisos individuales concedidos por el administrador;
- huchas personales y conjuntas;
- objetivos personales y conjuntos con aportaciones de sus miembros;
- botón móvil de registro rápido para ingresos y gastos;
- fotos privadas de justificantes almacenadas en Supabase Storage;
- reparto de gastos por partes iguales o importes personalizados;
- control individual de personas pagadas y pendientes;
- registro de quién añade fondos o realiza un gasto;
- notificaciones en tiempo real, marcado como leído y eliminación posterior;
- carpetas exclusivamente organizativas;
- objetivos exclusivamente de ahorro;
- seguridad PostgreSQL mediante Row Level Security (RLS).

## 1. Crear el proyecto Supabase

1. Entra en [Supabase](https://supabase.com/dashboard) y crea un proyecto.
2. Espera a que termine el aprovisionamiento.
3. Abre **SQL Editor** → **New query**.
4. Copia todo el contenido de [`supabase/schema.sql`](./supabase/schema.sql), pégalo y pulsa **Run**.
5. En **Project Settings** → **API**, copia:
   - **Project URL**.
   - La clave **Publishable** o **anon public**.
6. Abre [`config.js`](./config.js) y sustituye los dos valores de ejemplo.

No pongas nunca la clave `service_role` en `config.js`. La clave pública es visible por diseño; la seguridad depende de RLS.

## 2. Cerrar el registro público

1. En Supabase abre **Authentication** → **Sign In / Providers** → **Email**.
2. Mantén habilitado el acceso mediante email, pero desactiva **Allow new users to sign up**.
3. Desactiva también el registro anónimo si estuviera habilitado.
4. En **Authentication** → **URL Configuration** añade en **Site URL** la URL final de GitHub Pages, por ejemplo:

```text
https://TU-USUARIO.github.io/a2c-finanzas/
```

5. Añade la misma dirección en **Redirect URLs**.

Al desactivar **Allow new users to sign up**, los visitantes no pueden crear cuentas. La aplicación tampoco contiene ningún formulario de registro.

## 3. Crear el primer administrador

1. En Supabase abre **Authentication** → **Users** → **Add user** → **Create new user**.
2. Introduce tu email y una contraseña segura y marca el email como confirmado. El trigger SQL creará automáticamente tu perfil.
3. Abre **SQL Editor** y ejecuta estas dos sentencias cambiando el email:

```sql
update public.profiles
set role='admin'
where lower(email)=lower('tu-email@ejemplo.com');

update public.user_permissions
set can_create_shared=true,
    can_manage_members=true
where user_id=(
  select id from public.profiles
  where lower(email)=lower('tu-email@ejemplo.com')
);
```

4. Cierra sesión y vuelve a entrar. Aparecerá la pestaña **Admin**.

## 4. Desplegar la función segura para crear usuarios

La creación de usuarios necesita privilegios administrativos. Estos privilegios permanecen dentro de Supabase y nunca se publican en GitHub.

### Opción recomendada: Supabase CLI

1. Instala Node.js 20 o posterior desde [nodejs.org](https://nodejs.org/) si todavía no lo tienes.
2. Abre PowerShell dentro de esta carpeta. En Windows puedes escribir `powershell` en la barra de direcciones del Explorador.
3. Comprueba Node.js y ejecuta Supabase sin instalación global:

```powershell
node --version
npx.cmd supabase --help
```

4. Inicia sesión y enlaza tu proyecto:

```powershell
npx.cmd supabase login
npx.cmd supabase link --project-ref TU_PROJECT_REF
```

El `PROJECT_REF` es el identificador que aparece en la URL del panel: `https://supabase.com/dashboard/project/TU_PROJECT_REF`.

5. Despliega la función:

```powershell
npx.cmd supabase functions deploy admin-create-user
```

Supabase proporciona automáticamente a la función `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. No copies la clave `service_role` a `config.js` ni a GitHub.

6. Entra como administrador, abre **Admin** → **Nuevo usuario** e introduce nombre, email y contraseña inicial.
7. Entrega el email y la contraseña al usuario mediante un canal seguro.

Desde esa pestaña el administrador puede:

- activar o desactivar usuarios;
- convertir otro usuario en administrador;
- permitir crear huchas;
- permitir crear huchas compartidas;
- permitir añadir fondos o registrar gastos;
- permitir gestionar miembros de huchas compartidas.

## 5. Compartir una hucha

1. Los dos usuarios deben haber iniciado sesión al menos una vez.
2. El administrador debe conceder al propietario **Crear compartidas** y **Gestionar miembros**.
3. El propietario crea una hucha marcando **Hucha conjunta**.
4. Abre el menú `•••` de la hucha → **Compartir con usuario**.
5. Escribe el email exacto del otro usuario y elige:
   - **Puede operar**: añade fondos y gastos si también tiene esos permisos globales.
   - **Solo lectura**: consulta saldo y actividad.
   - **Copropietario**: puede administrar la hucha si tiene permiso para gestionar miembros.

Cada movimiento guarda usuario, fecha, concepto, importe y tipo. Un trigger de base de datos crea una notificación para todos los demás miembros de la hucha.

## 6. Publicar en GitHub Pages

1. Crea un repositorio en GitHub, por ejemplo `a2c-finanzas`.
2. Sube **el contenido de esta carpeta** a la raíz del repositorio. `index.html` debe quedar en la raíz.
3. En GitHub abre **Settings** → **Pages**.
4. En **Build and deployment**, selecciona **Deploy from a branch**.
5. Elige la rama `main`, carpeta `/ (root)` y pulsa **Save**.
6. Espera a que GitHub muestre la URL publicada.
7. Copia esa URL en **Site URL** y **Redirect URLs** de Supabase como se explica en el paso 2.
8. Abre la web e inicia sesión con una cuenta creada por el administrador.

GitHub Pages publica directamente HTML, CSS y JavaScript desde una rama. El archivo `.nojekyll` evita transformaciones innecesarias.

## 7. Comprobación antes de abrirla a usuarios

Realiza estas pruebas con dos emails distintos:

1. El administrador crea dos usuarios y les asigna contraseñas.
2. Ambos pueden entrar, pero no existe ninguna opción de autorregistro.
3. El administrador ve los dos usuarios y concede permisos.
4. El usuario A crea una hucha conjunta y añade al usuario B.
5. A añade fondos; B recibe una notificación.
6. B marca la notificación como leída.
7. B registra un gasto; A recibe una notificación.
8. Ambos ven el mismo saldo y el mismo historial.
9. Una Carpeta no muestra opciones de Objetivo.
10. Una Hucha no muestra opciones de Objetivo.
11. Un Objetivo solo permite aportaciones de ahorro.

## 8. Instalarla como aplicación móvil

La aplicación incluye manifiesto PWA, icono, modo de pantalla completa y service worker.

### Android (Chrome)

1. Abre la URL publicada en Chrome.
2. Inicia sesión.
3. Pulsa el botón **Instalar** de la cabecera o el menú de Chrome → **Instalar aplicación**.
4. Confirma. A2C aparecerá en la pantalla de inicio como cualquier otra aplicación.

### iPhone/iPad (Safari)

1. Abre la URL en Safari.
2. Pulsa **Compartir**.
3. Selecciona **Añadir a pantalla de inicio**.
4. Confirma con **Añadir**.

En la pestaña **Avisos**, pulsa **Activar avisos** para permitir notificaciones del dispositivo cuando la aplicación esté abierta. Las notificaciones internas permanecen guardadas y se pueden marcar como leídas.

## Estructura

```text
index.html             Entrada de la aplicación
styles.css             Diseño responsive
config.js              URL y clave pública de Supabase
app.js                 Autenticación, UI y lógica
supabase/schema.sql     Tablas, triggers, RLS y funciones seguras
supabase/functions/     Función segura para crear usuarios
supabase/config.toml    Verificación JWT de la función
.nojekyll               Publicación estática en GitHub Pages
```

## Consideraciones de producción

- Configura un proveedor SMTP propio en Supabase antes de tener muchos usuarios; el servicio de correo de prueba tiene límites.
- Activa MFA para las cuentas administradoras si el proyecto gestiona dinero real.
- No almacenes contraseñas, claves privadas o `service_role` en GitHub.
- Activa copias de seguridad y revisa los registros de Supabase.
- Esta aplicación registra movimientos financieros, pero no mueve dinero bancario real.

## Documentación oficial

- [Supabase: acceso mediante contraseña](https://supabase.com/docs/guides/auth/passwords)
- [Supabase: proteger Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Supabase: configuración general y cierre del registro](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase: Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [GitHub Pages: configurar una fuente de publicación](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
