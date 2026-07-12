# A2C Finanzas Profesional

Rediseño profesional con panel financiero, gráficos SVG nativos y herramientas de planificación.

## Nuevas funciones
- Panel profesional con salud financiera y KPIs.
- Gráfico de tendencia de ingresos y gastos de 6/12 meses.
- Gastos por categorías.
- Categorías financieras.
- Presupuestos mensuales por categoría.
- Movimientos recurrentes.
- Tasa de ahorro y flujo neto.
- Exportación CSV.
- Comercio o entidad en cada movimiento.
- Filtros por categoría.
- Diseño responsive y PWA.

## Instalación
1. Ejecuta primero `supabase/schema-clean.sql` solamente si aún no has instalado la versión limpia.
2. Ejecuta `supabase/pro-migration.sql`.
3. Sustituye en GitHub todos los archivos por los de esta carpeta.
4. Mantén tus datos reales de Supabase en `config.js`.
5. Espera el despliegue de GitHub Pages y recarga.

La migración Pro no elimina movimientos existentes.
