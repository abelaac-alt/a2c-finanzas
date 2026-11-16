# a2c-telegram · registrar tickets enviando una foto por Telegram

Envías al bot la foto de un ticket (o el PDF) y A2C registra el gasto solo:
comercio, importe total, fecha, categoría (y presupuesto automático), método de pago,
artículos en las notas y la imagen guardada como justificante.

Necesitas configurarlo **una sola vez** (unos 10 minutos).

---

## 1. Crear el bot en Telegram (2 min)

1. En Telegram, abre **@BotFather** (el oficial, con la marca azul).
2. Envía `/newbot`.
3. Nombre visible: por ejemplo `A2C Finanzas`.
4. Usuario del bot: tiene que acabar en `bot`, por ejemplo `a2c_tickets_abel_bot`.
5. BotFather te responde con un **token** parecido a `7412345678:AAH...`. Cópialo y **no lo compartas**.

## 2. Conseguir la clave de Claude (lee los tickets) (2 min)

1. Entra en <https://console.anthropic.com> → **API Keys** → **Create Key**.
2. Copia la clave (`sk-ant-...`).
3. Añade algo de saldo en **Billing**. Cada ticket cuesta aproximadamente 1-2 céntimos.

## 3. Preparar la base de datos (1 min)

Supabase → tu proyecto → **SQL Editor** → **New query** → pega el contenido de
`database/A2C_SUPABASE_TELEGRAM_V9.sql` → **Run**.

## 4. Guardar los secretos en Supabase (1 min)

Supabase → **Edge Functions** → **Secrets** (o *Project Settings → Edge Functions*) → añade:

| Nombre               | Valor                          |
|----------------------|--------------------------------|
| `TELEGRAM_BOT_TOKEN` | el token de BotFather          |
| `ANTHROPIC_API_KEY`  | la clave `sk-ant-...`          |

## 5. Publicar la función (2 min)

**Opción A · Panel de Supabase**
1. **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nombre: `a2c-telegram` (exactamente así).
3. Pega el contenido de `index.ts` → **Deploy**.
4. Abre la función → **Details / Settings** → **desactiva "Enforce JWT Verification"** → guarda.
   (Telegram no envía sesión de usuario; la función se protege con una clave secreta propia.)

**Opción B · Supabase CLI** (desde la carpeta del repositorio)
```
npx supabase login
npx supabase secrets set TELEGRAM_BOT_TOKEN=... ANTHROPIC_API_KEY=... --project-ref TU_PROJECT_REF
npx supabase functions deploy a2c-telegram --no-verify-jwt --project-ref TU_PROJECT_REF
```

## 6. Conectar y vincular desde la app (1 min)

1. Abre A2C → **Perfil** → **Telegram**.
   Al abrirlo, la app conecta el bot con Supabase automáticamente (webhook).
2. Pulsa **Vincular con Telegram** → se abre el bot → pulsa **Iniciar**.
3. El bot responde «✅ Cuenta vinculada» y la app lo muestra como vinculado.

---

## Uso diario

| Qué envías al bot                  | Qué pasa |
|------------------------------------|----------|
| 📸 Foto de un ticket               | Se registra el gasto. El bot responde con el resumen. |
| 📸 Foto + texto (pie de foto)      | El texto se guarda en las notas del gasto. |
| 📄 Ticket como archivo (JPG/PNG/PDF) | Igual que la foto (útil para facturas en PDF). |
| `12,50 café`                       | Gasto rápido sin foto. |
| `/ultimos`                         | Últimos movimientos. |
| `/mes`                             | Gasto e ingresos del mes. |
| `/desvincular`                     | Desconecta el chat de tu cuenta. |

Debajo de cada gasto registrado aparecen botones:
**💳 Tarjeta / 💵 Efectivo** para corregir el método de pago y **🗑 Deshacer** para borrarlo.

Consejos para que lea bien el ticket: buena luz, ticket entero y estirado, que se vea el **TOTAL**.
Si ya existe un gasto con el mismo importe ese día, el bot te avisa por si es un duplicado.

## Problemas frecuentes

- **La app dice "La función a2c-telegram no responde"** → no está publicada o el nombre no es exactamente `a2c-telegram`.
- **"Falta el secreto …"** → revisa el paso 4 (los nombres van en mayúsculas, sin espacios).
- **El bot no contesta** → en la app pulsa **Comprobar conexión**. Si sigue sin contestar, revisa que la
  verificación JWT esté **desactivada** (paso 5) y mira los logs en Supabase → Edge Functions → a2c-telegram → Logs.
- **"La clave ANTHROPIC_API_KEY no es válida"** o no lee tickets → revisa la clave y que tengas saldo en console.anthropic.com.

## Seguridad

- Solo responde en chats privados y solo a chats vinculados con un código de un solo uso (caduca en 15 min).
- Telegram firma cada petición con una clave secreta derivada del token; las peticiones sin ella se rechazan.
- Las funciones del bot en la base de datos solo las puede ejecutar el servidor (`service_role`).
- Opcional: secreto `A2C_TICKET_MODEL` para cambiar el modelo de Claude que lee los tickets (por defecto `claude-opus-5-5`).
