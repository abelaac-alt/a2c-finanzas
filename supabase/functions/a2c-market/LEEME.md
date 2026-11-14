# a2c-market · cotizaciones de bolsa para A2C Finanzas

Proxy de solo lectura que consulta Yahoo Finance desde el servidor de Supabase.
Sin clave, cubre Mercado Continuo (`SAN.MC`, `IBE.MC`…), Europa, EE. UU., índices (`^IBEX`, `^GSPC`) y criptomonedas.
Solo responde a usuarios con sesión iniciada (Supabase comprueba el JWT).

## Publicarla (una sola vez)

Opción A · Panel de Supabase
1. Supabase → tu proyecto → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nombre: `a2c-market`.
3. Pega el contenido de `index.ts` y pulsa **Deploy**.

Opción B · Supabase CLI (desde la carpeta del repositorio)
```
npx supabase login
npx supabase functions deploy a2c-market --project-ref TU_PROJECT_REF
```

Para comprobarla: en la app, Herramientas → Inversión → Fuente de datos → **Probar conexión**.

## Alternativa sin servidor
En «Fuente de datos» elige Twelve Data y pega una clave gratuita de twelvedata.com
(plan gratuito: EE. UU., divisas y cripto; 8 consultas/minuto, 800/día).
