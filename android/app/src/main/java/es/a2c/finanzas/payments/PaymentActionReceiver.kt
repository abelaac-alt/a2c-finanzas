package es.a2c.finanzas.payments

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class PaymentActionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_DISCARD = "es.a2c.finanzas.PAYMENT_DISCARD"
        const val EXTRA_ID = "id"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_DISCARD) intent.getStringExtra(EXTRA_ID)?.let { PaymentStore.remove(context, it) }
    }
}
