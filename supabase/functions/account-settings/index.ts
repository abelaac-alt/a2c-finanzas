import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const cleanName = (value: unknown) => String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
const validPassword = (value: string) => value.length >= 10 && value.length <= 128 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authorization = req.headers.get("Authorization") || "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ ok: false, error: "Sesión no válida" }, 401);

    const body = await req.json().catch(() => ({}));
    const displayName = cleanName(body.display_name);
    const password = typeof body.password === "string" ? body.password : "";
    const avatarPath = body.avatar_path === null ? null : String(body.avatar_path ?? "").trim();

    if (displayName.length < 2 || displayName.length > 80) return json({ ok: false, error: "El nombre debe tener entre 2 y 80 caracteres." }, 400);
    if (avatarPath !== null && avatarPath !== `${user.id}/avatar.jpg`) return json({ ok: false, error: "Ruta de avatar no válida." }, 400);
    if (password && !validPassword(password)) return json({ ok: false, error: "La contraseña debe tener entre 10 y 128 caracteres e incluir mayúscula, minúscula y número." }, 400);

    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { error: profileError } = await admin.from("profiles").update({ display_name: displayName, avatar_path: avatarPath }).eq("id", user.id);
    if (profileError) throw profileError;
    if (password) {
      const { error: passwordError } = await admin.auth.admin.updateUserById(user.id, { password });
      if (passwordError) throw passwordError;
    }
    return json({ ok: true });
  } catch (error) {
    console.error("account-settings failed", error instanceof Error ? error.message : "unknown error");
    return json({ ok: false, error: "No se pudo actualizar el perfil." }, 500);
  }
});
