package es.a2c.finanzas.payments

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import es.a2c.finanzas.MainActivity
import es.a2c.finanzas.Notifications
import es.a2c.finanzas.R
import es.a2c.finanzas.Store
import es.a2c.finanzas.widgets.WidgetUpdater
import org.json.JSONArray
import org.json.JSONObject

/** Pagos detectados pendientes de confirmar. Se registran en A2C solo cuando el usuario pulsa «Registrar». */
object PaymentStore {
    private const val MAX_PENDING = 30
    private const val SEEN_WINDOW = 36L * 3600 * 1000

    fun all(context: Context): JSONArray = Store.array(context, Store.PAYMENTS_PENDING)
    fun find(context: Context, id: String): JSONObject? {
        val list = all(context)
        for (i in 0 until list.length()) list.optJSONObject(i)?.takeIf { it.optString("id") == id }?.let { return it }
        return null
    }

    fun remove(context: Context, id: String) {
        val list = all(context); val next = JSONArray()
        for (i in 0 until list.length()) list.optJSONObject(i)?.takeIf { it.optString("id") != id }?.let(next::put)
        Store.putArray(context, Store.PAYMENTS_PENDING, next)
        NotificationManagerCompat.from(context).cancel(notificationId(id))
    }

    /** Añade un pago si no se ha visto ya (misma huella en las últimas 36 h). Devuelve el pago o null. */
    fun add(context: Context, payment: DetectedPayment): JSONObject? {
        val now = System.currentTimeMillis()
        val seen = Store.obj(context, Store.PAYMENTS_SEEN) ?: JSONObject()
        val pruned = JSONObject()
        seen.keys().forEach { key -> val at = seen.optLong(key); if (now - at < SEEN_WINDOW) pruned.put(key, at) }
        if (pruned.has(payment.fingerprint)) return null
        pruned.put(payment.fingerprint, now)
        Store.putObj(context, Store.PAYMENTS_SEEN, pruned)

        val item = JSONObject()
            .put("id", "p${now}${(payment.fingerprint.hashCode() and 0xffff)}")
            .put("amount_cents", payment.amountCents)
            .put("merchant", payment.merchant)
            .put("app", payment.appName)
            .put("package", payment.packageName)
            .put("text", payment.text.take(240))
            .put("time", payment.time)
            .put("fingerprint", payment.fingerprint)
        val list = all(context); val next = JSONArray().put(item)
        for (i in 0 until minOf(list.length(), MAX_PENDING - 1)) next.put(list.get(i))
        Store.putArray(context, Store.PAYMENTS_PENDING, next)
        return item
    }

    fun notificationId(id: String) = ("payment-$id").hashCode()

    @SuppressLint("MissingPermission")
    fun notify(context: Context, item: JSONObject) {
        if (!Notifications.canPost(context)) return
        val id = item.optString("id")
        val amount = WidgetUpdater.money(item.optLong("amount_cents"))
        val register = PendingIntent.getActivity(context, notificationId(id),
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(MainActivity.EXTRA_PAYMENT_ID, id)
            }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val discard = PendingIntent.getBroadcast(context, notificationId(id) + 1,
            Intent(context, PaymentActionReceiver::class.java).setAction(PaymentActionReceiver.ACTION_DISCARD).putExtra(PaymentActionReceiver.EXTRA_ID, id),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(context, notificationId(id) + 2,
            Intent(context, PaymentSettingsActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val body = "${item.optString("merchant")} · ${item.optString("app")}"
        val notification = NotificationCompat.Builder(context, Notifications.CHANNEL_PAYMENTS)
            .setSmallIcon(R.drawable.ic_stat_a2c)
            .setColor(ContextCompat.getColor(context, R.color.accent))
            .setContentTitle(context.getString(R.string.payment_detected_title, amount))
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText("$body\n${item.optString("text")}"))
            .setContentIntent(open)
            .setAutoCancel(true)
            .addAction(0, context.getString(R.string.payment_register), register)
            .addAction(0, context.getString(R.string.payment_discard), discard)
            .build()
        NotificationManagerCompat.from(context).notify(notificationId(id), notification)
    }
}
