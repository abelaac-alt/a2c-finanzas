// A2C Finanzas · Edge Function "a2c-market"
// Proxy de solo lectura para cotizaciones bursátiles (fuente: Yahoo Finance, sin clave).
// Se ejecuta en el servidor para evitar el bloqueo CORS del navegador.
// Supabase verifica el JWT del usuario antes de llegar aquí (verify_jwt = true por defecto).
//
// Peticiones (POST JSON):
//   { action: "quote",  symbols: ["AAPL","SAN.MC"] }
//   { action: "chart",  symbol: "SAN.MC", range: "1d"|"5d"|"1mo"|"6mo"|"1y"|"5y" }
//   { action: "search", q: "iberdrola" }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const YAHOO = "https://query1.finance.yahoo.com";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; A2C-Finanzas/8.3)" };
const SYMBOL = /^[A-Za-z0-9.\-^=]{1,20}$/;
const RANGES: Record<string, string> = { "1d": "5m", "5d": "30m", "1mo": "1d", "6mo": "1d", "1y": "1d", "5y": "1wk" };

const json = (body: unknown, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...(maxAge ? { "Cache-Control": `private, max-age=${maxAge}` } : {}) },
  });

async function yahooChart(symbol: string, range: string, interval: string) {
  const url = `${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Sin datos para ${symbol}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(data?.chart?.error?.description || `Sin datos para ${symbol}`);
  return result;
}

function points(result: any) {
  const q = result.indicators?.quote?.[0] || {};
  const ts: number[] = result.timestamp || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    if (c == null) continue;
    out.push({ t: ts[i], o: q.open?.[i] ?? c, h: q.high?.[i] ?? c, l: q.low?.[i] ?? c, c, v: q.volume?.[i] ?? 0 });
  }
  return out;
}

function meta(result: any) {
  const m = result.meta || {};
  return {
    symbol: m.symbol,
    name: m.longName || m.shortName || m.symbol,
    currency: m.currency || "",
    exchange: m.fullExchangeName || m.exchangeName || "",
    timezone: m.exchangeTimezoneName || "",
    price: m.regularMarketPrice ?? null,
    previousClose: m.previousClose ?? m.chartPreviousClose ?? null,
    dayHigh: m.regularMarketDayHigh ?? null,
    dayLow: m.regularMarketDayLow ?? null,
    volume: m.regularMarketVolume ?? null,
    high52: m.fiftyTwoWeekHigh ?? null,
    low52: m.fiftyTwoWeekLow ?? null,
    time: m.regularMarketTime ?? null,
  };
}

async function quote(symbol: string) {
  const result = await yahooChart(symbol, "1d", "5m");
  const info = meta(result);
  const series = points(result);
  const open = series[0]?.o ?? null;
  const change = info.price != null && info.previousClose != null ? info.price - info.previousClose : null;
  const step = Math.max(1, Math.floor(series.length / 48));
  return {
    ...info,
    open,
    change,
    changePct: change != null && info.previousClose ? (change / info.previousClose) * 100 : null,
    spark: series.filter((_, i) => i % step === 0 || i === series.length - 1).map((p) => p.c),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "quote") {
      const symbols = [...new Set((body.symbols || []).map((s: string) => String(s).trim().toUpperCase()))]
        .filter((s) => SYMBOL.test(s as string)).slice(0, 25) as string[];
      const settled = await Promise.allSettled(symbols.map(quote));
      const quotes = settled.map((r, i) => (r.status === "fulfilled" ? r.value : { symbol: symbols[i], error: String(r.reason?.message || r.reason) }));
      return json({ quotes }, 200, 30);
    }
    if (body.action === "chart") {
      const symbol = String(body.symbol || "").trim().toUpperCase();
      const range = RANGES[body.range] ? body.range : "1mo";
      if (!SYMBOL.test(symbol)) return json({ error: "Símbolo no válido" }, 400);
      const result = await yahooChart(symbol, range, RANGES[range]);
      return json({ meta: meta(result), range, points: points(result) }, 200, range === "1d" ? 60 : 600);
    }
    if (body.action === "search") {
      const q = String(body.q || "").trim().slice(0, 40);
      if (q.length < 1) return json({ results: [] });
      const res = await fetch(`${YAHOO}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`, { headers: UA });
      const data = await res.json();
      const results = (data?.quotes || [])
        .filter((r: any) => ["EQUITY", "ETF", "INDEX", "MUTUALFUND", "CRYPTOCURRENCY"].includes(r.quoteType) && r.symbol)
        .map((r: any) => ({ symbol: r.symbol, name: r.longname || r.shortname || r.symbol, exchange: r.exchDisp || r.exchange || "", type: r.quoteType }));
      return json({ results }, 200, 3600);
    }
    return json({ error: "Acción no válida" }, 400);
  } catch (error) {
    return json({ error: String((error as Error)?.message || error) }, 502);
  }
});
