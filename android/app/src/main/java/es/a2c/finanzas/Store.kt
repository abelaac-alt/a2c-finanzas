package es.a2c.finanzas

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/** Almacenamiento nativo compartido por la web (vía A2CNative), los widgets y los trabajos en segundo plano. */
object Store {
    private const val PREFS = "a2c_native"
    private const val AUTH_PREFIX = "auth:"

    private fun prefs(context: Context): SharedPreferences = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // ---------- Sesión de Supabase (almacenamiento usado por supabase-js) ----------
    fun authGet(context: Context, key: String): String? = prefs(context).getString(AUTH_PREFIX + key, null)
    fun authSet(context: Context, key: String, value: String) { prefs(context).edit().putString(AUTH_PREFIX + key, value).apply() }
    fun authRemove(context: Context, key: String) { prefs(context).edit().remove(AUTH_PREFIX + key).apply() }
    fun authClearAll(context: Context) {
        val p = prefs(context)
        p.edit().apply { p.all.keys.filter { it.startsWith(AUTH_PREFIX) }.forEach { remove(it) } }.apply()
    }

    /** Clave que usa supabase-js: sb-<ref del proyecto>-auth-token */
    fun sessionStorageKey(context: Context): String {
        val ref = Config.supabaseUrl(context).removePrefix("https://").substringBefore('.')
        return "sb-$ref-auth-token"
    }

    fun session(context: Context): JSONObject? = authGet(context, sessionStorageKey(context))?.let {
        runCatching { JSONObject(it) }.getOrNull()?.let { json -> if (json.has("currentSession")) json.optJSONObject("currentSession") else json }
    }
    fun saveSession(context: Context, session: JSONObject) = authSet(context, sessionStorageKey(context), session.toString())

    // ---------- Valores genéricos ----------
    fun string(context: Context, key: String, default: String? = null): String? = prefs(context).getString(key, default)
    fun putString(context: Context, key: String, value: String?) { prefs(context).edit().apply { if (value == null) remove(key) else putString(key, value) }.apply() }
    fun bool(context: Context, key: String, default: Boolean) = prefs(context).getBoolean(key, default)
    fun putBool(context: Context, key: String, value: Boolean) { prefs(context).edit().putBoolean(key, value).apply() }
    fun long(context: Context, key: String) = prefs(context).getLong(key, 0L)
    fun putLong(context: Context, key: String, value: Long) { prefs(context).edit().putLong(key, value).apply() }

    fun array(context: Context, key: String): JSONArray = runCatching { JSONArray(string(context, key) ?: "[]") }.getOrDefault(JSONArray())
    fun putArray(context: Context, key: String, value: JSONArray) = putString(context, key, value.toString())
    fun obj(context: Context, key: String): JSONObject? = string(context, key)?.let { runCatching { JSONObject(it) }.getOrNull() }
    fun putObj(context: Context, key: String, value: JSONObject?) = putString(context, key, value?.toString())

    // Claves
    const val GOAL_SELECTION = "goal_widget_selection"
    const val SNAPSHOT = "widget_snapshot"
    const val SNAPSHOT_AT = "widget_snapshot_at"
    const val STOCK_WIDGET = "stock_widget_rows"
    const val STOCK_WIDGET_AT = "stock_widget_at"
    const val STOCK_ALERTS = "stock_alerts"
    const val STOCK_TRIGGERED = "stock_triggered"
    const val MARKET_SETTINGS = "market_settings"
    const val SESSION_INVALID = "session_invalid"
    const val PAYMENTS_ENABLED = "payments_enabled"
    const val PAYMENTS_KNOWN_ONLY = "payments_known_only"
    const val PAYMENTS_PENDING = "payments_pending"
    const val PAYMENTS_SEEN = "payments_seen"
}
