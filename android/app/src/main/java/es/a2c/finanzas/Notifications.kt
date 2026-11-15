package es.a2c.finanzas

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object Notifications {
    const val CHANNEL_MARKET = "market_alerts"
    const val CHANNEL_PAYMENTS = "payments"
    const val CHANNEL_GENERAL = "general"

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannels(listOf(
            NotificationChannel(CHANNEL_MARKET, context.getString(R.string.channel_market), NotificationManager.IMPORTANCE_HIGH).apply {
                description = context.getString(R.string.channel_market_desc)
            },
            NotificationChannel(CHANNEL_PAYMENTS, context.getString(R.string.channel_payments), NotificationManager.IMPORTANCE_HIGH).apply {
                description = context.getString(R.string.channel_payments_desc)
            },
            NotificationChannel(CHANNEL_GENERAL, context.getString(R.string.channel_general), NotificationManager.IMPORTANCE_DEFAULT)
        ))
    }

    fun canPost(context: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    fun openAppIntent(context: Context, destination: String?, requestCode: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            if (destination != null) putExtra(MainActivity.EXTRA_DESTINATION, destination)
        }
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    @Suppress("MissingPermission")
    fun show(context: Context, id: Int, title: String, body: String, channel: String = CHANNEL_GENERAL, destination: String? = null) {
        if (!canPost(context)) return
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_a2c)
            .setColor(ContextCompat.getColor(context, R.color.accent))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(if (channel == CHANNEL_GENERAL) NotificationCompat.PRIORITY_DEFAULT else NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(openAppIntent(context, destination, id))
            .build()
        NotificationManagerCompat.from(context).notify(id, notification)
    }
}
