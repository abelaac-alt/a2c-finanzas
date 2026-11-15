package es.a2c.finanzas.payments

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.format.DateFormat
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import es.a2c.finanzas.MainActivity
import es.a2c.finanzas.Notifications
import es.a2c.finanzas.R
import es.a2c.finanzas.Store
import es.a2c.finanzas.widgets.WidgetUpdater
import java.util.Date

/** Pantalla nativa «Detección de pagos» (se abre desde Perfil › Detección de pagos). */
class PaymentSettingsActivity : Activity() {
    private lateinit var content: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        actionBar?.setDisplayHomeAsUpEnabled(true)
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(8), dp(16), dp(32)) }
        setContentView(ScrollView(this).apply { addView(content) })
    }

    override fun onResume() { super.onResume(); render() }
    override fun onNavigateUp(): Boolean { finish(); return true }

    private fun dp(value: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()
    private fun color(id: Int) = ContextCompat.getColor(this, id)

    private fun text(value: String, size: Float = 14f, bold: Boolean = false, colorId: Int = R.color.ink, top: Int = 0) = TextView(this).apply {
        text = value; textSize = size; setTextColor(color(colorId))
        if (bold) typeface = Typeface.DEFAULT_BOLD
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }
    }

    private fun card(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(14), dp(16), dp(14))
        background = GradientDrawable().apply { setColor(color(R.color.surface)); setStroke(dp(1), color(R.color.line)); cornerRadius = dp(12).toFloat() }
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) }
    }

    private fun button(label: String, primary: Boolean = false, onClick: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; textSize = 14f
        setTextColor(if (primary) color(R.color.surface) else color(R.color.ink))
        background = GradientDrawable().apply {
            setColor(if (primary) color(R.color.accent) else color(R.color.surface))
            if (!primary) setStroke(dp(1), color(R.color.line))
            cornerRadius = dp(8).toFloat()
        }
        stateListAnimator = null
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(40)).apply { topMargin = dp(10); marginEnd = dp(8) }
        setPadding(dp(14), 0, dp(14), 0)
        setOnClickListener { onClick() }
    }

    private fun toggle(label: String, detail: String, key: String, default: Boolean) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) }
        val texts = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            addView(text(label, 15f, bold = true)); addView(text(detail, 13f, colorId = R.color.muted, top = 2))
        }
        addView(texts)
        addView(Switch(context).apply {
            isChecked = Store.bool(context, key, default)
            setOnCheckedChangeListener { _, checked -> Store.putBool(context, key, checked) }
        })
    }

    private fun render() {
        content.removeAllViews()
        val listener = PaymentListenerService.isEnabled(this)
        val notifications = Notifications.canPost(this)

        content.addView(text("A2C puede detectar los pagos con tarjeta que te notifican tu banco o tu cartera digital y proponerte registrarlos con un toque.", 14f, colorId = R.color.ink2, top = 4))

        card().also { box ->
            box.addView(text("Acceso a notificaciones", 16f, bold = true))
            box.addView(text(if (listener) "Concedido. A2C detecta pagos en segundo plano." else "Sin conceder. Actívalo para que A2C pueda leer las notificaciones de pago.", 13f, colorId = if (listener) R.color.positive else R.color.negative, top = 4))
            box.addView(button(if (listener) "Gestionar acceso" else "Conceder acceso", primary = !listener) {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            })
            box.addView(text("Notificaciones de A2C", 16f, bold = true, top = 16))
            box.addView(text(if (notifications) "Activadas: recibirás el aviso «Pago detectado» y las alertas de bolsa." else "Desactivadas: no verás los avisos de pagos ni de bolsa.", 13f, colorId = if (notifications) R.color.positive else R.color.negative, top = 4))
            if (!notifications) box.addView(button("Activar notificaciones", primary = true) { openNotificationSettings() })
            content.addView(box)
        }

        card().also { box ->
            box.addView(text("Opciones", 16f, bold = true))
            box.addView(toggle("Detección de pagos", "Analiza las notificaciones nuevas.", Store.PAYMENTS_ENABLED, true))
            box.addView(toggle("Solo bancos y carteras conocidas", "Google Wallet, Samsung Wallet, BBVA, Santander, CaixaBank, ING, Sabadell, Openbank, Bankinter, Revolut, N26… Desactívalo si tu banco no aparece.", Store.PAYMENTS_KNOWN_ONLY, true))
            content.addView(box)
        }

        card().also { box ->
            val pending = PaymentStore.all(this)
            box.addView(text("Pagos detectados pendientes (${pending.length()})", 16f, bold = true))
            if (pending.length() == 0) box.addView(text("No hay pagos pendientes. Cuando pagues con tarjeta aparecerán aquí y en una notificación.", 13f, colorId = R.color.muted, top = 4))
            for (i in 0 until pending.length()) {
                val item = pending.optJSONObject(i) ?: continue
                val id = item.optString("id")
                box.addView(View(this).apply { setBackgroundColor(color(R.color.line)); layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1)).apply { topMargin = dp(12) } })
                box.addView(text("${WidgetUpdater.money(item.optLong("amount_cents"))} · ${item.optString("merchant")}", 15f, bold = true, top = 10))
                box.addView(text("${item.optString("app")} · ${DateFormat.getMediumDateFormat(this).format(Date(item.optLong("time")))} ${DateFormat.getTimeFormat(this).format(Date(item.optLong("time")))}", 12f, colorId = R.color.muted, top = 2))
                box.addView(LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    addView(button("Registrar", primary = true) {
                        startActivity(Intent(this@PaymentSettingsActivity, MainActivity::class.java).apply {
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                            putExtra(MainActivity.EXTRA_PAYMENT_ID, id)
                        })
                        finish()
                    })
                    addView(button("Descartar") { PaymentStore.remove(this@PaymentSettingsActivity, id); render() })
                })
            }
            content.addView(box)
        }

        card().also { box ->
            box.addView(text("Probar", 16f, bold = true))
            box.addView(text("Crea un pago de ejemplo de 1,00 € para comprobar el aviso. Descártalo después si no quieres registrarlo.", 13f, colorId = R.color.muted, top = 4))
            box.addView(button("Simular pago de prueba") {
                val payment = PaymentParser.parse("com.google.android.apps.walletnfcrel", "Prueba A2C", "Prueba A2C", "Has pagado 1,00 € en Prueba A2C", System.currentTimeMillis())
                val item = payment?.let { PaymentStore.add(this, it.copy(fingerprint = it.fingerprint + System.currentTimeMillis())) }
                if (item != null) { PaymentStore.notify(this, item); Toast.makeText(this, "Pago de prueba creado.", Toast.LENGTH_SHORT).show() }
                render()
            })
            box.addView(text("Privacidad: el análisis se hace en el móvil. Nada se envía a A2C hasta que pulsas «Registrar».", 12f, colorId = R.color.muted, top = 12))
            content.addView(box)
        }
    }

    private fun openNotificationSettings() {
        // Primero se pide el permiso; si Android ya no deja pedirlo, se abren los ajustes de la app.
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            !Store.bool(this, "asked_notifications_settings", false)) {
            Store.putBool(this, "asked_notifications_settings", true)
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7)
            return
        }
        startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        render()
    }
}
