# A2C Finanzas Profesional V5

## Cambios

- Categorías de gasto únicas:
  - Transporte
  - Ocio
  - Comida
  - Suscripciones
  - Otros
- Se eliminan las categorías duplicadas.
- Los movimientos de una carpeta afectan al saldo de la cuenta principal.
- Los movimientos de carpetas aparecen en las estadísticas.
- El gráfico mensual respeta el segmento y los filtros seleccionados.
- Las estadísticas incluyen un historial completo del segmento.

## Instalación

1. Ejecuta `supabase/v5-migration.sql` en Supabase SQL Editor.
2. Sustituye los archivos de GitHub por los de esta carpeta.
3. Conserva tu `config.js` real.
4. Espera el despliegue y recarga la aplicación.

La migración reinicia las categorías y los presupuestos antiguos para eliminar duplicados de forma definitiva.
