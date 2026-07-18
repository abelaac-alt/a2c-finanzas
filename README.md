# A2C Finanzas · versión sin categorías

Esta versión mantiene la autenticación y los datos en Supabase, pero elimina de la interfaz:

- Categorías.
- Comercio.
- Presupuestos por categoría.

## Nueva lógica

### Ahorro
Los movimientos de ahorro pueden asignarse a un objetivo. Cuando se asignan, aumentan el progreso y el saldo visible de ese objetivo.

### Inversión
La inversión funciona como en la aplicación de referencia: solo requiere concepto, importe, fecha y espacio. ISIN, acciones y precio unitario dejan de ser obligatorios y no aparecen en el formulario.

### Combustible
Al registrar un gasto cuyo concepto contenga `combustible`, `gasolina`, `gasoil`, `diésel`, `repostaje` o `carburante`, aparecen campos para:

- Litros.
- Precio por litro.
- Kilómetros desde el repostaje anterior.

El importe se calcula automáticamente y, si se introducen kilómetros, también se calcula el consumo estimado en L/100 km.

## Actualización de una instalación existente

Ejecuta en Supabase SQL Editor:

```text
supabase/v6-no-categories-fuel.sql
```

Después sustituye los archivos web del repositorio y limpia la caché de la PWA si el navegador conserva la versión anterior.

## Instalación nueva

Ejecuta las migraciones en este orden:

1. `supabase/schema-clean.sql`
2. `supabase/pro-migration.sql`
3. `supabase/v4-migration.sql`
4. `supabase/v5-migration.sql`
5. `supabase/v6-no-categories-fuel.sql`

Revisa también `config.js` y utiliza únicamente la clave pública de Supabase.

## Versión 17
- Campos obligatorios de precio por litro y litros repostados al registrar combustible.
- Resumen de combustible en Estadísticas según el rango y filtros activos: litros, gasto total y precio medio ponderado.
- No requiere una migración nueva si ya se ejecutó `supabase/v6-no-categories-fuel.sql`.


## Versión 18

- Inversiones con empresa, ISIN, número de acciones y precio por acción.
- Estadísticas de inversión agrupadas por ISIN y por el rango de fechas seleccionado.
- Botón 🔁 en cada movimiento para repetirlo con sus campos precargados y editables.
- No requiere una migración SQL adicional si ya se ejecutó v4-migration.sql.
