package es.a2c.finanzas.payments

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import es.a2c.finanzas.Store

/** Escucha las notificaciones del móvil (con permiso del usuario) y detecta pagos con tarjeta. */
class PaymentListenerService : NotificationListenerService() {
    companion object {
        fun isEnabled(context: Context): Boolean {
            val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return false
            val me = ComponentName(context, PaymentListenerService::class.java)
            return flat.split(':').any { ComponentName.unflattenFromString(it) == me }
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        try {
            val context = applicationContext
            if (!Store.bool(context, Store.PAYMENTS_ENABLED, true)) return
            if (sbn.packageName == packageName || sbn.isOngoing) return
            val knownOnly = Store.bool(context, Store.PAYMENTS_KNOWN_ONLY, true)
            if (knownOnly && sbn.packageName !in PaymentParser.KNOWN_APPS) return
            val extras = sbn.notification.extras
            if ((sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return
            val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
            val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString().orEmpty()
            val appName = PaymentParser.KNOWN_APPS[sbn.packageName] ?: runCatching {
                packageManager.getApplicationLabel(packageManager.getApplicationInfo(sbn.packageName, 0)).toString()
            }.getOrDefault(sbn.packageName)
            val payment = PaymentParser.parse(sbn.packageName, appName, title, text, sbn.postTime) ?: return
            val item = PaymentStore.add(context, payment) ?: return
            PaymentStore.notify(context, item)
        } catch (error: Exception) {
            Log.w("A2C-Payments", "No se pudo analizar la notificación", error)
        }
    }
}
