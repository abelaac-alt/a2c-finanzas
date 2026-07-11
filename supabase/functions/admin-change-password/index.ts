import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validatePassword(password: string): string | null {
  if (password.length < 10) {
    return "La contraseña debe tener al menos 10 caracteres.";
  }

  if (password.length > 128) {
    return "La contraseña no puede superar los 128 caracteres.";
  }

  if (!/[a-z]/.test(password)) {
    return "La contraseña debe incluir una letra minúscula.";
  }

  if (!/[A-Z]/.test(password)) {
    return "La contraseña debe incluir una letra mayúscula.";
  }

  if (!/[0-9]/.test(password)) {
    return "La contraseña debe incluir un número.";
  }

  return null;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Método no permitido." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error("Faltan variables de entorno de Supabase.");
      return jsonResponse({ error: "Configuración incompleta del servidor." }, 500);
    }

    const authorization = request.headers.get("Authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return jsonResponse({ error: "No has iniciado sesión." }, 401);
    }

    // Cliente asociado al usuario que realiza la petición.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const {
      data: { user: caller },
      error: callerError,
    } = await userClient.auth.getUser();

    if (callerError || !caller) {
      console.error("Token no válido:", callerError);
      return jsonResponse({ error: "La sesión no es válida." }, 401);
    }

    // Comprobación directa del rol; no utiliza public.is_admin().
    const {
      data: callerProfile,
      error: profileError,
    } = await userClient
      .from("profiles")
      .select("id, role, active")
      .eq("id", caller.id)
      .single();

    if (profileError) {
      console.error("No se pudo leer el perfil:", profileError);
      return jsonResponse({ error: "No se pudo comprobar tu permiso." }, 403);
    }

    if (
      callerProfile?.role !== "admin" ||
      callerProfile?.active === false
    ) {
      return jsonResponse(
        { error: "Solo un administrador activo puede cambiar contraseñas." },
        403,
      );
    }

    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "El cuerpo de la petición no es JSON válido." }, 400);
    }

    const body = payload as {
      user_id?: unknown;
      password?: unknown;
    };

    const userId = String(body.user_id ?? "").trim();
    const password = String(body.password ?? "");

    if (!isUuid(userId)) {
      return jsonResponse({ error: "La ID del usuario no es válida." }, 400);
    }

    const passwordError = validatePassword(password);

    if (passwordError) {
      return jsonResponse({ error: passwordError }, 400);
    }

    // Cliente administrativo. La service_role nunca sale de la función.
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data, error } = await adminClient.auth.admin.updateUserById(
      userId,
      { password },
    );

    if (error) {
      console.error("Error actualizando contraseña:", error);
      return jsonResponse(
        { error: "No se pudo actualizar la contraseña." },
        400,
      );
    }

    return jsonResponse({
      ok: true,
      user_id: data.user.id,
      message: "Contraseña actualizada correctamente.",
    });
  } catch (error) {
    console.error("Error inesperado:", error);
    return jsonResponse({ error: "Error interno del servidor." }, 500);
  }
});
