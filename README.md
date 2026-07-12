# A2C Finanzas Profesional V4

## Cambios incluidos

- El dinero añadido a una hucha se descuenta automáticamente de la cuenta principal.
- Solo cuatro categorías de gasto: Combustible, Ocio, Comida y Otros.
- Ingresos, inversión y ahorro no usan categorías.
- Eliminada la salud financiera.
- Único botón flotante `+` para crear movimientos.
- Forma de pago: banco o efectivo.
- Estadísticas segmentadas por cuenta principal, huchas, carpetas, objetivos y tipo.
- Registro de inversiones con ISIN, acciones, precio unitario e importe total.
- Cartera agrupada por ISIN con cantidad total y precio medio ponderado.
- Edición y borrado sincronizados para traspasos a huchas.

## Instalación

1. La aplicación debe tener ya instalados `schema-clean.sql` y `pro-migration.sql`.
2. Ejecuta todo el contenido de `supabase/v4-migration.sql` en Supabase SQL Editor.
3. Sustituye los archivos de GitHub por los de esta carpeta.
4. Conserva tus claves públicas correctas en `config.js`.
5. Espera el despliegue de GitHub Pages y recarga la aplicación.

La migración V4 conserva los movimientos existentes. Elimina las categorías y presupuestos antiguos porque el nuevo modelo solo admite las cuatro categorías indicadas.
