package es.a2c.finanzas

import android.content.Context

/** Lee la configuración de Supabase del mismo config.js que usa la web (assets/www/config.js). */
object Config {
    const val ASSET_HOST = "appassets.androidplatform.net"
    const val START_URL = "https://$ASSET_HOST/assets/www/index.html"

    @Volatile private var cache: Pair<String, String>? = null

    private fun load(context: Context): Pair<String, String> {
        cache?.let { return it }
        val text = context.assets.open("www/config.js").bufferedReader().use { it.readText() }
        fun value(name: String) = Regex("$name\\s*:\\s*['\"]([^'\"]+)['\"]").find(text)?.groupValues?.get(1)
            ?: error("Falta $name en config.js")
        return Pair(value("SUPABASE_URL").trimEnd('/'), value("SUPABASE_ANON_KEY")).also { cache = it }
    }

    fun supabaseUrl(context: Context) = load(context).first
    fun supabaseKey(context: Context) = load(context).second
}
