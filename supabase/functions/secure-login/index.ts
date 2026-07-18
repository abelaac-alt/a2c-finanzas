import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const normalizeEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();
const validEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validPasswordInput = (password: string) => password.length >= 6 && password.length <= 256 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(password);

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";

    // Validation is authoritative here on the server. Passwords are never trimmed,
    // transformed, logged, or stored by this function.
    if (!validEmail(email) || !validPasswordInput(password)) {
      return json({ ok: false, code: "invalid_credentials" });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("Missing Supabase environment variables");

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const emailHash = await sha256(email);
    const now = Date.now();

    const { data: guard, error: guardError } = await admin
      .from("login_attempts")
      .select("failed_attempts,locked_until")
      .eq("email_hash", emailHash)
      .maybeSingle();
    if (guardError) throw guardError;

    const lockedUntil = guard?.locked_until ? new Date(guard.locked_until).getTime() : 0;
    if (lockedUntil > now) {
      return json({ ok: false, code: "locked", retry_after: Math.ceil((lockedUntil - now) / 1000) });
    }

    // If a previous lock has expired, start a fresh counter.
    if (guard && lockedUntil && lockedUntil <= now) {
      await admin.from("login_attempts").delete().eq("email_hash", emailHash);
    }

    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({ email, password });

    if (authError || !authData.session || !authData.user) {
      const previous = guard && (!lockedUntil || lockedUntil <= now) ? Number(guard.failed_attempts || 0) : 0;
      const failedAttempts = previous + 1;
      const shouldLock = failedAttempts >= 5;
      const newLockedUntil = shouldLock ? new Date(now + 15 * 60 * 1000).toISOString() : null;
      const { error: writeError } = await admin.from("login_attempts").upsert({
        email_hash: emailHash,
        failed_attempts: failedAttempts,
        locked_until: newLockedUntil,
        last_failed_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      }, { onConflict: "email_hash" });
      if (writeError) throw writeError;
      return json({ ok: false, code: shouldLock ? "locked" : "invalid_credentials" });
    }

    const { data: profile } = await admin.from("profiles").select("active").eq("id", authData.user.id).maybeSingle();
    if (profile?.active === false) {
      await authClient.auth.signOut();
      return json({ ok: false, code: "invalid_credentials" });
    }

    await admin.from("login_attempts").delete().eq("email_hash", emailHash);
    return json({
      ok: true,
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
      },
    });
  } catch (error) {
    console.error("secure-login failed", error instanceof Error ? error.message : "unknown error");
    return json({ ok: false, code: "server_error" }, 500);
  }
});
