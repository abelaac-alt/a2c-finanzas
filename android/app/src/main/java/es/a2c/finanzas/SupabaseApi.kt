package es.a2c.finanzas

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class SessionException(message: String) : Exception(message)

/**
 * Cliente mínimo de Supabase para trabajar con la app cerrada (widgets y alertas).
 * Usa la MISMA sesión que guarda la web: si hay que renovar el token, lo guarda en el
 * almacenamiento compartido para que la web lo lea al abrirse y no se invalide la sesión.
 */
object SupabaseApi {
    private const val TAG = "A2C-Supabase"
    private val refreshLock = Any()

    /** Token de acceso válido. Solo renueva si la app no está en primer plano (allí lo hace la web). */
    fun accessToken(context: Context): String {
        synchronized(refreshLock) {
            val session = Store.session(context) ?: throw SessionException("No hay sesión. Abre A2C e inicia sesión.")
            val access = session.optString("access_token")
            val expiresAt = session.optLong("expires_at", 0L)
            val now = System.currentTimeMillis() / 1000
            if (access.isNotEmpty() && expiresAt - now > 90) return access
            if (A2CApp.inForeground) {
                if (access.isNotEmpty() && expiresAt > now) return access
                throw SessionException("Sesión en renovación por la app.")
            }
            return refresh(context, session)
        }
    }

    private fun refresh(context: Context, session: JSONObject): String {
        val refreshToken = session.optString("refresh_token")
        if (refreshToken.isEmpty()) throw SessionException("No hay sesión. Abre A2C e inicia sesión.")
        val (code, body) = request(context, "POST", "/auth/v1/token?grant_type=refresh_token", JSONObject().put("refresh_token", refreshToken).toString(), null)
        if (code == 400 || code == 401) {
            Store.putBool(context, Store.SESSION_INVALID, true)
            throw SessionException("La sesión ha caducado. Abre A2C e inicia sesión.")
        }
        if (code !in 200..299) throw IOException("No se pudo renovar la sesión ($code)")
        val fresh = JSONObject(body)
        val now = System.currentTimeMillis() / 1000
        if (!fresh.has("expires_at")) fresh.put("expires_at", now + fresh.optLong("expires_in", 3600))
        if (!fresh.has("user") && session.has("user")) fresh.put("user", session.get("user"))
        Store.saveSession(context, fresh)
        Store.putBool(context, Store.SESSION_INVALID, false)
        Log.i(TAG, "Sesión renovada en segundo plano")
        return fresh.getString("access_token")
    }

    fun rpc(context: Context, name: String, args: JSONObject): Any? {
        val token = accessToken(context)
        val (code, body) = request(context, "POST", "/rest/v1/rpc/$name", args.toString(), token)
        if (code !in 200..299) throw IOException("RPC $name: $code $body")
        return parse(body)
    }

    fun function(context: Context, name: String, payload: JSONObject): JSONObject {
        val token = accessToken(context)
        val (code, body) = request(context, "POST", "/functions/v1/$name", payload.toString(), token)
        if (code !in 200..299) throw IOException("Función $name: $code $body")
        return JSONObject(body)
    }

    private fun parse(body: String): Any? {
        val text = body.trim()
        return when {
            text.isEmpty() || text == "null" -> null
            text.startsWith("{") -> JSONObject(text)
            text.startsWith("[") -> JSONArray(text)
            else -> text
        }
    }

    private fun request(context: Context, method: String, path: String, body: String?, token: String?): Pair<Int, String> {
        val key = Config.supabaseKey(context)
        val connection = (URL(Config.supabaseUrl(context) + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15000
            readTimeout = 20000
            setRequestProperty("apikey", key)
            setRequestProperty("Authorization", "Bearer ${token ?: key}")
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("x-client-info", "a2c-android/${BuildConfig.VERSION_NAME}")
        }
        return Http.send(connection, body)
    }
}

object Http {
    fun send(connection: HttpURLConnection, body: String?): Pair<Int, String> {
        try {
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return code to text
        } finally {
            connection.disconnect()
        }
    }

    fun get(url: String): Pair<Int, String> {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000
            readTimeout = 20000
            setRequestProperty("Accept", "application/json")
        }
        return send(connection, null)
    }
}
