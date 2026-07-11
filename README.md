# A2C Finanzas V6

Versión modular con:

- botones rápidos para ingresos y gastos;
- edición y borrado de movimientos por su creador;
- huchas conjuntas;
- objetivos conjuntos;
- invitaciones y notificaciones;
- foto justificante de gastos;
- división de gastos en partes iguales o importes diferentes;
- seguimiento de partes pagadas y pendientes;
- gráfico circular de ingresos, gastos e inversiones.

## Instalación

1. Ejecuta `sql/v6-migration.sql` en Supabase SQL Editor.
2. Después ejecuta `sql/v6-verify.sql`. Todas las filas deben devolver `true`.
3. Sustituye los archivos de GitHub por los de esta carpeta.
4. Mantén `config.js` con la URL y la clave pública correcta.
5. GitHub Pages debe publicar desde `main` y `/(root)`.
6. Recarga la aplicación.

## Seguridad

- Los RPC `update_transaction_secure` y `delete_transaction_secure` comprueban que la persona sea el creador o administrador.
- El bucket `receipts` es privado.
- La clave `service_role` no debe incluirse en GitHub ni en `config.js`.

## Nota sobre invitaciones

Cuando se invita a un usuario por correo, se crea una notificación. La base de datos incluye la función `respond_shared_invitation`; la interfaz de aceptación puede añadirse en la siguiente iteración si tu tabla de notificaciones actual usa columnas distintas a las previstas.
