# A2C Finanzas v19

Versión con cartera de criptomonedas, movimientos entre espacios, pagos con cripto y repetición desde el menú de edición.

## Actualización obligatoria

Antes de abrir la aplicación, ejecuta en Supabase SQL Editor:

`supabase/v8-crypto-wallet.sql`

Después sustituye los archivos de la aplicación y limpia la caché de la PWA.

## Lógica de criptomonedas

- Al escribir Bitcoin, Ethereum u otra cripto reconocida en una inversión, el formulario cambia automáticamente al modo cripto.
- Una compra guarda cantidad, precio, comisión y coste medio.
- La comisión puede añadirse al desembolso o restarse de la cantidad recibida.
- Desde una hucha, carpeta u objetivo se puede mover una cripto previamente comprada.
- Los traspasos no cambian la cantidad global ni generan gasto.
- Un pago con cripto reduce las unidades disponibles y registra un gasto en euros con forma de pago `crypto`; no reduce el saldo bancario.
- Las estadísticas muestran cartera actual, coste medio y operaciones del intervalo seleccionado.

Las operaciones cripto no se editan directamente para evitar inconsistencias. Se pueden repetir o eliminar; una compra solo puede borrarse si las unidades correspondientes no se han movido ni gastado.
