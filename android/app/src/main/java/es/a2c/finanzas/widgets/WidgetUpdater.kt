package es.a2c.finanzas.widgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import es.a2c.finanzas.Notifications
import es.a2c.finanzas.R
import es.a2c.finanzas.Store
import es.a2c.finanzas.work.RefreshWorker
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Currency
import java.util.Date
import java.util.Locale

class BalanceWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        WidgetUpdater.updateBalance(context); RefreshWorker.runOnce(context)
    }
}
class GoalsWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        WidgetUpdater.updateGoals(context); RefreshWorker.runOnce(context)
    }
}
class StocksWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        WidgetUpdater.updateStocks(context); RefreshWorker.runOnce(context)
    }
}

object WidgetUpdater {
    private val spain = Locale("es", "ES")

    fun money(cents: Long): String = NumberFormat.getCurrencyInstance(spain).apply { currency = Currency.getInstance("EUR") }.format(cents / 100.0)
    fun price(value: Double, currency: String?): String = runCatching {
        NumberFormat.getCurrencyInstance(spain).apply {
            this.currency = Currency.getInstance(currency?.uppercase()?.takeIf { it.length == 3 } ?: "EUR")
            val digits = if (kotlin.math.abs(value) < 1) 4 else 2
            minimumFractionDigits = digits; maximumFractionDigits = digits
        }.format(value)
    }.getOrDefault(String.format(spain, "%.2f", value))
    fun pct(value: Double): String = (if (value > 0) "+" else if (value < 0) "−" else "") + String.format(spain, "%.2f %%", kotlin.math.abs(value))
    private fun time(millis: Long) = if (millis <= 0) "" else SimpleDateFormat("HH:mm", spain).format(Date(millis))

    private fun ids(context: Context, cls: Class<*>): IntArray = AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, cls))
    private fun push(context: Context, cls: Class<*>, views: RemoteViews) {
        val widgetIds = ids(context, cls)
        if (widgetIds.isNotEmpty()) AppWidgetManager.getInstance(context).updateAppWidget(widgetIds, views)
    }

    fun updateAll(context: Context) { updateBalance(context); updateGoals(context); updateStocks(context) }

    private fun statusText(context: Context, at: Long): String = when {
        Store.bool(context, Store.SESSION_INVALID, false) || Store.session(context) == null -> context.getString(R.string.widget_login)
        at <= 0 -> context.getString(R.string.widget_loading)
        else -> context.getString(R.string.widget_updated, time(at))
    }

    fun updateBalance(context: Context) {
        if (ids(context, BalanceWidget::class.java).isEmpty()) return
        val snapshot = Store.obj(context, Store.SNAPSHOT)
        val views = RemoteViews(context.packageName, R.layout.widget_balance)
        views.setOnClickPendingIntent(R.id.widget_root, Notifications.openAppIntent(context, "home", 9101))
        views.setTextViewText(R.id.balance_amount, snapshot?.let { money(it.optLong("available_cents")) } ?: "—")
        views.setTextViewText(R.id.balance_saving, snapshot?.let { money(it.optLong("month_saving_cents")) } ?: "—")
        views.setTextViewText(R.id.balance_piggies, snapshot?.let { money(it.optLong("saving_piggies_cents") + it.optLong("liquidity_piggies_cents")) } ?: "—")
        views.setTextViewText(R.id.balance_status, statusText(context, Store.long(context, Store.SNAPSHOT_AT)))
        push(context, BalanceWidget::class.java, views)
    }

    private val goalRows = listOf(
        Triple(R.id.goal_row_1, R.id.goal_name_1, Triple(R.id.goal_value_1, R.id.goal_progress_1, R.id.goal_pct_1)),
        Triple(R.id.goal_row_2, R.id.goal_name_2, Triple(R.id.goal_value_2, R.id.goal_progress_2, R.id.goal_pct_2)),
        Triple(R.id.goal_row_3, R.id.goal_name_3, Triple(R.id.goal_value_3, R.id.goal_progress_3, R.id.goal_pct_3))
    )

    fun updateGoals(context: Context) {
        if (ids(context, GoalsWidget::class.java).isEmpty()) return
        val goals = Store.obj(context, Store.SNAPSHOT)?.optJSONArray("goals")
        val views = RemoteViews(context.packageName, R.layout.widget_goals)
        views.setOnClickPendingIntent(R.id.widget_root, Notifications.openAppIntent(context, "goals", 9102))
        goalRows.forEachIndexed { index, (row, name, rest) ->
            val goal = goals?.optJSONObject(index)
            if (goal == null) { views.setViewVisibility(row, View.GONE); return@forEachIndexed }
            views.setViewVisibility(row, View.VISIBLE)
            val progress = goal.optInt("progress").coerceIn(0, 100)
            views.setTextViewText(name, goal.optString("name"))
            views.setTextViewText(rest.first, "${money(goal.optLong("balance_cents"))} de ${money(goal.optLong("target_cents"))}")
            views.setProgressBar(rest.second, 100, progress, false)
            views.setTextViewText(rest.third, "$progress %")
        }
        views.setViewVisibility(R.id.goals_empty, if ((goals?.length() ?: 0) == 0) View.VISIBLE else View.GONE)
        views.setTextViewText(R.id.goals_status, statusText(context, Store.long(context, Store.SNAPSHOT_AT)))
        push(context, GoalsWidget::class.java, views)
    }

    private val stockRows = listOf(
        intArrayOf(R.id.stock_row_1, R.id.stock_symbol_1, R.id.stock_name_1, R.id.stock_price_1, R.id.stock_change_1),
        intArrayOf(R.id.stock_row_2, R.id.stock_symbol_2, R.id.stock_name_2, R.id.stock_price_2, R.id.stock_change_2),
        intArrayOf(R.id.stock_row_3, R.id.stock_symbol_3, R.id.stock_name_3, R.id.stock_price_3, R.id.stock_change_3),
        intArrayOf(R.id.stock_row_4, R.id.stock_symbol_4, R.id.stock_name_4, R.id.stock_price_4, R.id.stock_change_4),
        intArrayOf(R.id.stock_row_5, R.id.stock_symbol_5, R.id.stock_name_5, R.id.stock_price_5, R.id.stock_change_5),
        intArrayOf(R.id.stock_row_6, R.id.stock_symbol_6, R.id.stock_name_6, R.id.stock_price_6, R.id.stock_change_6)
    )

    fun updateStocks(context: Context) {
        if (ids(context, StocksWidget::class.java).isEmpty()) return
        val rows = Store.array(context, Store.STOCK_WIDGET)
        val views = RemoteViews(context.packageName, R.layout.widget_stocks)
        views.setOnClickPendingIntent(R.id.widget_root, Notifications.openAppIntent(context, "investment", 9103))
        val up = ContextCompat.getColor(context, R.color.positive)
        val down = ContextCompat.getColor(context, R.color.negative)
        val flat = ContextCompat.getColor(context, R.color.muted)
        stockRows.forEachIndexed { index, ids ->
            val row = rows.optJSONObject(index)
            if (row == null) { views.setViewVisibility(ids[0], View.GONE); return@forEachIndexed }
            views.setViewVisibility(ids[0], View.VISIBLE)
            views.setTextViewText(ids[1], row.optString("symbol"))
            views.setTextViewText(ids[2], row.optString("name"))
            val price = row.optDouble("price", Double.NaN)
            val change = row.optDouble("changePct", Double.NaN)
            views.setTextViewText(ids[3], if (price.isNaN()) "—" else price(price, row.optString("currency")))
            views.setTextViewText(ids[4], if (change.isNaN()) "—" else (if (change > 0) "▲ " else if (change < 0) "▼ " else "") + pct(change))
            views.setTextColor(ids[4], if (change.isNaN() || change == 0.0) flat else if (change > 0) up else down)
        }
        views.setViewVisibility(R.id.stocks_empty, if (rows.length() == 0) View.VISIBLE else View.GONE)
        views.setTextViewText(R.id.stocks_status, if (rows.length() == 0) "" else context.getString(R.string.widget_updated, time(Store.long(context, Store.STOCK_WIDGET_AT))))
        push(context, StocksWidget::class.java, views)
    }
}
