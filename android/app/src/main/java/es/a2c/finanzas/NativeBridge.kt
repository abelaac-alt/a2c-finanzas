package es.a2c.finanzas

import android.content.Intent
import android.util.Base64
import android.webkit.JavascriptInterface
import es.a2c.finanzas.payments.PaymentSettingsActivity
import es.a2c.finanzas.payments.PaymentStore
import es.a2c.finanzas.widgets.WidgetUpdater
import es.a2c.finanzas.work.RefreshWorker
import org.json.JSONArray
import org.json.JSONObject

/**
 * Objeto window.A2CNative que usa la web. Todos los métodos se llaman desde un hilo
 * secundario del WebView; lo que toca la interfaz se pasa al hilo principal.
 */
class NativeBridge(private val activity: MainActivity) {
    private val context = activity.applicationContext

    // ---------- Sesión: almacenamiento compartido de supabase-js ----------
    @JavascriptInterface fun authStorageGet(key: String): String? = Store.authGet(context, key)
    @JavascriptInterface fun authStorageSet(key: String, value: String) {
        Store.authSet(context, key, value)
        Store.putBool(context, Store.SESSION_INVALID, false)
    }
    @JavascriptInterface fun authStorageRemove(key: String) = Store.authRemove(context, key)

    // Compatibilidad con versiones anteriores del puente
    @JavascriptInterface fun saveAuthSession(accessToken: String, refreshToken: String, userId: String) {
        Store.putString(context, "legacy_session", JSONObject().put("access_token", accessToken).put("refresh_token", refreshToken).put("user_id", userId).toString())
        RefreshWorker.runOnce(context)
    }
    @JavascriptInterface fun getAuthSession(): String = Store.session(context)?.toString() ?: Store.string(context, "legacy_session") ?: "{}"
    @JavascriptInterface fun clearAuthSession() {
        Store.authClearAll(context)
        Store.putString(context, "legacy_session", null)
        Store.putObj(context, Store.SNAPSHOT, null)
        WidgetUpdater.updateAll(context)
    }

    // ---------- Widgets de saldo y objetivos ----------
    @JavascriptInterface fun getGoalWidgetSelection(): String = Store.string(context, Store.GOAL_SELECTION) ?: "[]"
    @JavascriptInterface fun saveGoalWidgetSelection(json: String) {
        Store.putString(context, Store.GOAL_SELECTION, runCatching { JSONArray(json).toString() }.getOrDefault("[]"))
    }
    @JavascriptInterface fun refreshGoalWidget() = RefreshWorker.runOnce(context)
    @JavascriptInterface fun refreshWidgets() = RefreshWorker.runOnce(context)

    // ---------- Bolsa: widget, alertas y proveedor ----------
    @JavascriptInterface fun saveStockWidget(json: String) {
        Store.putString(context, Store.STOCK_WIDGET, runCatching { JSONArray(json).toString() }.getOrDefault("[]"))
        Store.putLong(context, Store.STOCK_WIDGET_AT, System.currentTimeMillis())
        WidgetUpdater.updateStocks(context)
    }
    @JavascriptInterface fun refreshStockWidget() = WidgetUpdater.updateStocks(context)
    @JavascriptInterface fun saveStockAlerts(json: String) {
        Store.putString(context, Store.STOCK_ALERTS, runCatching { JSONArray(json).toString() }.getOrDefault("[]"))
    }
    @JavascriptInterface fun saveMarketSettings(json: String) {
        Store.putString(context, Store.MARKET_SETTINGS, runCatching { JSONObject(json).toString() }.getOrDefault("{}"))
    }
    /** Devuelve (y vacía) las alertas que saltaron en segundo plano para que la web las marque. */
    @JavascriptInterface fun consumeTriggeredAlerts(): String {
        val triggered = Store.array(context, Store.STOCK_TRIGGERED)
        Store.putArray(context, Store.STOCK_TRIGGERED, JSONArray())
        return triggered.toString()
    }

    // ---------- Notificaciones ----------
    @JavascriptInterface fun showNotification(title: String, body: String) {
        Notifications.show(context, (title + body).hashCode(), title, body, Notifications.CHANNEL_MARKET, "investment")
    }
    @JavascriptInterface fun notificationsEnabled(): Boolean = Notifications.canPost(context)
    @JavascriptInterface fun requestNotificationPermission() = activity.requestNotificationPermission()

    // ---------- Detección de pagos ----------
    @JavascriptInterface fun openAndroidSettings() {
        activity.runOnUiThread { activity.startActivity(Intent(activity, PaymentSettingsActivity::class.java)) }
    }
    @JavascriptInterface fun onPaymentResult(id: String, json: String) {
        val result = runCatching { JSONObject(json) }.getOrDefault(JSONObject())
        if (result.optBoolean("ok")) {
            PaymentStore.remove(context, id)
            activity.toast(context.getString(if (result.optBoolean("duplicate")) R.string.payment_duplicate else R.string.payment_registered))
            RefreshWorker.runOnce(context)
        } else {
            activity.toast(result.optString("error").ifBlank { context.getString(R.string.payment_error) })
        }
    }
    @JavascriptInterface fun pendingPaymentsCount(): Int = PaymentStore.all(context).length()

    // ---------- Archivos ----------
    @JavascriptInterface fun saveFile(name: String, mime: String, base64: String) {
        val bytes = runCatching { Base64.decode(base64, Base64.DEFAULT) }.getOrNull() ?: return
        activity.saveFile(name, mime, bytes)
    }
    @JavascriptInterface fun openExternal(url: String) {
        if (url.startsWith("https://")) activity.openExternal(android.net.Uri.parse(url))
    }

    @JavascriptInterface fun appVersion(): String = BuildConfig.VERSION_NAME
}
