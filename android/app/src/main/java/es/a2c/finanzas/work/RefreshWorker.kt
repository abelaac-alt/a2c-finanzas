package es.a2c.finanzas.work

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import es.a2c.finanzas.A2CApp
import es.a2c.finanzas.Http
import es.a2c.finanzas.Notifications
import es.a2c.finanzas.SessionException
import es.a2c.finanzas.Store
import es.a2c.finanzas.SupabaseApi
import es.a2c.finanzas.widgets.WidgetUpdater
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * Cada 15 minutos (mínimo que permite Android) y al salir de la app:
 * 1) actualiza los widgets de saldo y objetivos, 2) actualiza las cotizaciones del widget de acciones,
 * 3) comprueba las alertas de precio y avisa con una notificación si alguna se cumple.
 */
class RefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    companion object {
        private const val TAG = "A2C-Refresh"
        private const val PERIODIC = "a2c-refresh-periodic"
        private const val ONCE = "a2c-refresh-once"
        private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedulePeriodic(context: Context) {
            val request = PeriodicWorkRequestBuilder<RefreshWorker>(15, TimeUnit.MINUTES).setConstraints(network).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun runOnce(context: Context) {
            val request = OneTimeWorkRequestBuilder<RefreshWorker>().setConstraints(network).setInitialDelay(2, TimeUnit.SECONDS).build()
            WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.REPLACE, request)
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val context = applicationContext
        if (Store.session(context) == null) { WidgetUpdater.updateAll(context); return@withContext Result.success() }
        try {
            refreshSnapshot(context)
            refreshMarket(context)
        } catch (error: SessionException) {
            Log.i(TAG, error.message ?: "Sin sesión")
        } catch (error: Exception) {
            Log.w(TAG, "Fallo al actualizar", error)
        } finally {
            WidgetUpdater.updateAll(context)
        }
        Result.success()
    }

    private fun refreshSnapshot(context: Context) {
        val selection = Store.array(context, Store.GOAL_SELECTION)
        val args = JSONObject().put("p_goal_ids", if (selection.length() > 0) selection else JSONObject.NULL)
        val snapshot = SupabaseApi.rpc(context, "a2c_widget_snapshot_v82", args) as? JSONObject ?: return
        Store.putObj(context, Store.SNAPSHOT, snapshot)
        Store.putLong(context, Store.SNAPSHOT_AT, System.currentTimeMillis())
    }

    // ---------- Bolsa ----------
    private fun refreshMarket(context: Context) {
        val widgetRows = Store.array(context, Store.STOCK_WIDGET)
        val alerts = Store.array(context, Store.STOCK_ALERTS)
        val symbols = linkedSetOf<String>()
        for (i in 0 until widgetRows.length()) widgetRows.optJSONObject(i)?.optString("symbol")?.takeIf { it.isNotBlank() }?.let(symbols::add)
        for (i in 0 until alerts.length()) alerts.optJSONObject(i)?.takeIf { it.optBoolean("active") }?.optString("symbol")?.let(symbols::add)
        if (symbols.isEmpty()) return

        val quotes = fetchQuotes(context, symbols.toList())
        if (quotes.isEmpty()) return

        // Widget
        for (i in 0 until widgetRows.length()) {
            val row = widgetRows.optJSONObject(i) ?: continue
            val quote = quotes[row.optString("symbol")] ?: continue
            row.put("price", quote.optDouble("price")).put("changePct", quote.optDouble("changePct"))
            quote.optString("currency").takeIf { it.isNotBlank() }?.let { row.put("currency", it) }
        }
        Store.putArray(context, Store.STOCK_WIDGET, widgetRows)
        Store.putLong(context, Store.STOCK_WIDGET_AT, System.currentTimeMillis())

        // Alertas: con la app abierta las comprueba la web, para no avisar dos veces.
        if (A2CApp.inForeground) return
        var changed = false
        val triggered = Store.array(context, Store.STOCK_TRIGGERED)
        for (i in 0 until alerts.length()) {
            val alert = alerts.optJSONObject(i) ?: continue
            if (!alert.optBoolean("active")) continue
            val quote = quotes[alert.optString("symbol")] ?: continue
            if (!matches(alert, quote)) continue
            alert.put("active", false).put("triggeredAt", System.currentTimeMillis()).put("triggerPrice", quote.optDouble("price"))
            triggered.put(JSONObject().put("id", alert.optString("id")).put("at", System.currentTimeMillis()).put("price", quote.optDouble("price")))
            changed = true
            notifyAlert(context, alert, quote)
        }
        if (changed) {
            Store.putArray(context, Store.STOCK_ALERTS, alerts)
            Store.putArray(context, Store.STOCK_TRIGGERED, triggered)
        }
    }

    private fun matches(alert: JSONObject, quote: JSONObject): Boolean {
        val price = quote.optDouble("price", Double.NaN)
        val change = quote.optDouble("changePct", Double.NaN)
        val value = alert.optDouble("value", Double.NaN)
        if (value.isNaN()) return false
        return when (alert.optString("type")) {
            "above" -> !price.isNaN() && price >= value
            "below" -> !price.isNaN() && price <= value
            "up" -> !change.isNaN() && change >= value
            "down" -> !change.isNaN() && change <= -value
            else -> false
        }
    }

    private fun notifyAlert(context: Context, alert: JSONObject, quote: JSONObject) {
        val symbol = alert.optString("symbol")
        val rising = alert.optString("type") == "above" || alert.optString("type") == "up"
        val price = WidgetUpdater.price(quote.optDouble("price"), quote.optString("currency"))
        val value = alert.optDouble("value")
        val condition = when (alert.optString("type")) {
            "above" -> "Precio igual o superior a ${WidgetUpdater.price(value, quote.optString("currency"))}"
            "below" -> "Precio igual o inferior a ${WidgetUpdater.price(value, quote.optString("currency"))}"
            "up" -> "Sube en el día al menos ${String.format(java.util.Locale("es", "ES"), "%.2f", value)} %"
            else -> "Baja en el día al menos ${String.format(java.util.Locale("es", "ES"), "%.2f", value)} %"
        }
        val change = quote.optDouble("changePct", Double.NaN)
        val body = "$condition. Variación del día: ${if (change.isNaN()) "—" else WidgetUpdater.pct(change)}."
        Notifications.show(context, ("alert-" + alert.optString("id")).hashCode(), "$symbol ${if (rising) "sube" else "baja"} · $price", body, Notifications.CHANNEL_MARKET, "investment")
    }

    /** Cotizaciones con el mismo proveedor que la web: servidor A2C (Edge Function) o Twelve Data. */
    private fun fetchQuotes(context: Context, symbols: List<String>): Map<String, JSONObject> {
        val settings = Store.obj(context, Store.MARKET_SETTINGS) ?: JSONObject()
        val provider = settings.optString("provider", "auto")
        val key = settings.optString("twelveKey")
        if (provider != "twelve") {
            try {
                val data = SupabaseApi.function(context, "a2c-market", JSONObject().put("action", "quote").put("symbols", JSONArray(symbols)))
                val list = data.optJSONArray("quotes") ?: JSONArray()
                val result = mutableMapOf<String, JSONObject>()
                for (i in 0 until list.length()) list.optJSONObject(i)?.takeIf { !it.has("error") && !it.isNull("price") }?.let { result[it.optString("symbol")] = it }
                if (result.isNotEmpty() || provider == "server") return result
            } catch (error: SessionException) {
                throw error
            } catch (error: Exception) {
                Log.w(TAG, "Servidor de mercado no disponible", error)
                if (provider == "server") return emptyMap()
            }
        }
        if (key.isBlank()) return emptyMap()
        val url = "https://api.twelvedata.com/quote?symbol=${URLEncoder.encode(symbols.joinToString(","), "UTF-8")}&apikey=${URLEncoder.encode(key, "UTF-8")}"
        val (code, body) = Http.get(url)
        if (code !in 200..299) return emptyMap()
        val json = JSONObject(body)
        val result = mutableMapOf<String, JSONObject>()
        for (symbol in symbols) {
            val q = (if (symbols.size == 1) json else json.optJSONObject(symbol)) ?: continue
            if (q.optString("status") == "error" || !q.has("close")) continue
            result[symbol] = JSONObject()
                .put("symbol", symbol)
                .put("price", q.optString("close").toDoubleOrNull() ?: continue)
                .put("changePct", q.optString("percent_change").toDoubleOrNull() ?: 0.0)
                .put("currency", q.optString("currency"))
        }
        return result
    }
}
