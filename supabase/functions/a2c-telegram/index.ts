// A2C Finanzas · Edge Function "a2c-telegram"
// Bot de Telegram: envías la foto (o PDF) de un ticket y se registra el gasto automáticamente.
//
// Secretos necesarios (Supabase → Edge Functions → Secrets):
//   TELEGRAM_BOT_TOKEN   token que te da @BotFather
//   ANTHROPIC_API_KEY    clave de la API de Claude (console.anthropic.com) para leer los tickets
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase automáticamente.
//
// IMPORTANTE: desplegar SIN verificación JWT (Telegram no envía JWT):
//   npx supabase functions deploy a2c-telegram --no-verify-jwt
// La seguridad la da la cabecera secreta que Telegram envía en cada petición.
//
// Peticiones:
//   · Telegram → POST con un Update (cabecera X-Telegram-Bot-Api-Secret-Token)
//   · App A2C  → POST {action:"status"|"setup"} con Authorization: Bearer <JWT del usuario>

import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MODEL = Deno.env.get("A2C_TICKET_MODEL") ?? "claude-opus-5-5";
const TG_BASE = Deno.env.get("TELEGRAM_API_BASE") ?? "https://api.telegram.org";
const TG = `${TG_BASE}/bot${BOT_TOKEN}`;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

const CATEGORIES: Record<string, string> = {
  food: "Alimentación",
  leisure: "Ocio",
  health: "Salud",
  fuel: "Combustible",
  subscriptions: "Suscripciones",
  shopping: "Compras",
  housing: "Vivienda",
  transport: "Transporte",
  other: "Otros",
};
const METHODS: Record<string, string> = { bank: "💳 Tarjeta", cash: "💵 Efectivo", crypto: "🪙 Cripto" };

// ---------------------------------------------------------------- utilidades
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function webhookSecret(): Promise<string> {
  // Derivado del token: no hace falta configurar otro secreto.
  const data = new TextEncoder().encode(`a2c-telegram:${BOT_TOKEN}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function money(cents: number) {
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function esc(text: unknown) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDate(iso: string) {
  const [y, m, d] = String(iso).split("-");
  return d && m && y ? `${d}/${m}/${y}` : String(iso);
}

function todayMadrid() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
}

async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.error(`Telegram ${method}:`, data.description || res.status);
  return data;
}

const send = (chatId: number, text: string, extra: Record<string, unknown> = {}) =>
  tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });

async function rpc<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

function parseAmount(text: string): number | null {
  // "12,50" · "12.50" · "1.234,56" · "1,234.56" · "12"
  const match = text.match(/-?\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?/);
  if (!match) return null;
  let raw = match[0].replace(/\s/g, "");
  const lastSep = Math.max(raw.lastIndexOf(","), raw.lastIndexOf("."));
  if (lastSep >= 0 && raw.length - lastSep - 1 <= 2) {
    raw = raw.slice(0, lastSep).replace(/[.,]/g, "") + "." + raw.slice(lastSep + 1);
  } else {
    raw = raw.replace(/[.,]/g, "");
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

// ------------------------------------------------------- lectura del ticket
type Ticket = {
  is_receipt: boolean;
  merchant: string;
  concept: string;
  total: number;
  currency: string;
  date: string;
  category: string;
  payment_method: string;
  items: { name: string; amount: number }[];
  confidence: string;
  reason: string;
};

const TICKET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["is_receipt", "merchant", "concept", "total", "currency", "date", "category", "payment_method", "items", "confidence", "reason"],
  properties: {
    is_receipt: { type: "boolean", description: "true si la imagen es un ticket, factura o recibo de compra legible" },
    merchant: { type: "string", description: "Nombre comercial del establecimiento, p. ej. 'Mercadona'. Vacío si no se ve" },
    concept: { type: "string", description: "Concepto breve en español para el movimiento, máx. 60 caracteres, p. ej. 'Mercadona · compra semanal'" },
    total: { type: "number", description: "Importe TOTAL pagado (con impuestos, tras descuentos). 0 si no se puede leer" },
    currency: { type: "string", description: "Código ISO 4217, p. ej. EUR" },
    date: { type: "string", description: "Fecha de la compra en formato YYYY-MM-DD. Vacío si no aparece" },
    category: { type: "string", enum: Object.keys(CATEGORIES) },
    payment_method: { type: "string", enum: ["bank", "cash", "unknown"], description: "bank si se pagó con tarjeta/contactless, cash si fue en efectivo" },
    items: {
      type: "array",
      description: "Hasta 15 líneas principales del ticket",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "amount"],
        properties: { name: { type: "string" }, amount: { type: "number" } },
      },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    reason: { type: "string", description: "Si is_receipt es false o la confianza es baja, explica brevemente por qué" },
  },
};

const SYSTEM_PROMPT = `Eres el lector de tickets de A2C Finanzas, una app española de finanzas personales.
Recibes la foto o el PDF de un ticket de compra, factura o recibo y extraes los datos para registrar el gasto.

Reglas:
- "total" es lo que el cliente pagó realmente: el TOTAL final con IVA y tras descuentos. No uses subtotales, bases imponibles, "entregado" ni "cambio".
- En los tickets españoles la coma es el separador decimal: "12,50" = 12.50.
- Si la fecha es ambigua, interpreta DD/MM/AAAA (formato español). Si el año tiene dos cifras, es 20XX.
- Categorías: food (supermercado, alimentación), leisure (restaurantes, bares, cine, viajes, hoteles), health (farmacia, médico, deporte), fuel (gasolineras), subscriptions (servicios recurrentes), shopping (ropa, tecnología, tiendas en general), housing (luz, agua, gas, internet, hogar), transport (taxi, tren, bus, parking, peajes), other.
- payment_method: bank si aparece tarjeta, VISA, Mastercard, contactless, TPV o datáfono; cash si aparece "efectivo" o "entregado/cambio"; si no, unknown.
- "concept": nombre del comercio y, si aporta, qué se compró. Español, breve, sin importes.
- Si la imagen no es un ticket o no se lee el total, pon is_receipt=false o total=0 y explícalo en "reason".`;

async function readTicket(bytes: Uint8Array, mediaType: string, caption: string): Promise<Ticket> {
  const data = encodeBase64(bytes);
  const source = mediaType === "application/pdf"
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: mediaType as "image/jpeg", data } };

  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: TICKET_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [
        source,
        {
          type: "text",
          text: `Hoy es ${todayMadrid()}.${caption ? ` Nota del usuario: "${caption}".` : ""} Extrae los datos de este ticket.`,
        },
      ],
    }],
  });

  if (response.stop_reason === "refusal") throw new Error("No se pudo analizar la imagen.");
  if (response.stop_reason === "max_tokens") throw new Error("El ticket es demasiado largo para leerlo.");
  const text = response.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  return JSON.parse(text) as Ticket;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date(`${todayMadrid()}T12:00:00Z`);
  const diffDays = (today.getTime() - date.getTime()) / 86400000;
  // Fechas futuras o de hace más de un año suelen ser errores de lectura.
  return diffDays >= 0 && diffDays <= 366 ? value : null;
}

// --------------------------------------------------------------- teclados
const receiptKeyboard = (txId: string, method: string) => ({
  inline_keyboard: [
    [
      { text: method === "bank" ? "✅ Tarjeta" : "💳 Tarjeta", callback_data: `pm:bank:${txId}` },
      { text: method === "cash" ? "✅ Efectivo" : "💵 Efectivo", callback_data: `pm:cash:${txId}` },
    ],
    [{ text: "🗑 Deshacer", callback_data: `undo:${txId}` }],
  ],
});

// ------------------------------------------------------------- comandos
const HELP = `<b>A2C Finanzas · Bot de tickets</b>

📸 <b>Envía una foto de un ticket</b> y lo registro como gasto: comercio, importe, fecha y categoría.
📄 También acepto el ticket como <b>archivo</b> (imagen o PDF).
✍️ Si añades un texto a la foto, se guarda en las notas.
⚡ Gasto rápido sin foto: escribe <code>12,50 café</code>.

Comandos:
/ultimos · últimos movimientos
/mes · gasto del mes en curso
/ayuda · esta ayuda
/desvincular · desconectar este chat de tu cuenta`;

async function handleStart(chatId: number, payload: string, from: any) {
  if (!payload) {
    const user = await rpc("a2c_tg_user_for_chat", { p_chat_id: chatId });
    if (user) return send(chatId, `Hola de nuevo, ${esc(user.display_name)} 👋\n\n${HELP}`);
    return send(
      chatId,
      `👋 <b>Bienvenido a A2C Finanzas</b>\n\nPara empezar, vincula este chat con tu cuenta:\n\n1. Abre la app A2C → <b>Perfil</b> → <b>Telegram</b>.\n2. Pulsa <b>Vincular con Telegram</b>.\n\nTambién puedes escribir aquí <code>/start CÓDIGO</code> con el código que te muestre la app.`,
    );
  }
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ");
  const result = await rpc("a2c_tg_link_chat", {
    p_code: payload,
    p_chat_id: chatId,
    p_username: from?.username ?? "",
    p_name: name,
  });
  if (!result?.ok) {
    return send(chatId, `❌ ${esc(result?.error || "No se pudo vincular")}.\n\nGenera un código nuevo en la app: Perfil → Telegram.`);
  }
  return send(chatId, `✅ <b>Cuenta vinculada</b>, ${esc(result.display_name)}.\n\n${HELP}`);
}

async function requireUser(chatId: number) {
  const user = await rpc("a2c_tg_user_for_chat", { p_chat_id: chatId });
  if (!user) {
    await send(chatId, "🔗 Este chat aún no está vinculado a ninguna cuenta.\n\nAbre la app A2C → <b>Perfil</b> → <b>Telegram</b> → <b>Vincular con Telegram</b>.");
    return null;
  }
  return user as { user_id: string; default_payment_method: string; display_name: string };
}

async function handleRecent(chatId: number) {
  if (!(await requireUser(chatId))) return;
  const rows: any[] = await rpc("a2c_tg_recent", { p_chat_id: chatId, p_limit: 8 });
  if (!rows.length) return send(chatId, "Aún no tienes movimientos.");
  const lines = rows.map((r) => {
    const sign = ["income", "saving"].includes(r.kind) ? "+" : "−";
    return `• ${formatDate(r.occurred_on)} · ${esc(r.concept)} · <b>${sign}${money(Number(r.amount_cents))}</b>`;
  });
  return send(chatId, `<b>Últimos movimientos</b>\n\n${lines.join("\n")}`);
}

async function handleMonth(chatId: number) {
  if (!(await requireUser(chatId))) return;
  const m: any = await rpc("a2c_tg_month", { p_chat_id: chatId });
  const month = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "Europe/Madrid" }).format(new Date());
  return send(
    chatId,
    `<b>Resumen de ${month}</b>\n\n💸 Gastos: <b>${money(Number(m.expenses_cents))}</b> (${m.count} movimientos)\n💰 Ingresos: <b>${money(Number(m.income_cents))}</b>`,
  );
}

async function handleUnlink(chatId: number) {
  const user = await requireUser(chatId);
  if (!user) return;
  const { error } = await db.from("a2c_telegram_links")
    .update({ chat_id: null, linked_at: null, telegram_username: null, telegram_name: null, updated_at: new Date().toISOString() })
    .eq("chat_id", chatId);
  if (error) throw new Error(error.message);
  return send(chatId, "🔌 Chat desvinculado. Puedes volver a vincularlo desde la app cuando quieras.");
}

// ---------------------------------------------------- registro de gastos
async function recordAndReply(
  chatId: number,
  user: { user_id: string; default_payment_method: string },
  data: Record<string, unknown>,
  summary: (r: any) => string,
  receipt?: { bytes: Uint8Array; mediaType: string; ext: string },
  replyTo?: number,
) {
  const result: any = await rpc("a2c_tg_record_expense", { p_chat_id: chatId, p_data: data });

  if (receipt) {
    const path = `${user.user_id}/${result.id}/${Date.now()}-telegram.${receipt.ext}`;
    const upload = await db.storage.from("receipts").upload(path, receipt.bytes, { contentType: receipt.mediaType, upsert: true });
    if (upload.error) console.warn("No se pudo guardar el ticket en Storage:", upload.error.message);
    else await rpc("a2c_tg_attach_receipt", { p_chat_id: chatId, p_transaction_id: result.id, p_path: path }).catch((e) => console.warn(e));
  }

  return send(chatId, summary(result), {
    reply_markup: receiptKeyboard(result.id, result.payment_method),
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
  });
}

function budgetLine(r: any) {
  const category = CATEGORIES[r.budget_category] ?? CATEGORIES.other;
  return r.budget_name ? `🏷 ${esc(category)} · presupuesto <b>${esc(r.budget_name)}</b>` : `🏷 ${esc(category)}`;
}

async function handleReceipt(chatId: number, message: any) {
  const user = await requireUser(chatId);
  if (!user) return;

  let fileId: string;
  let mediaType = "image/jpeg";
  let size = 0;
  if (message.photo?.length) {
    const best = message.photo[message.photo.length - 1];
    fileId = best.file_id;
    size = best.file_size ?? 0;
  } else {
    const doc = message.document;
    mediaType = String(doc.mime_type || "").toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType) && mediaType !== "application/pdf") {
      return send(chatId, "Solo puedo leer imágenes (JPG, PNG, WEBP) o PDF. Si es una foto en HEIC, envíala como foto normal, no como archivo.");
    }
    fileId = doc.file_id;
    size = doc.file_size ?? 0;
  }
  if (size > MAX_FILE_BYTES) return send(chatId, "El archivo es demasiado grande (máx. 15 MB).");

  await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  const working = await send(chatId, "🔍 Leyendo el ticket…", { reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true } });
  const workingId = working?.result?.message_id;
  const clearWorking = () => workingId && tg("deleteMessage", { chat_id: chatId, message_id: workingId });

  try {
    const fileInfo = await tg("getFile", { file_id: fileId });
    if (!fileInfo.ok) throw new Error("No pude descargar la imagen de Telegram.");
    const fileRes = await fetch(`${TG_BASE}/file/bot${BOT_TOKEN}/${fileInfo.result.file_path}`);
    if (!fileRes.ok) throw new Error("No pude descargar la imagen de Telegram.");
    const bytes = new Uint8Array(await fileRes.arrayBuffer());

    const caption = String(message.caption || "").trim().slice(0, 300);
    const ticket = await readTicket(bytes, mediaType, caption);
    const totalCents = Math.round(Number(ticket.total || 0) * 100);

    if (!ticket.is_receipt || totalCents <= 0) {
      await clearWorking();
      return send(
        chatId,
        `🤔 No he podido leer el importe de este ticket.${ticket.reason ? `\n<i>${esc(ticket.reason)}</i>` : ""}\n\nPrueba con otra foto (bien iluminada, sin cortar el TOTAL) o regístralo a mano escribiendo, por ejemplo: <code>23,40 Mercadona</code>`,
      );
    }

    const date = validDate(ticket.date) ?? todayMadrid();
    const dateNote = ticket.date && !validDate(ticket.date) ? ` (fecha leída «${ticket.date}» no válida, uso hoy)` : "";
    const currency = (ticket.currency || "EUR").toUpperCase();
    const items = (ticket.items || []).slice(0, 15);
    const notesParts = [
      caption,
      currency !== "EUR" ? `Importe original en ${currency}: ${ticket.total}` : "",
      items.length ? `Artículos: ${items.map((i) => `${i.name} ${Number(i.amount).toFixed(2).replace(".", ",")}`).join(" · ")}` : "",
      "[A2C-TELEGRAM]",
    ].filter(Boolean);

    const method = ticket.payment_method === "bank" || ticket.payment_method === "cash" ? ticket.payment_method : user.default_payment_method;
    const concept = (ticket.concept || ticket.merchant || "Ticket").slice(0, 140);
    const ext = mediaType === "application/pdf" ? "pdf" : mediaType.split("/")[1].replace("jpeg", "jpg");

    await clearWorking();
    return await recordAndReply(
      chatId,
      user,
      {
        amount_cents: totalCents,
        concept,
        merchant: ticket.merchant || "",
        occurred_on: date,
        category: ticket.category,
        payment_method: method,
        notes: notesParts.join("\n"),
      },
      (r) => {
        const lines = [
          `✅ <b>Gasto registrado</b>`,
          ``,
          `🏪 ${esc(concept)}`,
          `💶 <b>${money(totalCents)}</b>${currency !== "EUR" ? ` <i>(ticket en ${esc(currency)}, revisa el importe)</i>` : ""}`,
          `📅 ${formatDate(r.occurred_on)}${esc(dateNote)}`,
          budgetLine(r),
        ];
        if (items.length) lines.push(``, `<i>${items.length} artículo${items.length === 1 ? "" : "s"} guardados en las notas</i>`);
        if (ticket.confidence === "low") lines.push(``, `⚠️ <i>Lectura con dudas: revisa el importe en la app.</i>`);
        if (r.duplicate) lines.push(``, `⚠️ <i>Ya tenías un gasto de ${money(totalCents)} ese día. Si es repetido, pulsa Deshacer.</i>`);
        return lines.join("\n");
      },
      { bytes, mediaType, ext },
      message.message_id,
    );
  } catch (error) {
    await clearWorking();
    console.error("Ticket:", error);
    const detail = error instanceof Anthropic.AuthenticationError
      ? "La clave ANTHROPIC_API_KEY no es válida."
      : error instanceof Anthropic.RateLimitError
      ? "Demasiadas peticiones, inténtalo en un minuto."
      : error instanceof Anthropic.APIError
      ? "El servicio de lectura no está disponible ahora mismo."
      : (error as Error).message;
    return send(chatId, `❌ No se pudo registrar el ticket.\n<i>${esc(detail)}</i>\n\nPuedes registrarlo a mano escribiendo, por ejemplo: <code>23,40 Mercadona</code>`);
  }
}

async function handleQuickExpense(chatId: number, message: any) {
  const text = String(message.text || "").trim();
  const amount = parseAmount(text);
  if (!amount) {
    return send(chatId, `No te he entendido 🙂\n\nEnvíame una <b>foto del ticket</b> o un gasto rápido como <code>12,50 café</code>.\n\n/ayuda para ver todas las opciones.`);
  }
  const user = await requireUser(chatId);
  if (!user) return;
  const concept = text.replace(/-?\d[\d.,\s]*\s*(€|eur|euros?)?/i, "").replace(/^[\s·:,-]+|[\s·:,-]+$/g, "").slice(0, 140) || "Gasto rápido";
  const category = guessCategory(concept);
  return recordAndReply(
    chatId,
    user,
    { amount_cents: amount, concept, merchant: "", occurred_on: todayMadrid(), category, payment_method: user.default_payment_method, notes: "[A2C-TELEGRAM]" },
    (r) => [`✅ <b>Gasto registrado</b>`, ``, `📝 ${esc(concept)}`, `💶 <b>${money(amount)}</b>`, `📅 ${formatDate(r.occurred_on)}`, budgetLine(r)]
      .concat(r.duplicate ? [``, `⚠️ <i>Ya tenías un gasto de ${money(amount)} hoy. Si es repetido, pulsa Deshacer.</i>`] : [])
      .join("\n"),
    undefined,
    message.message_id,
  );
}

function guessCategory(concept: string) {
  const v = concept.toLowerCase();
  const rules: [string, string[]][] = [
    ["fuel", ["gasolina", "diesel", "diésel", "combustible", "repsol", "cepsa", "galp", "bp"]],
    ["food", ["mercadona", "lidl", "aldi", "carrefour", "dia", "eroski", "supermercado", "comida", "fruta"]],
    ["leisure", ["cine", "bar", "restaurante", "café", "cafe", "cerveza", "cena", "copas", "hotel", "viaje"]],
    ["health", ["farmacia", "médico", "medico", "dentista", "gimnasio", "padel", "pádel"]],
    ["subscriptions", ["netflix", "spotify", "hbo", "disney", "prime", "suscripción"]],
    ["transport", ["taxi", "uber", "cabify", "tren", "renfe", "bus", "metro", "parking", "peaje"]],
    ["housing", ["alquiler", "hipoteca", "luz", "agua", "gas", "internet"]],
    ["shopping", ["amazon", "zara", "ropa", "tienda", "compra"]],
  ];
  return rules.find(([, words]) => words.some((w) => v.includes(w)))?.[0] ?? "other";
}

async function handleCallback(query: any) {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const [kind, a, b] = String(query.data || "").split(":");
  if (!chatId) return tg("answerCallbackQuery", { callback_query_id: query.id });

  if (kind === "undo") {
    const result: any = await rpc("a2c_tg_undo", { p_chat_id: chatId, p_transaction_id: a });
    if (!result?.ok) return tg("answerCallbackQuery", { callback_query_id: query.id, text: result?.error || "No se pudo deshacer", show_alert: true });
    if (result.receipt_path) await db.storage.from("receipts").remove([result.receipt_path]).catch(() => {});
    await tg("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "HTML",
      text: `🗑 <s>${esc(result.concept)} · ${money(Number(result.amount_cents))}</s>\nGasto eliminado.`,
    });
    return tg("answerCallbackQuery", { callback_query_id: query.id, text: "Gasto eliminado" });
  }

  if (kind === "pm") {
    const ok = await rpc<boolean>("a2c_tg_update_payment", { p_chat_id: chatId, p_transaction_id: b, p_method: a });
    if (!ok) return tg("answerCallbackQuery", { callback_query_id: query.id, text: "El movimiento ya no existe", show_alert: true });
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: receiptKeyboard(b, a) });
    return tg("answerCallbackQuery", { callback_query_id: query.id, text: `Método: ${METHODS[a]}` });
  }

  return tg("answerCallbackQuery", { callback_query_id: query.id });
}

async function handleUpdate(update: any) {
  if (typeof update.update_id === "number") {
    const fresh = await rpc<boolean>("a2c_tg_claim_update", { p_update_id: update.update_id });
    if (!fresh) return; // ya procesado (reintento de Telegram)
  }
  if (update.callback_query) return handleCallback(update.callback_query);

  const message = update.message;
  if (!message?.chat?.id) return;
  const chatId: number = message.chat.id;
  if (message.chat.type !== "private") {
    return send(chatId, "Por privacidad, este bot solo funciona en chats privados.");
  }

  try {
    const text = String(message.text || "").trim();
    if (text.startsWith("/")) {
      const [command, ...rest] = text.split(/\s+/);
      const cmd = command.replace(/@.*$/, "").toLowerCase();
      if (cmd === "/start") return await handleStart(chatId, rest.join(" ").trim(), message.from);
      if (cmd === "/ayuda" || cmd === "/help") return await send(chatId, HELP);
      if (cmd === "/ultimos" || cmd === "/últimos") return await handleRecent(chatId);
      if (cmd === "/mes") return await handleMonth(chatId);
      if (cmd === "/desvincular") return await handleUnlink(chatId);
      return await send(chatId, `Comando desconocido.\n\n${HELP}`);
    }
    if (message.photo?.length || message.document) return await handleReceipt(chatId, message);
    if (text) return await handleQuickExpense(chatId, message);
    return await send(chatId, "Envíame una foto del ticket 📸");
  } catch (error) {
    console.error("Update:", error);
    await send(chatId, `❌ Ha ocurrido un error: <i>${esc((error as Error).message)}</i>`);
  }
}

// ------------------------------------------------------ acciones de la app
async function handleAppAction(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth, error } = await db.auth.getUser(token);
  if (error || !auth?.user) return json({ error: "Sesión no válida" }, 401);

  const body = await req.json().catch(() => ({}));
  const problems: string[] = [];
  if (!BOT_TOKEN) problems.push("Falta el secreto TELEGRAM_BOT_TOKEN en Supabase.");
  if (!ANTHROPIC_KEY) problems.push("Falta el secreto ANTHROPIC_API_KEY en Supabase.");
  if (!BOT_TOKEN) return json({ ok: false, problems });

  const me = await tg("getMe", {});
  if (!me.ok) return json({ ok: false, problems: [...problems, "El TELEGRAM_BOT_TOKEN no es válido."] });

  const webhookUrl = `${SUPABASE_URL}/functions/v1/a2c-telegram`;
  let info = await tg("getWebhookInfo", {});
  const needsSetup = body?.action === "setup" || info?.result?.url !== webhookUrl;
  if (needsSetup) {
    const set = await tg("setWebhook", {
      url: webhookUrl,
      secret_token: await webhookSecret(),
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
    if (!set.ok) problems.push(`No se pudo configurar el webhook: ${set.description || "error"}`);
    await tg("setMyCommands", {
      commands: [
        { command: "ultimos", description: "Últimos movimientos" },
        { command: "mes", description: "Gasto del mes" },
        { command: "ayuda", description: "Cómo usar el bot" },
        { command: "desvincular", description: "Desconectar este chat" },
      ],
    });
    info = await tg("getWebhookInfo", {});
  }
  const lastError = info?.result?.last_error_message;
  if (lastError && info?.result?.last_error_date && Date.now() / 1000 - info.result.last_error_date < 3600) {
    problems.push(`Último error de Telegram: ${lastError}`);
  }
  return json({
    ok: problems.length === 0,
    bot_username: me.result.username,
    bot_name: me.result.first_name,
    webhook_ok: info?.result?.url === webhookUrl,
    pending_updates: info?.result?.pending_update_count ?? 0,
    problems,
  });
}

// ------------------------------------------------------------------ servidor
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const telegramSecret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (telegramSecret !== null) {
    if (!BOT_TOKEN || !timingSafeEqual(telegramSecret, await webhookSecret())) return json({ error: "No autorizado" }, 401);
    const update = await req.json().catch(() => null);
    if (!update) return json({ ok: true });
    // Respondemos al momento y procesamos en segundo plano (leer un ticket tarda unos segundos).
    const work = handleUpdate(update).catch((e) => console.error(e));
    const runtime = (globalThis as any).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(work);
    else await work;
    return json({ ok: true });
  }

  try {
    return await handleAppAction(req);
  } catch (error) {
    console.error(error);
    return json({ ok: false, problems: [(error as Error).message] }, 500);
  }
});
